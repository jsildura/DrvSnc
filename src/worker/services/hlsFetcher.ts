// Segment retrieval for HLS transfers.
//
// Segment and key URIs come out of a playlist served by a third party, so every request here goes
// through `fetchRemoteWithPolicy` — the SSRF policy that guards the user-supplied URL has to guard
// CDN-supplied URLs too, or a malicious playlist could redirect the fetch at internal addresses.

import { fetchRemoteWithPolicy } from './remoteUrlPolicy';
import { HlsError, HlsByteRange, HlsKey } from './hlsPlaylist';

/**
 * Nothing downstream of a playlist is size-checked by the CDN on our behalf, and a worker that runs
 * out of memory dies with an opaque "exceeded memory limit" instead of failing the job with a reason
 * the user can act on. So every body read here is bounded.
 *
 * The segment bound also sets the recording's peak memory. A cycle buffers up to `MAX_CYCLE_BYTES`
 * (24 MiB) plus the one segment that crosses it, and the concat into a single flushable buffer
 * doubles that — so 16 MiB keeps the worst case near 80 MiB, comfortably inside the 128 MB isolate.
 * A 16 MiB segment is roughly 10 s at 13 Mbps, well above any normal HLS ladder rung.
 */
const MAX_SEGMENT_BYTES = 16 * 1024 * 1024;
/** An AES-128 key is exactly 16 bytes; this only has to be large enough not to reject a real one. */
const MAX_KEY_BYTES = 1024;
/** A 12-hour VOD listing 6-second segments is under 1 MiB of text. */
const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024;

/**
 * Read a response body, giving up as soon as it goes past `limit` rather than after.
 *
 * `Content-Length` is checked first because it costs nothing on a server that sends one, but it is
 * advisory: a chunked response has none, and a hostile one can understate it. So the stream is
 * measured as it arrives and cancelled the moment it crosses the bound.
 */
async function readBoundedBytes(
  res: Response,
  limit: number,
  code: string,
  what: string
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(res.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > limit) {
    await res.body?.cancel().catch(() => undefined);
    throw new HlsError(code, `${what} is ${declared} bytes, over the ${limit}-byte limit`);
  }

  if (!res.body) return new Uint8Array(0);

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        throw new HlsError(code, `${what} exceeds the ${limit}-byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    // Releasing the lock is not enough: an abandoned body holds its connection open.
    await reader.cancel().catch(() => undefined);
  }

  const merged = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    merged.set(chunk, at);
    at += chunk.byteLength;
  }
  return merged;
}

/** First byte of the body per `Content-Range: bytes <start>-<end>/<total>`, or null if unparsable. */
function contentRangeStart(header: string | null): number | null {
  const match = /^\s*bytes\s+(\d+)-/i.exec(header || '');
  if (!match) return null;
  const start = Number(match[1]);
  return Number.isSafeInteger(start) ? start : null;
}

/**
 * Locate the requested window inside whatever the server actually sent.
 *
 * A 206 body already begins at the offset named in `Content-Range`; a 200 body is the whole entity
 * and the offset still has to be applied. Deciding that from the body length instead — "longer than
 * I asked for, so it must be the whole file" — picks the wrong window whenever a CDN satisfies
 * `bytes=a-b` by returning everything from `a` to EOF. That is a legal 206 and common on
 * origin-pull CDNs, and the result transfers without error and plays as garbage.
 */
function sliceRequestedRange(
  bytes: Uint8Array<ArrayBuffer>,
  range: HlsByteRange,
  res: Response
): Uint8Array<ArrayBuffer> {
  // A 206 without a usable Content-Range is non-conformant; assume it honoured the range exactly.
  // A 200 whose body is exactly the requested length was clearly windowed too, whatever it claims.
  const preWindowed =
    res.status === 206 ? true : bytes.byteLength === range.length && range.offset > 0;
  const bodyStart = preWindowed ? contentRangeStart(res.headers.get('Content-Range')) ?? range.offset : 0;

  const from = range.offset - bodyStart;
  if (from < 0 || from + range.length > bytes.byteLength) {
    throw new HlsError(
      'HLS_SEGMENT_RANGE_UNUSABLE',
      `Asked for ${range.length} bytes at offset ${range.offset} but the server answered ` +
        `HTTP ${res.status} with ${bytes.byteLength} bytes starting at ${bodyStart}`
    );
  }
  return bytes.subarray(from, from + range.length);
}

/**
 * AES-128 keys are 16 bytes and are reused across every segment in a run, so importing one per
 * segment would mean re-fetching it per segment too. Cached per workflow step.
 */
export class HlsKeyCache {
  private readonly keys = new Map<string, CryptoKey>();

  async get(keyUrl: string): Promise<CryptoKey> {
    const cached = this.keys.get(keyUrl);
    if (cached) return cached;

    const res = await fetchRemoteWithPolicy(keyUrl);
    if (!res.ok) {
      throw new HlsError(
        'HLS_KEY_FETCH_FAILED',
        `Could not fetch the AES-128 key (HTTP ${res.status})`
      );
    }

    // Bounded before the length check below, not after: buffering the whole body first means a
    // server answering the key URI with a video file takes the isolate down before we look at it.
    const raw = await readBoundedBytes(res, MAX_KEY_BYTES, 'HLS_KEY_INVALID', 'The AES-128 key');
    if (raw.byteLength !== 16) {
      throw new HlsError(
        'HLS_KEY_INVALID',
        `AES-128 key must be 16 bytes, got ${raw.byteLength}`
      );
    }

    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-CBC' }, false, ['decrypt']);
    this.keys.set(keyUrl, key);
    return key;
  }
}

/**
 * Absent an explicit `IV` attribute, RFC 8216 §5.2 derives the IV from the segment's media
 * sequence number as a 128-bit big-endian integer.
 */
export function ivFromSequence(sequence: number): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(16);
  new DataView(iv.buffer).setBigUint64(8, BigInt(sequence));
  return iv;
}

/**
 * Fetch one segment, decrypting it when the playlist declared a key.
 *
 * HLS AES-128 segments are individually PKCS#7-padded, which is exactly what WebCrypto's AES-CBC
 * implementation strips, so no manual unpadding is needed.
 */
export async function fetchSegment(
  url: string,
  options: {
    byteRange?: HlsByteRange | null;
    key?: HlsKey | null;
    sequence: number;
    keyCache: HlsKeyCache;
  }
): Promise<Uint8Array> {
  const headers: Record<string, string> = {};
  if (options.byteRange) {
    const { offset, length } = options.byteRange;
    headers.Range = `bytes=${offset}-${offset + length - 1}`;
  }

  const res = await fetchRemoteWithPolicy(url, {
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });

  if (!res.ok) {
    throw new HlsError(
      'HLS_SEGMENT_FETCH_FAILED',
      `Segment request failed with HTTP ${res.status}`
    );
  }

  let bytes = await readBoundedBytes(
    res,
    MAX_SEGMENT_BYTES,
    'HLS_SEGMENT_TOO_LARGE',
    `Segment ${options.sequence}`
  );

  if (options.byteRange) {
    bytes = sliceRequestedRange(bytes, options.byteRange, res);
  }

  if (bytes.byteLength === 0) {
    throw new HlsError('HLS_SEGMENT_EMPTY', 'The CDN returned an empty segment');
  }

  if (!options.key) return bytes;

  const cryptoKey = await options.keyCache.get(options.key.url);
  const iv = options.key.iv ?? ivFromSequence(options.sequence);

  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, bytes);
    return new Uint8Array(plaintext);
  } catch (err) {
    throw new HlsError(
      'HLS_DECRYPT_FAILED',
      `AES-128 decryption failed for segment ${options.sequence}: ${(err as Error).message}`
    );
  }
}

/** Fetch a playlist body as text, rejecting anything that is obviously not a playlist. */
export async function fetchPlaylistText(url: string): Promise<string> {
  const res = await fetchRemoteWithPolicy(url);
  if (!res.ok) {
    throw new HlsError(
      'HLS_PLAYLIST_FETCH_FAILED',
      `Playlist request failed with HTTP ${res.status}`
    );
  }
  const bytes = await readBoundedBytes(
    res,
    MAX_PLAYLIST_BYTES,
    'HLS_PLAYLIST_TOO_LARGE',
    'The playlist'
  );
  return new TextDecoder().decode(bytes);
}
