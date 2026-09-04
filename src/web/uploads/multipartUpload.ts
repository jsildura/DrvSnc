// Client-Side R2 Multipart Upload Driver with Concurrency & Resumption

import { MAX_UPLOAD_SIZE_BYTES } from '../../shared/contracts';
import { RelayError } from './relayFetch';

export interface UploadPartOption {
  partSize: number;
  partCount: number;
  getPartUrls: (from: number, count: number) => Promise<{ partNumber: number; url: string }[]>;
  onProgress?: (bytesUploaded: number, totalBytes: number) => void;
  signal?: AbortSignal;
  concurrency?: number;
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

/**
 * Raised when a part upload succeeded but its `ETag` could not be read.
 *
 * Not retriable, and not substitutable: R2's `complete()` matches the reported etag list against the
 * parts it actually holds, so an invented value fails there — and that failure is indistinguishable
 * from a mocked binding, so the job would be queued against an object that was never assembled and
 * fail much later with nothing pointing back at the cause.
 *
 * `ETag` is not a CORS-safelisted response header. A bucket whose CORS policy omits
 * `ExposeHeaders: ["ETag"]` (see `config/r2-cors.json`) lands here on part 1, every time.
 */
export class PartEtagUnavailableError extends Error {
  partNumber: number;

  constructor(partNumber: number) {
    super(
      `R2 accepted part ${partNumber} but did not expose its ETag to this page. The bucket's CORS ` +
        'policy needs ExposeHeaders: ["ETag"] — without it the completion call cannot name the ' +
        'parts that were staged.'
    );
    this.name = 'PartEtagUnavailableError';
    this.partNumber = partNumber;
  }
}

function readPartEtag(res: Response, partNumber: number): string {
  const raw = res.headers.get('ETag') || res.headers.get('etag');
  const cleaned = (raw || '').replace(/^W\//, '').replace(/"/g, '').trim();
  if (!cleaned) {
    throw new PartEtagUnavailableError(partNumber);
  }
  return cleaned;
}

export function normalizeUploadUrl(url: string): string {
  if (typeof window !== 'undefined' && url.includes('/api/v1/uploads/direct/')) {
    try {
      const parsed = new URL(url, window.location.origin);
      if (
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
        (parsed.port === '8787' || parsed.port === '5173')
      ) {
        return `${parsed.pathname}${parsed.search}`;
      }
    } catch {
      // ignore
    }
  }
  return url;
}

export async function uploadFileMultipart(
  file: File,
  options: UploadPartOption,
  fetchFn: typeof fetch = fetch
): Promise<UploadedPart[]> {
  const { partSize, partCount, getPartUrls, onProgress, signal, concurrency = 3 } = options;
  const totalBytes = file.size;

  // Request all part URLs in batches of 20
  const urlMap = new Map<number, string>();
  for (let from = 1; from <= partCount; from += 20) {
    const count = Math.min(20, partCount - from + 1);
    const result = await getPartUrls(from, count);
    for (const p of result) {
      urlMap.set(p.partNumber, p.url);
    }
  }

  const completedParts: UploadedPart[] = [];
  const partProgress = new Map<number, number>();

  const reportTotalProgress = () => {
    if (!onProgress) return;
    let sum = 0;
    for (const bytes of partProgress.values()) {
      sum += bytes;
    }
    onProgress(Math.min(sum, totalBytes), totalBytes);
  };

  // Upload worker queue with bounded concurrency
  let currentIndex = 1;

  async function uploadWorker(): Promise<void> {
    while (currentIndex <= partCount) {
      if (signal?.aborted) {
        throw new Error('Upload aborted by user');
      }

      const partNumber = currentIndex++;
      const signedUrl = urlMap.get(partNumber);
      if (!signedUrl) {
        throw new Error(`Signed URL for part ${partNumber} missing`);
      }

      const start = (partNumber - 1) * partSize;
      const end = Math.min(start + partSize, totalBytes);
      const chunk = file.slice(start, end);

      let success = false;
      let lastError: Error | null = null;

      // Retry loop for transient chunk failures
      for (let attempt = 1; attempt <= 3 && !success; attempt++) {
        if (signal?.aborted) throw new Error('Upload aborted');

        try {
          const targetUrl = normalizeUploadUrl(signedUrl);
          const res = await fetchFn(targetUrl, {
            method: 'PUT',
            headers: {
              // Content-Length is a forbidden header name in browsers; the
              // fetch layer derives it from the Blob body.
              'Content-Type': file.type || 'application/octet-stream',
            },
            body: chunk,
            signal,
          });

          if (!res.ok) {
            throw new Error(`Upload part ${partNumber} failed with status ${res.status}`);
          }

          completedParts.push({ partNumber, etag: readPartEtag(res, partNumber) });
          partProgress.set(partNumber, chunk.size);
          reportTotalProgress();
          success = true;
        } catch (err) {
          // A hidden ETag is a bucket configuration problem, not a transient one; resending the same
          // 16 MiB twice more cannot make the header appear.
          if (err instanceof PartEtagUnavailableError) throw err;
          lastError = err as Error;
          if (attempt < 3 && !signal?.aborted) {
            await new Promise((r) => setTimeout(r, attempt * 500));
          }
        }
      }

      if (!success) {
        throw lastError || new Error(`Failed to upload part ${partNumber}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, partCount) }, () => uploadWorker());
  await Promise.all(workers);

  return completedParts.sort((a, b) => a.partNumber - b.partNumber);
}

// ==========================================
// STREAM DRIVER (browser-relayed sources)
// ==========================================

export interface UploadStreamOption {
  partSize: number;
  getPartUrls: (from: number, count: number) => Promise<{ partNumber: number; url: string }[]>;
  /** Sent with every part PUT so the assembled object carries the right type into Drive. */
  contentType?: string;
  /** The source's declared length, or `0` when it sent none. Only used to report progress. */
  expectedTotalBytes?: number;
  /**
   * Called with the bytes staged so far. `totalBytes` is `0` for a source of unknown length — there
   * is no denominator to show a percentage against until the stream ends.
   */
  onProgress?: (bytesUploaded: number, totalBytes: number) => void;
  signal?: AbortSignal;
  maxBytes?: number;
}

/** How many signed part URLs to ask for at a time, matching the API's per-request cap. */
const URL_BATCH_SIZE = 20;

/**
 * Copy exactly `size` bytes out of the head of `pending`, leaving any remainder in place.
 *
 * R2 requires every part except the last to be the same size, so a part must never be flushed short
 * while the stream is still running — the reader's chunk boundaries have nothing to do with the part
 * size and have to be re-cut here.
 */
function takeExactly(pending: Uint8Array[], size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  let filled = 0;

  while (filled < size) {
    const head = pending[0];
    const need = size - filled;

    if (head.byteLength <= need) {
      out.set(head, filled);
      filled += head.byteLength;
      pending.shift();
    } else {
      out.set(head.subarray(0, need), filled);
      pending[0] = head.subarray(need);
      filled = size;
    }
  }

  return out;
}

/**
 * Stage a `ReadableStream` into R2 as a multipart upload.
 *
 * Unlike the file driver this runs strictly sequentially and discovers the part count as it goes: a
 * stream can only be read in order, and a relayed source usually has no declared length, so signed
 * URLs are requested in batches as part numbers are reached rather than all at once.
 */
export async function uploadStreamMultipart(
  stream: ReadableStream<Uint8Array>,
  options: UploadStreamOption,
  fetchFn: typeof fetch = fetch
): Promise<{ parts: UploadedPart[]; totalBytes: number }> {
  const {
    partSize,
    getPartUrls,
    contentType,
    expectedTotalBytes = 0,
    onProgress,
    signal,
    maxBytes = MAX_UPLOAD_SIZE_BYTES,
  } = options;

  const parts: UploadedPart[] = [];
  const urlMap = new Map<number, string>();
  let totalBytes = 0;

  const throwIfAborted = () => {
    if (signal?.aborted) {
      throw new RelayError('RELAY_ABORTED', 'Transfer canceled');
    }
  };

  const urlFor = async (partNumber: number): Promise<string> => {
    if (!urlMap.has(partNumber)) {
      const batch = await getPartUrls(partNumber, URL_BATCH_SIZE);
      for (const p of batch) {
        urlMap.set(p.partNumber, p.url);
      }
    }

    const url = urlMap.get(partNumber);
    if (!url) {
      throw new Error(`Signed URL for part ${partNumber} missing`);
    }
    return url;
  };

  // The caller keeps the buffer alive across all three attempts, so a transient failure can resend
  // the same bytes — there is no seeking back into a stream to recover them.
  const putPart = async (partNumber: number, body: Uint8Array<ArrayBuffer>): Promise<void> => {
    const signedUrl = await urlFor(partNumber);
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      throwIfAborted();

      try {
        const targetUrl = normalizeUploadUrl(signedUrl);
        const res = await fetchFn(targetUrl, {
          method: 'PUT',
          headers: {
            // Content-Length is a forbidden header name in browsers; the fetch layer derives it
            // from the body.
            'Content-Type': contentType || 'application/octet-stream',
          },
          body,
          signal,
        });

        if (!res.ok) {
          throw new Error(`Upload part ${partNumber} failed with status ${res.status}`);
        }

        parts.push({ partNumber, etag: readPartEtag(res, partNumber) });
        return;
      } catch (err) {
        // Neither of these gets better on the next attempt: an abort is deliberate, and a hidden
        // ETag is a bucket CORS setting. Retrying the latter would re-send the part — and for a
        // relayed stream those bytes are the only copy, held in memory for exactly this reason.
        if (err instanceof RelayError || err instanceof PartEtagUnavailableError) throw err;
        lastError = err as Error;
        if (attempt < 3 && !signal?.aborted) {
          await new Promise((r) => setTimeout(r, attempt * 500));
        }
      }
    }

    throw lastError || new Error(`Failed to upload part ${partNumber}`);
  };

  const reader = stream.getReader();
  const pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let nextPartNumber = 1;

  try {
    for (;;) {
      throwIfAborted();

      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new RelayError(
          'RELAY_TOO_LARGE',
          `This source is larger than the ${(maxBytes / (1024 * 1024 * 1024)).toFixed(0)} GiB maximum.`
        );
      }

      pending.push(value);
      pendingBytes += value.byteLength;

      while (pendingBytes >= partSize) {
        await putPart(nextPartNumber++, takeExactly(pending, partSize));
        pendingBytes -= partSize;
        onProgress?.(totalBytes - pendingBytes, expectedTotalBytes);
      }
    }

    if (pendingBytes > 0) {
      await putPart(nextPartNumber++, takeExactly(pending, pendingBytes));
      pendingBytes = 0;
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err;
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) {
    throw new RelayError(
      'RELAY_SOURCE_EMPTY',
      'The source sent zero bytes, so there is nothing to transfer.'
    );
  }

  onProgress?.(totalBytes, totalBytes);

  return { parts: parts.sort((a, b) => a.partNumber - b.partNumber), totalBytes };
}
