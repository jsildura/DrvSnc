import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { Env } from '../env';
import { decryptSecret } from '../services/crypto';
import {
  startResumableUpload,
  uploadChunk,
  queryResumableOffset,
  finalizeUnknownSizeUpload,
} from '../services/driveClient';
import { fetchRemoteWithPolicy } from '../services/remoteUrlPolicy';
import { guessMimeFromFilename } from '../services/remoteFilename';
import { deleteR2Object } from '../services/r2Multipart';
import { isTerminalStatus, UploadJobStatus } from '../../shared/jobState';
import {
  isHlsUrl,
  parsePlaylist,
  selectVariant,
  deriveHlsFilename,
  hlsMimeType,
  HlsError,
  HlsContainer,
  HlsMediaPlaylist,
  HlsSegment,
} from '../services/hlsPlaylist';
import { fetchPlaylistText, fetchSegment, HlsKeyCache } from '../services/hlsFetcher';

const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB bounded chunks

/**
 * Google accepts a resumable chunk of unknown total length only when it is a multiple of
 * 256 KiB, so an HLS recording flushes in whole blocks and carries the remainder forward.
 */
const DRIVE_BLOCK_SIZE = 256 * 1024;

/** Live recordings default to ten minutes when the caller does not say. */
const DEFAULT_HLS_DURATION_SECONDS = 600;

/**
 * A live playlist advertises only a short window of segments. Polling must be frequent enough
 * that nothing ages out between cycles, so the interval is the window minus one segment.
 */
const MIN_POLL_SECONDS = 2;
const MAX_POLL_SECONDS = 30;

/**
 * How much one cycle buffers before it stops pulling segments and flushes. A long VOD playlist
 * lists everything at once, and a Worker cannot hold all of it, so the rest waits for the
 * next step.
 */
const MAX_CYCLE_BYTES = 24 * 1024 * 1024;

/** Consecutive polls returning nothing new before a live recording is treated as ended. */
const STALL_LIMIT = 4;

/** Backstop against a runaway recording exhausting the workflow's step budget. */
const MAX_HLS_CYCLES = 720;

export class TransferError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'TransferError';
  }
}

export interface TransferPayload {
  jobId: string;
  userId: string;
  attemptNumber?: number;
}

export interface StepRunner {
  do: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  /**
   * Optional so the plain `{ do }` doubles in the worker tests still satisfy the interface;
   * without it an HLS recording polls back-to-back instead of waiting for the window to refill.
   *
   * The duration is narrowed to seconds so a real `WorkflowStep` — whose own parameter is a
   * template literal union — remains assignable here.
   */
  sleep?: (name: string, duration: `${number} seconds`) => Promise<void>;
}

/** Everything the HLS branch needs that the generic remote branch does not. */
interface HlsPrep {
  /** Media playlist URL — already resolved through any master playlist. */
  mediaPlaylistUrl: string;
  isLive: boolean;
  container: HlsContainer;
  targetDuration: number;
  pollSeconds: number;
  durationSeconds: number;
  initSegmentUrl: string | null;
}

type PrepResult =
  | { kind: 'canceled' }
  | { kind: 'terminal' }
  | {
      kind: 'ready';
      sessionUrl: string;
      totalSize: number;
      sourceKind: string;
      r2ObjectKey: string | null;
      sourceUrl: string;
      filename: string;
      hls: HlsPrep | null;
    };

type ChunkResult =
  | { completed: false; bytesTransferred: number }
  | {
      completed: true;
      bytesTransferred: number;
      googleFile: { id: string; webViewLink?: string };
    };

/**
 * Google answers an incomplete resumable chunk with `308` and a
 * `Range: bytes=0-<lastByte>` header naming the last byte it actually stored.
 * That is authoritative — the request may have been truncated — so prefer it
 * over assuming the whole chunk landed.
 */
function confirmedBytes(rangeHeader: string | null, offset: number, sentLength: number): number {
  if (!rangeHeader) return sentLength;
  const match = /bytes=0-(-?\d+)/.exec(rangeHeader);
  if (!match) return sentLength;
  const lastByte = parseInt(match[1], 10);
  if (!Number.isFinite(lastByte)) return sentLength;
  const accepted = lastByte + 1 - offset;
  if (accepted <= 0 || accepted > sentLength) return sentLength;
  return accepted;
}

/**
 * Walk a playlist URL down to the media playlist that actually lists segments, following at most
 * one level of master playlist (which is all RFC 8216 allows).
 *
 * `bandwidth` is the selected variant's advertised bitrate, or 0 when the URL was already a media
 * playlist and therefore advertises nothing.
 */
async function resolveMediaPlaylist(
  playlistUrl: string
): Promise<{ url: string; playlist: HlsMediaPlaylist; bandwidth: number }> {
  const parsed = parsePlaylist(await fetchPlaylistText(playlistUrl), playlistUrl);

  if (parsed.kind === 'media') {
    return { url: playlistUrl, playlist: parsed, bandwidth: 0 };
  }

  const variant = selectVariant(parsed.variants);
  const nested = parsePlaylist(await fetchPlaylistText(variant.url), variant.url);

  if (nested.kind !== 'media') {
    throw new HlsError(
      'HLS_NESTED_MASTER',
      'The selected HLS variant is another master playlist, which is not supported'
    );
  }

  return { url: variant.url, playlist: nested, bandwidth: variant.bandwidth };
}

/**
 * Bytes a recording is expected to produce, used purely to give the progress bar in the job list
 * something to measure against. Corrected to the real byte count once the recording ends.
 */
function estimateSize(bandwidthBitsPerSecond: number, seconds: number): number {
  const bandwidth = bandwidthBitsPerSecond > 0 ? bandwidthBitsPerSecond : 3_000_000;
  return Math.max(1, Math.round((bandwidth / 8) * seconds));
}

/**
 * The stored filename came from the playlist URL (or from what the user typed), so it usually ends
 * in `.m3u8` — a name that would be a lie on a video file. Replace a playlist name outright, but
 * keep a name the user chose and only correct its extension to match the container.
 */
function hlsOutputFilename(
  stored: string,
  playlistUrl: string,
  container: HlsContainer,
  recordedAt?: Date
): string {
  if (!stored || /\.(m3u8|m3u)$/i.test(stored)) {
    return deriveHlsFilename(playlistUrl, container, recordedAt);
  }
  const base = stored.replace(/\.[^./\\]{1,8}$/, '');
  return `${base}.${container === 'fmp4' ? 'mp4' : 'ts'}`;
}

/** State an HLS cycle hands to its successor. Small and JSON-serialisable for step persistence. */
interface HlsCycleState {
  /** Media sequence number the next cycle resumes from; -1 before the first cycle has run. */
  nextSequence: number;
  /** Bytes Google has accepted so far — the authoritative resumable offset. */
  driveOffset: number;
  /** Length of the sub-block remainder parked in R2. */
  tailLength: number;
  /** Segments that aged out of the live window before they could be fetched. */
  gaps: number;
  /** Media seconds captured, summed from `#EXTINF` — what the duration cap measures. */
  secondsRecorded: number;
  /** The playlist carried `#EXT-X-ENDLIST`, so no further segments will ever appear. */
  endList: boolean;
  /** Segments still listed from `nextSequence` on — non-zero when a cycle hit its byte budget. */
  remaining: number;
  /** Segments this cycle actually downloaded. Zero means the live edge has not moved. */
  consumed: number;
}

/**
 * Record an HLS stream into an already-open Drive resumable session.
 *
 * One `step.do` per poll cycle: read the carried tail, pull whatever segments are new, push
 * 256 KiB-aligned blocks to Drive, and park the remainder back in R2. Only small JSON crosses the
 * step boundary, and because the Drive offset is read back from the durable cycle state rather
 * than from local variables, a retried step re-PUTs the identical byte range — which a resumable
 * session treats as a no-op.
 */
async function runHlsRecording(
  env: Env,
  step: StepRunner,
  context: {
    sessionUrl: string;
    hls: HlsPrep;
    tailKey: string;
    isCanceled: () => Promise<boolean>;
    onProgress: (bytes: number) => Promise<void>;
  }
): Promise<
  | { canceled: true }
  | { canceled: false; totalBytes: number; googleFile: { id: string; webViewLink?: string } }
> {
  const { hls, tailKey, sessionUrl } = context;

  // A VOD playlist is bounded by its own segment list, so only a live recording needs a cycle
  // budget derived from the duration cap.
  const maxCycles = hls.isLive
    ? Math.min(MAX_HLS_CYCLES, Math.ceil(hls.durationSeconds / hls.pollSeconds) + STALL_LIMIT + 2)
    : MAX_HLS_CYCLES;

  let state: HlsCycleState = {
    nextSequence: -1,
    driveOffset: 0,
    tailLength: 0,
    gaps: 0,
    secondsRecorded: 0,
    endList: false,
    remaining: 0,
    consumed: 0,
  };
  let stalledPolls = 0;

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    if (await context.isCanceled()) {
      return { canceled: true };
    }

    const previous = state;
    state = await step.do(`hls-cycle-${cycle}`, async (): Promise<HlsCycleState> => {
      const playlist = parsePlaylist(
        await fetchPlaylistText(hls.mediaPlaylistUrl),
        hls.mediaPlaylistUrl
      );
      if (playlist.kind !== 'media') {
        throw new HlsError('HLS_INVALID_PLAYLIST', 'The HLS variant stopped listing segments');
      }

      const startFrom = previous.nextSequence;
      let gaps = previous.gaps;
      let available: HlsSegment[];

      if (startFrom < 0) {
        // A live stream starts at whatever the window holds — that is the live edge. A VOD
        // playlist lists everything from the beginning, so this is also its natural head.
        available = playlist.segments;
      } else {
        available = playlist.segments.filter((segment) => segment.sequence >= startFrom);
        const oldestAvailable = playlist.segments[0]?.sequence ?? startFrom;
        if (oldestAvailable > startFrom) {
          // Segments expired out of the window before we reached them. That is a discontinuity
          // in the output, not a corrupt file, so count it and keep recording.
          gaps += oldestAvailable - startFrom;
        }
      }

      const buffers: Uint8Array[] = [];
      let buffered = 0;

      const append = (bytes: Uint8Array): void => {
        buffers.push(bytes);
        buffered += bytes.byteLength;
      };

      if (previous.tailLength > 0) {
        const carried = await env.UPLOADS.get(tailKey);
        if (!carried) {
          throw new TransferError(
            'HLS_TAIL_LOST',
            'The buffered remainder of the HLS recording is no longer available'
          );
        }
        append(new Uint8Array(await carried.arrayBuffer()));
      }

      const keyCache = new HlsKeyCache();

      // fMP4 output only plays if the initialisation segment leads the file.
      if (startFrom < 0 && hls.initSegmentUrl) {
        append(await fetchSegment(hls.initSegmentUrl, { sequence: 0, key: null, keyCache }));
      }

      let consumed = 0;
      let secondsRecorded = previous.secondsRecorded;
      let lastSequence = -1;

      for (const segment of available) {
        append(
          await fetchSegment(segment.url, {
            byteRange: segment.byteRange,
            key: segment.key,
            sequence: segment.sequence,
            keyCache,
          })
        );
        consumed++;
        lastSequence = segment.sequence;
        secondsRecorded += segment.duration > 0 ? segment.duration : hls.targetDuration;

        // Hand the rest to the next cycle rather than holding a whole VOD in memory.
        if (buffered >= MAX_CYCLE_BYTES) break;

        // Stop a live recording on the cap mid-window instead of overshooting by a full poll.
        if (hls.isLive && secondsRecorded >= hls.durationSeconds) break;
      }

      const merged = concatBuffers(buffers, buffered);

      // Google rejects an unaligned chunk of an unknown-length upload, so only whole 256 KiB
      // blocks go out and the remainder is carried forward.
      const flushable = Math.floor(merged.byteLength / DRIVE_BLOCK_SIZE) * DRIVE_BLOCK_SIZE;
      let offset = previous.driveOffset;
      let flushed = 0;

      while (flushed < flushable) {
        const chunk = merged.subarray(flushed, Math.min(flushed + CHUNK_SIZE, flushable));
        const res = await uploadChunk(sessionUrl, toArrayBuffer(chunk), offset, '*');

        if (res.status !== 308) {
          throw new TransferError(
            'DRIVE_CHUNK_REJECTED',
            `Google Drive rejected an HLS chunk with status ${res.status}`
          );
        }

        // A 308 says only that the request arrived, not that all of it was stored. The read cursor
        // has to follow the confirmed count rather than the offered one: advancing it by the full
        // chunk would drop the shortfall and leave every later chunk declaring an offset lower
        // than the bytes it carries, which Drive stores as a silently corrupt file.
        const accepted = confirmedBytes(res.headers.get('Range'), offset, chunk.byteLength);
        if (accepted <= 0) {
          throw new TransferError(
            'TRANSFER_STALLED',
            `Google Drive accepted none of the ${chunk.byteLength} bytes offered at offset ${offset}`
          );
        }

        offset += accepted;
        flushed += accepted;

        // An aligned shortfall just re-offers the rest on the next pass. A partial block cannot:
        // the next chunk would start mid-block, and the final one would then be unaligned and be
        // refused. Leave it to the carried tail, which exists for exactly this remainder.
        if (accepted % DRIVE_BLOCK_SIZE !== 0) break;
      }

      const tail = merged.subarray(flushed);
      if (tail.byteLength > 0) {
        await env.UPLOADS.put(tailKey, toArrayBuffer(tail));
      } else if (previous.tailLength > 0) {
        await env.UPLOADS.delete(tailKey);
      }

      const nextSequence = consumed > 0 ? lastSequence + 1 : Math.max(startFrom, 0);

      return {
        nextSequence,
        driveOffset: offset,
        tailLength: tail.byteLength,
        gaps,
        secondsRecorded,
        endList: !playlist.isLive,
        remaining: playlist.segments.filter((segment) => segment.sequence >= nextSequence).length,
        consumed,
      };
    });

    await context.onProgress(state.driveOffset + state.tailLength);

    // The source said there will be no more segments and none are left unread.
    if (state.endList && state.remaining === 0) break;

    if (hls.isLive && state.secondsRecorded >= hls.durationSeconds) break;

    if (state.consumed === 0) {
      // A live playlist that stops advancing has ended, however abruptly.
      if (++stalledPolls >= STALL_LIMIT) break;
    } else {
      stalledPolls = 0;
    }

    // Only wait when the window is drained; a cycle cut short by its byte budget has work queued.
    if (state.remaining === 0 && step.sleep) {
      await step.sleep(`hls-wait-${cycle}`, `${hls.pollSeconds} seconds`);
    }
  }

  if (state.gaps > 0) {
    console.log(
      JSON.stringify({
        event: 'hls_recording_gaps',
        segments: state.gaps,
        playlist: hls.mediaPlaylistUrl,
      })
    );
  }

  const totalBytes = state.driveOffset + state.tailLength;
  if (totalBytes === 0) {
    throw new TransferError(
      'HLS_NO_MEDIA_CAPTURED',
      'No media segments could be downloaded from the HLS stream'
    );
  }

  // The commit is what tells Google the real length, so it has to be a step of its own:
  // re-running it after a mid-flight failure is safe, since a completed session answers a
  // repeated request with the same file metadata.
  const finalState = state;
  const googleFile = await step.do(
    'hls-commit',
    async (): Promise<{ id: string; webViewLink?: string }> => {
      let res: Response;

      if (finalState.tailLength > 0) {
        const tailObj = await env.UPLOADS.get(tailKey);
        if (!tailObj) {
          throw new TransferError(
            'HLS_TAIL_LOST',
            'The buffered remainder of the HLS recording is no longer available'
          );
        }
        res = await uploadChunk(
          sessionUrl,
          await tailObj.arrayBuffer(),
          finalState.driveOffset,
          totalBytes
        );
      } else {
        // The recording landed on an exact block boundary, so every byte is already stored and
        // all that is left is to declare the length.
        res = await finalizeUnknownSizeUpload(sessionUrl, totalBytes);
      }

      if (res.status !== 200 && res.status !== 201) {
        throw new TransferError(
          'DRIVE_HLS_COMMIT_REJECTED',
          `Google Drive rejected the HLS upload commit with status ${res.status}`
        );
      }

      return (await res.json()) as { id: string; webViewLink?: string };
    }
  );

  return { canceled: false, totalBytes, googleFile };
}

/**
 * Where a cycle parks the sub-block remainder it could not flush to Drive yet. Derived from the
 * payload alone so the failure handler can clean it up without reaching into the recording's scope.
 */
function hlsTailKey(userId: string, jobId: string): string {
  return `hls-tail/${userId}/${jobId}`;
}

function concatBuffers(parts: Uint8Array[], total: number): Uint8Array {
  const merged = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    merged.set(part, at);
    at += part.byteLength;
  }
  return merged;
}

/** A view over a larger buffer has to be copied before it can be sent as a request body. */
function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.slice().buffer;
}

export async function runDriveTransfer(
  env: Env,
  payload: TransferPayload,
  step: StepRunner
): Promise<void> {
  const { jobId, userId } = payload;
  const attemptNumber = payload.attemptNumber ?? 1;

  const markCanceled = async (): Promise<void> => {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE upload_jobs
         SET status = 'canceled', updated_at = ?, version = version + 1
         WHERE id = ? AND user_id = ?
           AND status IN ('staging', 'queued', 'fetching', 'uploading', 'cancel_requested')`
      ).bind(now, jobId, userId),
      env.DB.prepare(
        `UPDATE upload_attempts
         SET status = 'canceled', finished_at = ?
         WHERE job_id = ? AND attempt_number = ?
           AND status NOT IN ('completed', 'failed', 'canceled')`
      ).bind(now, jobId, attemptNumber),
    ]);
  };

  try {
    // Step 1: Preparation & Resumable Session Start
    const prep = await step.do('prepare-transfer', async (): Promise<PrepResult> => {
      const job = await env.DB.prepare(
        'SELECT * FROM upload_jobs WHERE id = ? AND user_id = ?'
      )
        .bind(jobId, userId)
        .first<{
          id: string;
          user_id: string;
          source_kind: string;
          source_url_encrypted: string | null;
          source_url_iv: string | null;
          r2_object_key: string | null;
          filename: string;
          file_size: number;
          mime_type: string;
          destination_folder_id: string | null;
          hls_duration_seconds: number | null;
          status: string;
          version: number;
        }>();

      if (!job) {
        throw new Error(`Upload job ${jobId} not found`);
      }

      if (job.status === 'cancel_requested' || job.status === 'canceled') {
        await markCanceled();
        return { kind: 'canceled' };
      }

      if (isTerminalStatus(job.status as UploadJobStatus)) {
        return { kind: 'terminal' };
      }

      let sourceUrl = '';
      let totalSize = Number(job.file_size || 0);
      let mimeType = job.mime_type || 'application/octet-stream';
      let filename = job.filename;
      let probedContentType: string | null = null;
      // A signed delivery link that has expired, or that is bound to the IP address which created
      // it, answers every probe with 401/403. Remembered here so the failure can say so instead of
      // reporting the missing size it causes.
      let deniedStatus: number | null = null;

      if (job.source_kind === 'remote' && job.source_url_encrypted && job.source_url_iv) {
        sourceUrl = await decryptSecret(
          job.source_url_encrypted,
          job.source_url_iv,
          env.TOKEN_ENCRYPTION_KEY,
          userId
        );

        if (totalSize === 0) {
          try {
            const probe = await fetchRemoteWithPolicy(sourceUrl, { method: 'HEAD' });

            // An error page has a Content-Length and a Content-Type of its own. Adopting them
            // would size the upload to the length of the refusal and label the video text/html,
            // so only a successful probe is allowed to describe the file.
            if (probe.ok) {
              const cl = probe.headers.get('Content-Length');
              if (cl) totalSize = parseInt(cl, 10);
              const ct = probe.headers.get('Content-Type');
              if (ct) {
                probedContentType = ct;
                mimeType = ct;
              }
            } else if (probe.status === 401 || probe.status === 403) {
              // Some delivery endpoints refuse HEAD specifically, so this is not yet fatal — the
              // ranged GET below decides.
              deniedStatus = probe.status;
            }
          } catch (_err) {
            // Probe failed, fallback
          }
        }
      }

      // An HLS playlist is an index, not a file: what the HEAD probe measured is a few hundred
      // bytes of text. Resolve it to its media playlist and record the segments instead.
      let hls: HlsPrep | null = null;

      if (job.source_kind === 'remote' && isHlsUrl(sourceUrl, probedContentType)) {
        const resolved = await resolveMediaPlaylist(sourceUrl);
        const playlist = resolved.playlist;
        const durationSeconds = job.hls_duration_seconds || DEFAULT_HLS_DURATION_SECONDS;

        // A live window holds only a handful of segments. Polling has to come round again before
        // the oldest of them expires, so the interval is the window minus one segment.
        const pollSeconds = Math.max(
          MIN_POLL_SECONDS,
          Math.min(
            MAX_POLL_SECONDS,
            Math.round(playlist.targetDuration * Math.max(1, playlist.segments.length - 1))
          )
        );

        hls = {
          mediaPlaylistUrl: resolved.url,
          isLive: playlist.isLive,
          container: playlist.container,
          targetDuration: playlist.targetDuration,
          pollSeconds,
          durationSeconds,
          initSegmentUrl: playlist.initSegment?.url ?? null,
        };

        mimeType = hlsMimeType(playlist.container);
        filename = hlsOutputFilename(
          job.filename,
          resolved.url,
          playlist.container,
          playlist.isLive ? new Date() : undefined
        );

        // The true length is only known once the recording ends. Seed an estimate so the
        // progress bar has a denominator; finalize replaces it with the byte count.
        const vodSeconds = playlist.segments.reduce(
          (sum, segment) => sum + (segment.duration > 0 ? segment.duration : playlist.targetDuration),
          0
        );
        totalSize = estimateSize(
          resolved.bandwidth,
          playlist.isLive ? durationSeconds : vodSeconds
        );
      }

      if (!hls && job.source_kind === 'remote' && (!Number.isFinite(totalSize) || totalSize <= 0)) {
        // Generated downloads (Seedr's folder zips, for one) answer HEAD without a
        // Content-Length. Asking for a single byte gets the total from the 206's
        // Content-Range instead, which is all the chunk loop needs to get going.
        try {
          const ranged = await fetchRemoteWithPolicy(sourceUrl, {
            headers: { Range: 'bytes=0-0' },
          });
          if (ranged.status === 401 || ranged.status === 403) {
            deniedStatus = ranged.status;
          } else {
            const contentRange = ranged.headers.get('Content-Range');
            const declaredTotal = contentRange?.match(/\/\s*(\d+)\s*$/);
            if (declaredTotal) totalSize = parseInt(declaredTotal[1], 10);
            const ct = ranged.headers.get('Content-Type');
            if (ct && mimeType === 'application/octet-stream') mimeType = ct;
          }
          // Never read the body: a server that ignored the Range is answering
          // with the whole file.
          await ranged.body?.cancel().catch(() => undefined);
        } catch (_err) {
          // Falls through to REMOTE_SIZE_UNKNOWN below
        }

        if (!Number.isFinite(totalSize) || totalSize <= 0) {
          if (deniedStatus) {
            throw new TransferError(
              'REMOTE_ACCESS_DENIED',
              `The remote server refused this link (HTTP ${deniedStatus}). Signed download links ` +
                'usually expire within a few hours and are often tied to the IP address that ' +
                'created them, so copy a fresh link and try again.'
            );
          }

          throw new TransferError(
            'REMOTE_SIZE_UNKNOWN',
            'The remote server did not provide a valid file size'
          );
        }
      }

      // A delivery script that answers with a generic type would have Drive store a playable video
      // as an unopenable blob, so the extension gets the final word when the header says nothing.
      if (job.source_kind === 'remote' && !hls && mimeType === 'application/octet-stream') {
        mimeType = guessMimeFromFilename(filename) ?? mimeType;
      }

      // Start Google Drive resumable upload session
      const sessionUrl = await startResumableUpload(env, userId, {
        name: filename,
        mimeType,
        folderId: job.destination_folder_id || undefined,
      });

      const now = new Date().toISOString();
      await env.DB.prepare(
        `UPDATE upload_jobs
         SET status = 'uploading', resumable_upload_uri = ?, file_size = ?, mime_type = ?,
             filename = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND version = ?`
      )
        .bind(sessionUrl, totalSize, mimeType, filename, now, jobId, job.version)
        .run();

      return {
        kind: 'ready',
        sessionUrl,
        totalSize,
        sourceKind: job.source_kind,
        r2ObjectKey: job.r2_object_key,
        sourceUrl,
        filename,
        hls,
      };
    });

    if (prep.kind !== 'ready') {
      return;
    }

    const { sessionUrl, totalSize, sourceKind, r2ObjectKey, sourceUrl, hls } = prep;

    const isCanceled = async (): Promise<boolean> => {
      const current = await env.DB.prepare('SELECT status FROM upload_jobs WHERE id = ?')
        .bind(jobId)
        .first<{ status: string }>();
      return current?.status === 'cancel_requested' || current?.status === 'canceled';
    };

    const recordProgress = async (bytes: number): Promise<void> => {
      await env.DB.prepare(
        `UPDATE upload_jobs
         SET progress_bytes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
        .bind(bytes, jobId)
        .run();
    };

    let completedGoogleFile: { id: string; webViewLink?: string } | null = null;
    // The byte count credited to the attempt. An HLS recording only learns its own length at
    // the end, so the estimate written during preparation is replaced then.
    let transferredSize = totalSize;

    if (hls) {
      // Step 2 (HLS): poll the playlist and stream segments into the open Drive session.
      const tailKey = hlsTailKey(userId, jobId);
      const recording = await runHlsRecording(env, step, {
        sessionUrl,
        hls,
        tailKey,
        isCanceled,
        onProgress: recordProgress,
      });

      if (recording.canceled) {
        await markCanceled();
        await deleteR2Object(env, tailKey);
        return;
      }

      await env.DB.prepare(
        `UPDATE upload_jobs
         SET file_size = ?, progress_bytes = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
        .bind(recording.totalBytes, recording.totalBytes, jobId)
        .run();

      await deleteR2Object(env, tailKey);
      completedGoogleFile = recording.googleFile;
      transferredSize = recording.totalBytes;
    } else {
      let offset = 0;

      // Check existing Google offset if resuming
      try {
        if (totalSize > 0) {
          offset = await queryResumableOffset(sessionUrl, totalSize);
        }
      } catch (_err) {
        offset = 0;
      }

      let chunkIndex = Math.floor(offset / CHUNK_SIZE);

      // Step 2: Bounded Chunk Transfers
      while (offset < totalSize) {
        const currentChunkLength = Math.min(CHUNK_SIZE, totalSize - offset);
        const chunkNumber = chunkIndex + 1;

        // Check cancellation before chunk transfer
        if (await isCanceled()) {
          await markCanceled();

          if (r2ObjectKey) {
            await deleteR2Object(env, r2ObjectKey);
          }
          return;
        }

        const chunkResult = await step.do(
          `upload-chunk-${chunkNumber}`,
          async (): Promise<ChunkResult> => {
            let chunkBytes: ArrayBuffer;

            if (sourceKind === 'local' && r2ObjectKey) {
              const r2Obj = await env.UPLOADS.get(r2ObjectKey, {
                range: { offset, length: currentChunkLength },
              });
              if (!r2Obj) {
                throw new Error(`R2 staging object ${r2ObjectKey} not found`);
              }
              chunkBytes = await r2Obj.arrayBuffer();
            } else {
              const remoteResp = await fetchRemoteWithPolicy(sourceUrl, {
                headers: {
                  Range: `bytes=${offset}-${offset + currentChunkLength - 1}`,
                },
              });

              // Checked before the range test below, because a signed link that expired
              // part-way through the transfer also answers with a non-206 — and calling
              // that "ranged requests unsupported" sends the user looking for the wrong
              // problem when the real one is an expired or IP-bound link.
              if (remoteResp.status === 401 || remoteResp.status === 403) {
                throw new TransferError(
                  'REMOTE_ACCESS_DENIED',
                  `The remote server refused this link (HTTP ${remoteResp.status}) at byte ${offset}. ` +
                    'Signed download links usually expire within a few hours and are often tied to ' +
                    'the IP address that created them, so copy a fresh link and try again.'
                );
              }

              // A non-206 answer means the Range was ignored, so the body starts
              // at byte 0 rather than at `offset`. Uploading it would corrupt the
              // file, so only accept that when we are at the start of the stream.
              if (offset > 0 && remoteResp.status !== 206) {
                throw new TransferError(
                  'REMOTE_RANGE_UNSUPPORTED',
                  'The remote server does not support ranged requests required for chunked transfer'
                );
              }

              const body = await remoteResp.arrayBuffer();
              chunkBytes =
                body.byteLength > currentChunkLength ? body.slice(0, currentChunkLength) : body;
            }

            const sentLength = chunkBytes.byteLength;
            if (sentLength === 0) {
              throw new TransferError(
                'SOURCE_CHUNK_EMPTY',
                `The source returned no data at offset ${offset}`
              );
            }

            const uploadRes = await uploadChunk(sessionUrl, chunkBytes, offset, totalSize);

            if (uploadRes.status === 200 || uploadRes.status === 201) {
              const googleFile = (await uploadRes.json()) as { id: string; webViewLink?: string };
              return {
                completed: true,
                bytesTransferred: sentLength,
                googleFile,
              };
            }

            if (uploadRes.status === 308) {
              return {
                completed: false,
                bytesTransferred: confirmedBytes(
                  uploadRes.headers.get('Range'),
                  offset,
                  sentLength
                ),
              };
            }

            throw new Error(`Google upload chunk failed with status ${uploadRes.status}`);
          }
        );

        if (chunkResult.bytesTransferred <= 0) {
          throw new TransferError(
            'TRANSFER_STALLED',
            `Google Drive accepted no bytes at offset ${offset}`
          );
        }

        offset += chunkResult.bytesTransferred;
        chunkIndex++;

        // Throttled D1 progress update
        await recordProgress(offset);

        if (chunkResult.completed) {
          completedGoogleFile = chunkResult.googleFile;
          break;
        }
      }
    }

    // Step 3: Completion & Cleanup
    await step.do('finalize-transfer', async () => {
      if (!completedGoogleFile?.id) {
        throw new TransferError(
          'DRIVE_UPLOAD_INCOMPLETE',
          'Google Drive did not confirm the uploaded file'
        );
      }

      const driveFileId = completedGoogleFile.id;
      const driveFileLink =
        completedGoogleFile.webViewLink ||
        `https://drive.google.com/file/d/${driveFileId}/view`;
      const now = new Date().toISOString();

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE upload_jobs
           SET status = 'completed', drive_file_id = ?, drive_file_link = ?,
               progress_bytes = file_size, updated_at = ?, version = version + 1
           WHERE id = ? AND user_id = ? AND status = 'uploading'`
        ).bind(driveFileId, driveFileLink, now, jobId, userId),
        env.DB.prepare(
          `UPDATE upload_attempts
           SET status = 'completed', bytes_transferred = ?, finished_at = ?
           WHERE job_id = ? AND attempt_number = ?
             AND status NOT IN ('completed', 'failed', 'canceled')
             AND EXISTS (
               SELECT 1 FROM upload_jobs
               WHERE id = ? AND user_id = ? AND status = 'completed'
             )`
        ).bind(transferredSize, now, jobId, attemptNumber, jobId, userId),
      ]);

      const finalJob = await env.DB.prepare(
        'SELECT status FROM upload_jobs WHERE id = ? AND user_id = ?'
      )
        .bind(jobId, userId)
        .first<{ status: string }>();

      if (finalJob?.status === 'cancel_requested') {
        await markCanceled();
        return;
      }

      if (finalJob?.status === 'canceled') {
        return;
      }

      if (finalJob?.status !== 'completed') {
        throw new TransferError(
          'JOB_STATE_CONFLICT',
          'Upload job changed state during finalization'
        );
      }

      // Clean up R2 staging if applicable
      if (r2ObjectKey) {
        await deleteR2Object(env, r2ObjectKey);
      }
    });
  } catch (err: unknown) {
    const errorMsg = (err as Error).message || 'Drive transfer failed';
    const errorCode = (err as { code?: string }).code || 'TRANSFER_FAILED';
    const now = new Date().toISOString();

    // The carried remainder of an HLS recording was deleted on both the cancel and the success path
    // but not here, so every failed recording left up to 256 KiB billable in R2 with nothing left to
    // read it. A retry runs as a new workflow instance from cycle 1 with an empty step cache, so it
    // never wants the old tail back — this is genuinely garbage by the time we get here.
    await deleteR2Object(env, hlsTailKey(userId, jobId)).catch(() => undefined);

    try {
      const currentState = await env.DB.prepare(
        'SELECT status FROM upload_jobs WHERE id = ?'
      )
        .bind(jobId)
        .first<{ status: string }>();

      if (currentState?.status === 'cancel_requested') {
        await markCanceled();
      } else {
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE upload_jobs
             SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?, version = version + 1
             WHERE id = ? AND user_id = ?
               AND status NOT IN ('completed', 'failed', 'canceled')`
          ).bind(errorCode, errorMsg, now, jobId, userId),
          env.DB.prepare(
            `UPDATE upload_attempts
             SET status = 'failed', error_code = ?, error_message = ?, finished_at = ?
             WHERE job_id = ? AND attempt_number = ?
               AND status NOT IN ('completed', 'failed', 'canceled')
               AND EXISTS (
                 SELECT 1 FROM upload_jobs
                 WHERE id = ? AND user_id = ? AND status = 'failed'
               )`
          ).bind(errorCode, errorMsg, now, jobId, attemptNumber, jobId, userId),
        ]);
      }
    } catch {
      // Ignore secondary DB error
    }

    throw err;
  }
}

export class DriveTransferWorkflow extends WorkflowEntrypoint<Env, TransferPayload> {
  async run(event: WorkflowEvent<TransferPayload>, step: WorkflowStep) {
    await runDriveTransfer(this.env, event.payload, step);
  }
}
