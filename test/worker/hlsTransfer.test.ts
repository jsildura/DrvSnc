import { describe, it, expect, beforeAll, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from './testDb';
import { hashOpaqueToken, encryptSecret } from '../../src/worker/services/crypto';
import { runDriveTransfer } from '../../src/worker/workflows/DriveTransfer';

/** Mirrors DRIVE_BLOCK_SIZE in the workflow: Google's alignment rule for unknown-size uploads. */
const BLOCK = 256 * 1024;

const SESSION_URL =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=mock-hls-session';

// --- VOD fixtures: a master with two renditions, and the 3-segment variant it points at. --------

const VOD_MASTER_URL = 'https://cdn.example.com/vod/index.m3u8';
const VOD_LOW_URL = 'https://cdn.example.com/vod/low.m3u8';
const VOD_VARIANT_URL = 'https://cdn.example.com/vod/big-buck-bunny.m3u8';

const VOD_MASTER = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4970000,RESOLUTION=1920x1080
big-buck-bunny.m3u8
`;

const VOD_VARIANT = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:10.000,
seg-1.ts
#EXTINF:10.000,
seg-2.ts
#EXTINF:10.000,
seg-3.ts
#EXT-X-ENDLIST
`;

/** Deliberately not a multiple of 256 KiB, so a remainder has to be carried to the commit. */
const VOD_SEGMENT_BYTES = 300_000;
const VOD_TOTAL = VOD_SEGMENT_BYTES * 3;

// --- Live fixtures: a rolling window that advances by exactly one window per poll. --------------

const LIVE_MASTER_URL = 'https://cdn.example.com/live/streamkey/index.m3u8';
const LIVE_VARIANT_URL = 'https://cdn.example.com/live/streamkey/tracks-v1a1/mono.m3u8';

const LIVE_MASTER = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=4970000,RESOLUTION=1920x1080,CODECS="avc1.4d4028,mp4a.40.2"
tracks-v1a1/mono.m3u8
`;

const LIVE_SEGMENT_SECONDS = 5;
const LIVE_WINDOW_LENGTH = 4;
const LIVE_FIRST_SEQUENCE = 1000;
const LIVE_SEGMENT_BYTES = 100_000;

/** Poll interval the workflow derives from this window: targetDuration × (window − 1). */
const LIVE_POLL_SECONDS = LIVE_SEGMENT_SECONDS * (LIVE_WINDOW_LENGTH - 1);

function liveWindow(index: number): string {
  const start = LIVE_FIRST_SEQUENCE + index * LIVE_WINDOW_LENGTH;
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${LIVE_SEGMENT_SECONDS}`,
    `#EXT-X-MEDIA-SEQUENCE:${start}`,
  ];
  for (let i = 0; i < LIVE_WINDOW_LENGTH; i++) {
    lines.push(`#EXTINF:${LIVE_SEGMENT_SECONDS}.000,`, `segment-${start + i}.ts`);
  }
  // No #EXT-X-ENDLIST: this playlist is still growing.
  return `${lines.join('\n')}\n`;
}

/** Every segment carries one repeated byte value, so the assembled upload is verifiable exactly. */
function liveFillFor(sequence: number): number {
  return ((sequence - LIVE_FIRST_SEQUENCE) % 255) + 1;
}

/** Pinned to a non-shared buffer so the bytes can be handed straight to `new Response`. */
function filled(length: number, value: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(length).fill(value);
}

/**
 * Run-length encode a buffer so a byte-for-byte assertion stays a single pass and a readable
 * expectation. Any gap, duplication, or stray playlist text at a chunk boundary shows up here.
 */
function runs(bytes: Uint8Array): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const byte of bytes) {
    const last = out[out.length - 1];
    if (last && last[0] === byte) last[1]++;
    else out.push([byte, 1]);
  }
  return out;
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
}

async function bodyBytes(init?: RequestInit): Promise<Uint8Array> {
  const body = init?.body;
  if (!body) return new Uint8Array(0);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return new Uint8Array(await new Response(body as BodyInit).arrayBuffer());
}

interface DrivePut {
  contentRange: string;
  bytes: Uint8Array;
}

/**
 * Assemble what Google actually received, in the order it was sent, and check the resumable
 * session's own bookkeeping: contiguous offsets, `/*` until the commit, and 256 KiB alignment on
 * everything but the last request.
 */
function assembleDriveUpload(puts: DrivePut[]): { bytes: Uint8Array; declaredTotal: number } {
  const parts: Uint8Array[] = [];
  let expectedOffset = 0;

  puts.forEach((put, index) => {
    const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(put.contentRange);
    expect(match, `unparseable Content-Range: ${put.contentRange}`).not.toBeNull();
    const [, startStr, endStr, total] = match as RegExpExecArray;
    const start = Number(startStr);
    const end = Number(endStr);

    expect(start).toBe(expectedOffset);
    expect(end - start + 1).toBe(put.bytes.byteLength);

    const isFinal = index === puts.length - 1;
    if (isFinal) {
      // The commit is the only request that may declare the real length.
      expect(total).not.toBe('*');
    } else {
      expect(total).toBe('*');
      expect(put.bytes.byteLength % BLOCK).toBe(0);
    }

    parts.push(put.bytes);
    expectedOffset = end + 1;
  });

  const merged = new Uint8Array(expectedOffset);
  let at = 0;
  for (const part of parts) {
    merged.set(part, at);
    at += part.byteLength;
  }

  const finalTotal = /\/(\d+)$/.exec(puts[puts.length - 1].contentRange);
  return { bytes: merged, declaredTotal: finalTotal ? Number(finalTotal[1]) : -1 };
}

/**
 * Reassemble the session the way a resumable upload does — by each request's declared offset, so a
 * re-offered range overwrites rather than appends.
 *
 * `assembleDriveUpload` cannot be used for that: it requires strictly contiguous offsets, and
 * re-offering bytes Google did not confirm deliberately breaks contiguity.
 */
function assembleByOffset(puts: DrivePut[]): { bytes: Uint8Array; declaredTotal: number } {
  const placed: Array<{ start: number; bytes: Uint8Array }> = [];
  let end = 0;

  for (const put of puts) {
    const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(put.contentRange);
    expect(match, `unparseable Content-Range: ${put.contentRange}`).not.toBeNull();
    const [, startStr, endStr] = match as RegExpExecArray;
    const start = Number(startStr);

    expect(Number(endStr) - start + 1).toBe(put.bytes.byteLength);
    placed.push({ start, bytes: put.bytes });
    end = Math.max(end, start + put.bytes.byteLength);
  }

  const merged = new Uint8Array(end);
  for (const { start, bytes } of placed) merged.set(bytes, start);

  const finalTotal = /\/(\d+)$/.exec(puts[puts.length - 1].contentRange);
  return { bytes: merged, declaredTotal: finalTotal ? Number(finalTotal[1]) : -1 };
}

describe('DriveTransferWorkflow HLS recording', () => {
  const userId = 'usr-hls-test';

  beforeAll(async () => {
    await applyMigrations(env.DB);

    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userId, 'sub-hls-test', 'hls@example.com', 'HLS User', null)
      .run();

    const enc = await encryptSecret('refresh-hls-test', env.TOKEN_ENCRYPTION_KEY, userId);
    await env.DB.prepare(
      `INSERT INTO google_credentials (user_id, ciphertext, iv, key_version)
       VALUES (?, ?, ?, ?)`
    )
      .bind(userId, enc.ciphertext, enc.iv, 1)
      .run();

    const tokenHash = await hashOpaqueToken('raw-session-hls-test');
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`
    )
      .bind('sess-hls-test', userId, tokenHash, 'csrf-hls-test')
      .run();
  });

  async function seedJob(
    jobId: string,
    sourceUrl: string,
    hlsDurationSeconds: number | null
  ): Promise<void> {
    const encUrl = await encryptSecret(sourceUrl, env.TOKEN_ENCRYPTION_KEY, userId);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO upload_jobs (
           id, user_id, source_kind, source_url_redacted, source_url_encrypted, source_url_iv,
           filename, file_size, mime_type, status, hls_duration_seconds, version
         ) VALUES (?, ?, 'remote', ?, ?, ?, 'index.m3u8', 0, 'application/octet-stream',
                   'queued', ?, 1)`
      ).bind(jobId, userId, sourceUrl, encUrl.ciphertext, encUrl.iv, hlsDurationSeconds),
      env.DB.prepare(
        `INSERT INTO upload_attempts (id, job_id, user_id, attempt_number, status)
         VALUES (?, ?, ?, 1, 'queued')`
      ).bind(`${jobId}-1`, jobId, userId),
    ]);
  }

  /**
   * A fetch double covering everything the HLS branch touches. `playlists` maps a URL to a body
   * producer so the live case can advance its window on each poll; `segment` synthesises media
   * bytes from the sequence number embedded in the URL.
   */
  function installFetch(config: {
    headContentType: string;
    playlists: Record<string, () => string>;
    segment: (sequence: number) => Uint8Array<ArrayBuffer>;
    driveFileId: string;
    /**
     * How many of an open chunk's bytes Google admits to having stored, defaulting to all of them.
     * A 308 only says the request arrived; the `Range` header is the authoritative count.
     */
    confirmBytes?: (sentLength: number, putIndex: number) => number;
  }): {
    restore: () => void;
    playlistFetches: string[];
    segmentFetches: string[];
    drivePuts: DrivePut[];
    driveMetadata: unknown[];
    unexpected: string[];
  } {
    const originalFetch = globalThis.fetch;
    const playlistFetches: string[] = [];
    const segmentFetches: string[] = [];
    const drivePuts: DrivePut[] = [];
    const driveMetadata: unknown[] = [];
    const unexpected: string[] = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);

      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({ access_token: 'mock-hls-access-token', expires_in: 3600 }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Resumable session start.
      if (url.includes('googleapis.com/upload/drive/v3/files?uploadType=resumable') && !url.includes('upload_id=')) {
        driveMetadata.push(JSON.parse(String(init?.body ?? 'null')));
        return new Response(null, { status: 200, headers: { Location: SESSION_URL } });
      }

      if (url.includes('upload_id=mock-hls-session')) {
        const contentRange = new Headers(init?.headers).get('Content-Range') || '';
        const bytes = await bodyBytes(init);
        const putIndex = drivePuts.length;
        drivePuts.push({ contentRange, bytes });

        // An unknown-size upload stays open until a chunk declares the total.
        if (contentRange.endsWith('/*')) {
          const start = Number(/^bytes (\d+)-/.exec(contentRange)?.[1] ?? 0);
          const confirmed = config.confirmBytes
            ? config.confirmBytes(bytes.byteLength, putIndex)
            : bytes.byteLength;
          return new Response(null, {
            status: 308,
            headers: { Range: `bytes=0-${start + confirmed - 1}` },
          });
        }

        return new Response(
          JSON.stringify({
            id: config.driveFileId,
            webViewLink: `https://drive.google.com/file/d/${config.driveFileId}/view`,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const playlist = config.playlists[url];
      if (playlist) {
        if (init?.method === 'HEAD') {
          return new Response(null, {
            status: 200,
            headers: { 'Content-Type': config.headContentType, 'Content-Length': '183' },
          });
        }
        playlistFetches.push(url);
        return new Response(playlist(), {
          status: 200,
          headers: { 'Content-Type': config.headContentType },
        });
      }

      const sequence = /(?:seg|segment)-(\d+)\.ts$/.exec(new URL(url).pathname);
      if (sequence) {
        segmentFetches.push(url);
        return new Response(config.segment(Number(sequence[1])), {
          status: 200,
          headers: { 'Content-Type': 'video/mp2t' },
        });
      }

      // Anything else is a bug in the workflow or in this double; surface it instead of
      // reaching for the real network.
      unexpected.push(`${init?.method || 'GET'} ${url}`);
      return new Response(null, { status: 598 });
    });

    return {
      restore: () => {
        globalThis.fetch = originalFetch;
      },
      playlistFetches,
      segmentFetches,
      drivePuts,
      driveMetadata,
      unexpected,
    };
  }

  it('uploads the concatenated segments of a VOD playlist, not the playlist itself', async () => {
    const jobId = 'job-hls-vod';
    await seedJob(jobId, VOD_MASTER_URL, 60);

    const mock = installFetch({
      headContentType: 'application/x-mpegURL',
      playlists: {
        [VOD_MASTER_URL]: () => VOD_MASTER,
        [VOD_VARIANT_URL]: () => VOD_VARIANT,
        [VOD_LOW_URL]: () => VOD_VARIANT,
      },
      segment: (sequence) => filled(VOD_SEGMENT_BYTES, 0xa0 + sequence),
      driveFileId: 'drive-file-hls-vod',
    });

    let sizeAfterPrepare = -1;
    const step = {
      do: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
        const result = await fn();
        if (name === 'prepare-transfer') {
          const row = await env.DB.prepare('SELECT file_size FROM upload_jobs WHERE id = ?')
            .bind(jobId)
            .first<{ file_size: number }>();
          sizeAfterPrepare = Number(row?.file_size ?? -1);
        }
        return result;
      },
    };

    try {
      await runDriveTransfer(env, { jobId, userId }, step);

      expect(mock.unexpected).toEqual([]);

      // Preparation resolves master → variant, then the cycle re-reads the variant it was
      // pointed at. The low-bitrate rendition is never fetched: the highest bandwidth wins.
      expect(mock.playlistFetches).toEqual([
        VOD_MASTER_URL,
        VOD_VARIANT_URL,
        VOD_VARIANT_URL,
      ]);
      expect(mock.segmentFetches).toEqual([
        'https://cdn.example.com/vod/seg-1.ts',
        'https://cdn.example.com/vod/seg-2.ts',
        'https://cdn.example.com/vod/seg-3.ts',
      ]);

      // The Drive file is named and typed for the media, never for the playlist.
      expect(mock.driveMetadata).toEqual([
        { name: 'big-buck-bunny.ts', mimeType: 'video/mp2t' },
      ]);

      const upload = assembleDriveUpload(mock.drivePuts);
      expect(upload.bytes.byteLength).toBe(VOD_TOTAL);
      expect(upload.declaredTotal).toBe(VOD_TOTAL);
      expect(runs(upload.bytes)).toEqual([
        [0xa1, VOD_SEGMENT_BYTES],
        [0xa2, VOD_SEGMENT_BYTES],
        [0xa3, VOD_SEGMENT_BYTES],
      ]);

      // One aligned flush of whole blocks, then the remainder committed with the true total.
      expect(mock.drivePuts.map((put) => put.contentRange)).toEqual([
        `bytes 0-${3 * BLOCK - 1}/*`,
        `bytes ${3 * BLOCK}-${VOD_TOTAL - 1}/${VOD_TOTAL}`,
      ]);

      // A size estimate is seeded during preparation so the progress bar has a denominator,
      // then replaced by the byte count that was actually transferred.
      expect(sizeAfterPrepare).toBeGreaterThan(0);

      const job = await env.DB.prepare(
        `SELECT status, filename, mime_type, file_size, progress_bytes, drive_file_id
         FROM upload_jobs WHERE id = ?`
      )
        .bind(jobId)
        .first<{
          status: string;
          filename: string;
          mime_type: string;
          file_size: number;
          progress_bytes: number;
          drive_file_id: string;
        }>();

      expect(job).toEqual({
        status: 'completed',
        filename: 'big-buck-bunny.ts',
        mime_type: 'video/mp2t',
        file_size: VOD_TOTAL,
        progress_bytes: VOD_TOTAL,
        drive_file_id: 'drive-file-hls-vod',
      });

      const attempt = await env.DB.prepare(
        'SELECT status, bytes_transferred FROM upload_attempts WHERE job_id = ?'
      )
        .bind(jobId)
        .first<{ status: string; bytes_transferred: number }>();
      expect(attempt).toEqual({ status: 'completed', bytes_transferred: VOD_TOTAL });

      // The carried remainder is cleaned up once the file is committed.
      expect(await env.UPLOADS.get(`hls-tail/${userId}/${jobId}`)).toBeNull();
    } finally {
      mock.restore();
    }
  });

  it('re-offers the bytes Google did not confirm instead of skipping past them', async () => {
    const jobId = 'job-hls-partial';
    // Aimed at the flush loop: three 4.1 MiB segments make ~12.3 MiB of flushable blocks, which is
    // more than one 8 MiB chunk, so there is a second chunk for a mis-tracked offset to land in.
    const segmentBytes = 4_300_000;
    const total = segmentBytes * 3;
    const flushable = Math.floor(total / BLOCK) * BLOCK;
    const shortfallAt = 4 * 1024 * 1024; // Aligned, which is all Drive ever commits.

    await seedJob(jobId, VOD_VARIANT_URL, 60);

    const mock = installFetch({
      headContentType: 'application/x-mpegURL',
      playlists: { [VOD_VARIANT_URL]: () => VOD_VARIANT },
      segment: (sequence) => filled(segmentBytes, 0xa0 + sequence),
      driveFileId: 'drive-file-hls-partial',
      // Google stores 4 MiB of the first 8 MiB chunk and says so. The rest of that chunk was
      // never written and has to be sent again.
      confirmBytes: (sentLength, putIndex) => (putIndex === 0 ? shortfallAt : sentLength),
    });

    try {
      await runDriveTransfer(env, { jobId, userId }, { do: (_name, fn) => fn() });

      expect(mock.unexpected).toEqual([]);

      // The second request picks up at the confirmed offset, not at the end of what was offered.
      // Advancing the read cursor by the full chunk instead would drop 4 MiB from the middle of
      // the file and leave every later range declaring an offset below the bytes it carries.
      expect(mock.drivePuts.map((put) => put.contentRange)).toEqual([
        `bytes 0-${8 * 1024 * 1024 - 1}/*`,
        `bytes ${shortfallAt}-${shortfallAt + 8 * 1024 * 1024 - 1}/*`,
        `bytes ${shortfallAt + 8 * 1024 * 1024}-${flushable - 1}/*`,
        `bytes ${flushable}-${total - 1}/${total}`,
      ]);

      const upload = assembleByOffset(mock.drivePuts);
      expect(upload.declaredTotal).toBe(total);
      expect(upload.bytes.byteLength).toBe(total);
      expect(runs(upload.bytes)).toEqual([
        [0xa1, segmentBytes],
        [0xa2, segmentBytes],
        [0xa3, segmentBytes],
      ]);

      const job = await env.DB.prepare(
        'SELECT status, file_size, progress_bytes FROM upload_jobs WHERE id = ?'
      )
        .bind(jobId)
        .first<{ status: string; file_size: number; progress_bytes: number }>();
      expect(job).toEqual({ status: 'completed', file_size: total, progress_bytes: total });
    } finally {
      mock.restore();
    }
  });

  it('records a live playlist across polls and stops at the duration cap', async () => {
    const jobId = 'job-hls-live';
    const durationSeconds = 60;
    await seedJob(jobId, LIVE_MASTER_URL, durationSeconds);

    let windowIndex = 0;
    const mock = installFetch({
      headContentType: 'application/vnd.apple.mpegurl',
      playlists: {
        [LIVE_MASTER_URL]: () => LIVE_MASTER,
        [LIVE_VARIANT_URL]: () => liveWindow(windowIndex++),
      },
      segment: (sequence) => filled(LIVE_SEGMENT_BYTES, liveFillFor(sequence)),
      driveFileId: 'drive-file-hls-live',
    });

    const sleeps: string[] = [];
    const cycleNames: string[] = [];
    const step = {
      do: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
        if (name.startsWith('hls-')) cycleNames.push(name);
        return fn();
      },
      sleep: async (_name: string, duration: string): Promise<void> => {
        sleeps.push(duration);
      },
    };

    try {
      await runDriveTransfer(env, { jobId, userId }, step);

      expect(mock.unexpected).toEqual([]);

      // The window advances by its own length each poll, so the cap is reached after three
      // cycles of 4 × 5 s, with a wait between cycles but none after the last.
      const expectedSegments = durationSeconds / LIVE_SEGMENT_SECONDS;
      expect(mock.segmentFetches).toHaveLength(expectedSegments);
      expect(cycleNames).toEqual(['hls-cycle-1', 'hls-cycle-2', 'hls-cycle-3', 'hls-commit']);
      expect(sleeps).toEqual([
        `${LIVE_POLL_SECONDS} seconds`,
        `${LIVE_POLL_SECONDS} seconds`,
      ]);

      // Recording begins at the live edge, i.e. the window that was current when the first
      // cycle polled — not the one preparation happened to see.
      const firstRecorded = LIVE_FIRST_SEQUENCE + LIVE_WINDOW_LENGTH;
      expect(mock.segmentFetches[0]).toBe(
        `https://cdn.example.com/live/streamkey/tracks-v1a1/segment-${firstRecorded}.ts`
      );

      const total = expectedSegments * LIVE_SEGMENT_BYTES;
      const upload = assembleDriveUpload(mock.drivePuts);

      // Four separate requests, so this also proves the sub-block remainder survives the step
      // boundary intact: any loss or repeat would shift the run lengths below.
      expect(mock.drivePuts.length).toBeGreaterThan(2);
      expect(upload.bytes.byteLength).toBe(total);
      expect(upload.declaredTotal).toBe(total);
      expect(runs(upload.bytes)).toEqual(
        Array.from({ length: expectedSegments }, (_unused, i) => [
          liveFillFor(firstRecorded + i),
          LIVE_SEGMENT_BYTES,
        ])
      );

      const job = await env.DB.prepare(
        `SELECT status, filename, mime_type, file_size, progress_bytes, drive_file_id
         FROM upload_jobs WHERE id = ?`
      )
        .bind(jobId)
        .first<{
          status: string;
          filename: string;
          mime_type: string;
          file_size: number;
          progress_bytes: number;
          drive_file_id: string;
        }>();

      expect(job?.status).toBe('completed');
      expect(job?.mime_type).toBe('video/mp2t');
      expect(job?.file_size).toBe(total);
      expect(job?.progress_bytes).toBe(total);
      expect(job?.drive_file_id).toBe('drive-file-hls-live');
      // A live capture is stamped so repeat recordings of one stream stay distinct.
      expect(job?.filename).toMatch(
        /^tracks-v1a1_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.ts$/
      );

      expect(await env.UPLOADS.get(`hls-tail/${userId}/${jobId}`)).toBeNull();
    } finally {
      mock.restore();
    }
  });

  it('stops a live recording on cancellation and discards the buffered remainder', async () => {
    const jobId = 'job-hls-cancel';
    await seedJob(jobId, LIVE_MASTER_URL, 600);

    let windowIndex = 0;
    const mock = installFetch({
      headContentType: 'application/x-mpegURL',
      playlists: {
        [LIVE_MASTER_URL]: () => LIVE_MASTER,
        [LIVE_VARIANT_URL]: () => liveWindow(windowIndex++),
      },
      segment: (sequence) => filled(LIVE_SEGMENT_BYTES, liveFillFor(sequence)),
      driveFileId: 'drive-file-hls-cancel',
    });

    const step = {
      do: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
        const result = await fn();
        if (name === 'hls-cycle-1') {
          // The user pressed cancel while the first poll was in flight.
          await env.DB.prepare(
            `UPDATE upload_jobs SET status = 'cancel_requested', version = version + 1
             WHERE id = ?`
          )
            .bind(jobId)
            .run();
        }
        return result;
      },
      sleep: async (): Promise<void> => undefined,
    };

    try {
      await runDriveTransfer(env, { jobId, userId }, step);

      expect(mock.unexpected).toEqual([]);

      // Exactly one cycle ran, and the session was never committed, so no Drive file exists.
      expect(mock.segmentFetches).toHaveLength(LIVE_WINDOW_LENGTH);
      expect(mock.drivePuts.every((put) => put.contentRange.endsWith('/*'))).toBe(true);

      const job = await env.DB.prepare(
        'SELECT status, drive_file_id FROM upload_jobs WHERE id = ?'
      )
        .bind(jobId)
        .first<{ status: string; drive_file_id: string | null }>();
      const attempt = await env.DB.prepare(
        'SELECT status, finished_at FROM upload_attempts WHERE job_id = ? AND attempt_number = 1'
      )
        .bind(jobId)
        .first<{ status: string; finished_at: string | null }>();

      expect(job).toEqual({ status: 'canceled', drive_file_id: null });
      expect(attempt?.status).toBe('canceled');
      expect(attempt?.finished_at).not.toBeNull();

      // The parked remainder is R2 storage the user is no longer paying for a reason.
      expect(await env.UPLOADS.get(`hls-tail/${userId}/${jobId}`)).toBeNull();
    } finally {
      mock.restore();
    }
  });

  it('fails without a Drive file when the playlist is DRM-protected', async () => {
    const jobId = 'job-hls-drm';
    const drmUrl = 'https://cdn.example.com/drm/index.m3u8';
    await seedJob(jobId, drmUrl, null);

    const mock = installFetch({
      headContentType: 'application/x-mpegURL',
      playlists: {
        [drmUrl]: () => `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key",KEYFORMAT="com.apple.streamingkeydelivery"
#EXTINF:6.000,
seg-1.ts
#EXT-X-ENDLIST
`,
      },
      segment: (sequence) => filled(VOD_SEGMENT_BYTES, 0xa0 + sequence),
      driveFileId: 'drive-file-hls-drm',
    });

    try {
      const step = { do: async <T>(_name: string, fn: () => Promise<T>) => fn() };
      await expect(runDriveTransfer(env, { jobId, userId }, step)).rejects.toMatchObject({
        code: 'HLS_ENCRYPTION_UNSUPPORTED',
      });

      // Nothing was uploaded and no segment was even requested.
      expect(mock.driveMetadata).toEqual([]);
      expect(mock.drivePuts).toEqual([]);
      expect(mock.segmentFetches).toEqual([]);

      const job = await env.DB.prepare(
        'SELECT status, error_code, drive_file_id FROM upload_jobs WHERE id = ?'
      )
        .bind(jobId)
        .first<{ status: string; error_code: string; drive_file_id: string | null }>();

      expect(job).toEqual({
        status: 'failed',
        error_code: 'HLS_ENCRYPTION_UNSUPPORTED',
        drive_file_id: null,
      });
    } finally {
      mock.restore();
    }
  });
});
