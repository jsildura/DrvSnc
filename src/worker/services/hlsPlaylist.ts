// HLS (RFC 8216) playlist parsing.
//
// Nothing here touches the network — the workflow fetches playlist bodies and hands them in,
// which keeps every branch below directly unit-testable.

/** A `.ts` source stays MPEG-TS; fMP4 sources concatenate into a fragmented MP4. */
export type HlsContainer = 'mpegts' | 'fmp4';

export class HlsError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'HlsError';
  }
}

export interface HlsByteRange {
  offset: number;
  length: number;
}

export interface HlsKey {
  method: 'AES-128';
  url: string;
  /**
   * Explicit `IV=0x…` when present; otherwise the media sequence number supplies it. Pinned to a
   * non-shared buffer so WebCrypto accepts it directly as an AES-CBC parameter.
   */
  iv: Uint8Array<ArrayBuffer> | null;
}

export interface HlsSegment {
  url: string;
  /** Absolute media sequence number — the cursor a live recording resumes from. */
  sequence: number;
  duration: number;
  byteRange: HlsByteRange | null;
  key: HlsKey | null;
}

export interface HlsVariant {
  url: string;
  bandwidth: number;
  resolution: string | null;
  codecs: string | null;
}

export interface HlsMasterPlaylist {
  kind: 'master';
  variants: HlsVariant[];
}

export interface HlsMediaPlaylist {
  kind: 'media';
  segments: HlsSegment[];
  /** `#EXT-X-MAP` initialisation segment, which must lead the output file for fMP4. */
  initSegment: { url: string; byteRange: HlsByteRange | null } | null;
  /** No `#EXT-X-ENDLIST` means the playlist is still growing. */
  isLive: boolean;
  targetDuration: number;
  mediaSequence: number;
  container: HlsContainer;
}

export type HlsPlaylist = HlsMasterPlaylist | HlsMediaPlaylist;

const HLS_CONTENT_TYPES = [
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
  'vnd.apple.mpegurl',
];

/**
 * Whether a remote source is an HLS playlist rather than a plain file.
 *
 * Both signals are needed: CDNs serve playlists as `application/x-mpegURL` but also, wrongly, as
 * `text/plain` or `application/octet-stream`, and signed URLs often bury the `.m3u8` behind a
 * query string.
 */
export function isHlsUrl(rawUrl: string, contentType?: string | null): boolean {
  if (contentType) {
    const normalized = contentType.split(';')[0].trim().toLowerCase();
    if (HLS_CONTENT_TYPES.includes(normalized)) return true;
  }

  try {
    const pathname = new URL(rawUrl).pathname.toLowerCase();
    return pathname.endsWith('.m3u8') || pathname.endsWith('.m3u');
  } catch {
    return false;
  }
}

/** Split `A=1,B="x,y",C=z` on commas that sit outside quotes. */
function parseAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let current = '';
  let inQuotes = false;

  const commit = (raw: string): void => {
    const eq = raw.indexOf('=');
    if (eq <= 0) return;
    const key = raw.slice(0, eq).trim().toUpperCase();
    const value = raw.slice(eq + 1).trim().replace(/^"|"$/g, '');
    if (key) attrs[key] = value;
  };

  for (const char of input) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === ',' && !inQuotes) {
      commit(current);
      current = '';
    } else {
      current += char;
    }
  }
  commit(current);

  return attrs;
}

/** `#EXT-X-BYTERANGE:<length>[@<offset>]`; a missing offset continues from the previous segment. */
function parseByteRange(value: string, previousEnd: number): HlsByteRange | null {
  const [lengthPart, offsetPart] = value.split('@');
  const length = parseInt(lengthPart, 10);
  if (!Number.isFinite(length) || length <= 0) return null;

  const offset = offsetPart !== undefined ? parseInt(offsetPart, 10) : previousEnd;
  if (!Number.isFinite(offset) || offset < 0) return null;

  return { offset, length };
}

function parseHexBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  const digits = hex.replace(/^0[xX]/, '');
  if (digits.length === 0 || digits.length % 2 !== 0 || /[^0-9a-fA-F]/.test(digits)) {
    return null;
  }
  const bytes = new Uint8Array(digits.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * `#EXT-X-KEY` for one segment run. Returns null for `METHOD=NONE` (an explicit end to a
 * preceding encrypted run) and throws for schemes that cannot be decrypted with a plain
 * AES-CBC pass — SAMPLE-AES encrypts elementary streams inside the container, and DRM
 * key formats need a licence exchange.
 */
function parseKey(attrs: Record<string, string>, baseUrl: string): HlsKey | null {
  const method = (attrs.METHOD || 'NONE').toUpperCase();
  if (method === 'NONE') return null;

  if (method !== 'AES-128') {
    throw new HlsError(
      'HLS_ENCRYPTION_UNSUPPORTED',
      `This stream uses ${method} encryption, which cannot be decrypted without a licence exchange`
    );
  }

  const keyFormat = attrs.KEYFORMAT;
  if (keyFormat && keyFormat.toLowerCase() !== 'identity') {
    throw new HlsError(
      'HLS_ENCRYPTION_UNSUPPORTED',
      `This stream is DRM-protected (key format '${keyFormat}') and cannot be downloaded`
    );
  }

  if (!attrs.URI) {
    throw new HlsError('HLS_INVALID_PLAYLIST', '#EXT-X-KEY is missing its URI attribute');
  }

  let iv: Uint8Array<ArrayBuffer> | null = null;
  if (attrs.IV) {
    iv = parseHexBytes(attrs.IV);
    if (!iv || iv.length !== 16) {
      throw new HlsError('HLS_INVALID_PLAYLIST', `#EXT-X-KEY has a malformed IV: ${attrs.IV}`);
    }
  }

  return { method: 'AES-128', url: new URL(attrs.URI, baseUrl).toString(), iv };
}

function containerFor(segmentUrl: string, hasInitSegment: boolean): HlsContainer {
  if (hasInitSegment) return 'fmp4';
  try {
    const pathname = new URL(segmentUrl).pathname.toLowerCase();
    if (pathname.endsWith('.m4s') || pathname.endsWith('.mp4') || pathname.endsWith('.m4v')) {
      return 'fmp4';
    }
  } catch {
    // Fall through to the MPEG-TS default.
  }
  return 'mpegts';
}

/**
 * Parse a playlist body into either its variant list or its segment list.
 *
 * `baseUrl` is the URL the body came from — every relative URI resolves against it, so a
 * variant nested under `tracks-v1a1/` still yields absolute segment URLs.
 */
export function parsePlaylist(text: string, baseUrl: string): HlsPlaylist {
  const lines = text.split(/\r?\n/).map((line) => line.trim());

  if (!lines.some((line) => line.startsWith('#EXTM3U'))) {
    throw new HlsError(
      'HLS_INVALID_PLAYLIST',
      'Response is not an HLS playlist (missing #EXTM3U header)'
    );
  }

  const variants: HlsVariant[] = [];
  const segments: HlsSegment[] = [];
  let initSegment: HlsMediaPlaylist['initSegment'] = null;
  let isLive = true;
  let targetDuration = 0;
  let mediaSequence = 0;
  let sequenceSeen = false;

  let pendingVariant: Omit<HlsVariant, 'url'> | null = null;
  let pendingDuration = 0;
  let pendingByteRange: HlsByteRange | null = null;
  let previousByteRangeEnd = 0;
  let activeKey: HlsKey | null = null;
  let nextSequence = 0;

  for (const line of lines) {
    if (line.length === 0) continue;

    if (line.startsWith('#')) {
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const attrs = parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
        pendingVariant = {
          bandwidth: parseInt(attrs.BANDWIDTH || attrs['AVERAGE-BANDWIDTH'] || '0', 10) || 0,
          resolution: attrs.RESOLUTION || null,
          codecs: attrs.CODECS || null,
        };
      } else if (line.startsWith('#EXTINF:')) {
        pendingDuration = parseFloat(line.slice('#EXTINF:'.length).split(',')[0]) || 0;
      } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
        pendingByteRange = parseByteRange(
          line.slice('#EXT-X-BYTERANGE:'.length),
          previousByteRangeEnd
        );
      } else if (line.startsWith('#EXT-X-MAP:')) {
        const attrs = parseAttributes(line.slice('#EXT-X-MAP:'.length));
        if (attrs.URI) {
          initSegment = {
            url: new URL(attrs.URI, baseUrl).toString(),
            byteRange: attrs.BYTERANGE ? parseByteRange(attrs.BYTERANGE, 0) : null,
          };
        }
      } else if (line.startsWith('#EXT-X-KEY:')) {
        activeKey = parseKey(parseAttributes(line.slice('#EXT-X-KEY:'.length)), baseUrl);
      } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
        targetDuration = parseFloat(line.slice('#EXT-X-TARGETDURATION:'.length)) || 0;
      } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
        mediaSequence = parseInt(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length), 10) || 0;
        nextSequence = mediaSequence;
        sequenceSeen = true;
      } else if (line.startsWith('#EXT-X-ENDLIST')) {
        isLive = false;
      }
      continue;
    }

    // A bare URI line closes whichever tag block preceded it.
    const absoluteUrl = new URL(line, baseUrl).toString();

    if (pendingVariant) {
      variants.push({ url: absoluteUrl, ...pendingVariant });
      pendingVariant = null;
      continue;
    }

    if (!sequenceSeen) nextSequence = mediaSequence;
    sequenceSeen = true;

    segments.push({
      url: absoluteUrl,
      sequence: nextSequence++,
      duration: pendingDuration,
      byteRange: pendingByteRange,
      key: activeKey,
    });

    if (pendingByteRange) {
      previousByteRangeEnd = pendingByteRange.offset + pendingByteRange.length;
    }
    pendingDuration = 0;
    pendingByteRange = null;
  }

  if (variants.length > 0 && segments.length === 0) {
    return { kind: 'master', variants };
  }

  if (segments.length === 0) {
    throw new HlsError(
      'HLS_EMPTY_PLAYLIST',
      'The HLS playlist contains no media segments or variant streams'
    );
  }

  return {
    kind: 'media',
    segments,
    initSegment,
    isLive,
    targetDuration: targetDuration > 0 ? targetDuration : 6,
    mediaSequence,
    container: containerFor(segments[0].url, initSegment !== null),
  };
}

/** Highest-bandwidth rendition — the best quality the source offers. */
export function selectVariant(variants: HlsVariant[]): HlsVariant {
  if (variants.length === 0) {
    throw new HlsError('HLS_NO_VARIANTS', 'The master playlist lists no variant streams');
  }
  return variants.reduce((best, candidate) =>
    candidate.bandwidth > best.bandwidth ? candidate : best
  );
}

/**
 * Playlist basenames are almost always boilerplate — `index.m3u8`, `master.m3u8`, `mono.m3u8` —
 * so a file named after one tells the user nothing. Walk up the path for the first segment that
 * looks like an identifier instead.
 */
const GENERIC_PLAYLIST_NAMES = new Set([
  'index',
  'master',
  'playlist',
  'mono',
  'stream',
  'manifest',
  'main',
  'video',
  'chunklist',
  'prog_index',
  'media',
]);

export function deriveHlsBaseName(playlistUrl: string): string {
  try {
    const segments = new URL(playlistUrl).pathname.split('/').filter(Boolean);

    for (let i = segments.length - 1; i >= 0; i--) {
      const candidate = decodeURIComponent(segments[i]).replace(/\.(m3u8|m3u)$/i, '');
      if (candidate && !GENERIC_PLAYLIST_NAMES.has(candidate.toLowerCase())) {
        return candidate.replace(/[^a-zA-Z0-9._-]/g, '_');
      }
    }
  } catch {
    // Fall through to the generic default.
  }
  return 'hls-stream';
}

/**
 * Output filename for a recording. `recordedAt` is threaded in rather than read from the clock
 * so live re-runs of the same stream stay distinguishable and the result stays testable.
 */
export function deriveHlsFilename(
  playlistUrl: string,
  container: HlsContainer,
  recordedAt?: Date
): string {
  const base = deriveHlsBaseName(playlistUrl);
  const extension = container === 'fmp4' ? 'mp4' : 'ts';

  if (!recordedAt) return `${base}.${extension}`;

  const stamp = recordedAt.toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
  return `${base}_${stamp}.${extension}`;
}

export function hlsMimeType(container: HlsContainer): string {
  return container === 'fmp4' ? 'video/mp4' : 'video/mp2t';
}
