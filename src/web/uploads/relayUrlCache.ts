// Short-lived record of which URL produced which relay job.
//
// Retrying a relay needs the original token-bearing URL, and nothing server-side can supply it:
// `source_url_redacted` strips the query string (which is where the token lives) and the encrypted
// copy is never returned to the client. So the tab keeps its own note.
//
// Browser-scoped storage is the right scope rather than a compromise — an IP-bound link only works
// from the machine that requested it, so a copy held anywhere else would be useless. Entries expire
// in a day because the tokens they carry expire in hours.

const STORAGE_KEY = 'gdu_relay_sources';
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 50;

interface RelaySourceEntry {
  jobId: string;
  url: string;
  savedAt: string;
}

function isFresh(savedAt: string): boolean {
  const at = Date.parse(savedAt);
  return !isNaN(at) && Date.now() - at < TTL_MS;
}

function sanitizeEntry(input: unknown): RelaySourceEntry | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;

  const jobId = typeof record.jobId === 'string' && record.jobId.trim() ? record.jobId.trim() : null;
  const url =
    typeof record.url === 'string' &&
    (record.url.startsWith('https://') || record.url.startsWith('http://'))
      ? record.url
      : null;
  const savedAt = typeof record.savedAt === 'string' ? record.savedAt : null;

  if (!jobId || !url || !savedAt || !isFresh(savedAt)) return null;

  return { jobId, url, savedAt };
}

function readEntries(): RelaySourceEntry[] {
  if (typeof localStorage === 'undefined') return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const valid: RelaySourceEntry[] = [];
    for (const item of parsed) {
      const sanitized = sanitizeEntry(item);
      if (sanitized) valid.push(sanitized);
    }
    return valid;
  } catch {
    return [];
  }
}

function writeEntries(entries: RelaySourceEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // QuotaExceeded or storage disabled: a missing note only costs the retry button.
  }
}

export function rememberRelaySource(jobId: string, url: string): void {
  const entry = sanitizeEntry({ jobId, url, savedAt: new Date().toISOString() });
  if (!entry) return;

  const others = readEntries().filter((e) => e.jobId !== entry.jobId);
  writeEntries([entry, ...others]);
}

export function getRelaySource(jobId: string): string | null {
  return readEntries().find((e) => e.jobId === jobId)?.url ?? null;
}

export function forgetRelaySource(jobId: string): void {
  const remaining = readEntries().filter((e) => e.jobId !== jobId);
  writeEntries(remaining);
}

/** Drop expired entries. Reading already ignores them; this stops them accruing in storage. */
export function pruneRelaySources(): void {
  writeEntries(readEntries());
}
