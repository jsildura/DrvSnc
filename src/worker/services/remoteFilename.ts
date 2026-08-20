// Filename and content-type inference for remote sources.
//
// Nothing here touches the network. Token-protected delivery links name a script rather than a
// file — `remote_control.php?file=<token>.mp4&acctoken=…` — so the extension that decides what
// Drive calls the upload, and whether it previews as video, has to be recovered from the query
// string instead of the path.

/** Extensions worth trusting as a real filename, mapped to the type they imply. */
const MIME_BY_EXTENSION: Record<string, string> = {
  // Video
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  flv: 'video/x-flv',
  wmv: 'video/x-ms-wmv',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  '3gp': 'video/3gpp',
  ogv: 'video/ogg',
  // Audio
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wma: 'audio/x-ms-wma',
  // Archives
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  iso: 'application/x-iso9660-image',
  // Images and documents
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  // Playlists
  m3u8: 'application/vnd.apple.mpegurl',
  m3u: 'application/vnd.apple.mpegurl',
};

/**
 * Server-side scripts that stand in for the file they deliver. A path ending in one of these is a
 * delivery endpoint, not a filename, so the real name is worth looking for elsewhere.
 */
const DELIVERY_SCRIPT_EXTENSIONS = new Set([
  'php',
  'asp',
  'aspx',
  'jsp',
  'jspx',
  'cgi',
  'pl',
  'py',
  'do',
  'action',
  'ashx',
  'axd',
]);

/**
 * Longest name taken verbatim from a query parameter. Signed links carry the whole access token in
 * the `file=` value, and a 200-character random string makes a worse filename than the endpoint's
 * own name does — past this length only the extension is kept.
 */
const MAX_QUERY_BASENAME_LENGTH = 64;

const FALLBACK_FILENAME = 'remote-download';

/** Path separators and shell-hostile characters Drive should never receive in a name. */
const UNSAFE_FILENAME_CHARS = '\\/:*?"<>|';

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

/** Strip control characters and replace separators; everything else is left as the source had it. */
function sanitize(name: string): string {
  let out = '';
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    out += UNSAFE_FILENAME_CHARS.includes(char) ? '_' : char;
  }
  return out.replace(/^\.+/, '').trim();
}

/** Last path-like component of a value, minus any nested query string or fragment. */
function basenameOf(value: string): string {
  let candidate = value.split(/[?#]/)[0];
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    // A stray '%' is not a reason to give up on the rest of the name.
  }
  const parts = candidate.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

/**
 * Best available filename for a remote URL.
 *
 * A path that already names a file wins. Otherwise the query string is searched for a value ending
 * in a recognised extension, which is how a progressive-download endpoint reveals what it serves.
 */
export function deriveRemoteFilename(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return FALLBACK_FILENAME;
  }

  const pathBase = sanitize(basenameOf(url.pathname));
  const pathExtension = extensionOf(pathBase);

  if (pathExtension && !DELIVERY_SCRIPT_EXTENSIONS.has(pathExtension)) {
    return pathBase;
  }

  const stem = pathExtension
    ? pathBase.slice(0, pathBase.length - pathExtension.length - 1)
    : pathBase;

  for (const value of url.searchParams.values()) {
    const candidate = sanitize(basenameOf(value));
    const extension = extensionOf(candidate);
    if (!extension || !(extension in MIME_BY_EXTENSION)) continue;

    if (candidate.length <= MAX_QUERY_BASENAME_LENGTH) return candidate;

    // The value was an access token that happens to end in an extension. Keep what it revealed.
    return `${stem || FALLBACK_FILENAME}.${extension}`;
  }

  return pathBase || FALLBACK_FILENAME;
}

/**
 * Content type implied by a filename, or null when the extension says nothing.
 *
 * Used to correct a delivery endpoint that answers with `application/octet-stream`: Drive decides
 * whether a file previews as video from the type it was uploaded with, so an unhelpful header
 * would otherwise turn a playable MP4 into a download-only blob.
 */
export function guessMimeFromFilename(filename: string): string | null {
  return MIME_BY_EXTENSION[extensionOf(filename)] ?? null;
}
