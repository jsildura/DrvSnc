import { describe, it, expect, vi } from 'vitest';
import {
  uploadFileMultipart,
  uploadStreamMultipart,
  PartEtagUnavailableError,
} from '../../src/web/uploads/multipartUpload';
import { RelayError } from '../../src/web/uploads/relayFetch';

/** A part PUT that R2 accepted but whose ETag the browser will not hand to the page. */
const etaglessPut = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

describe('Client-Side R2 Multipart Upload Engine', () => {
  it('splits file into parts and uploads with progress reporting and ETag collection', async () => {
    const dummyData = new Uint8Array(20 * 1024 * 1024); // 20 MiB
    const file = new File([dummyData], 'large.iso', { type: 'application/octet-stream' });
    const partSize = 10 * 1024 * 1024; // 10 MiB -> 2 parts
    const partCount = 2;

    const mockGetUrls = vi.fn(async (_from: number, _count: number) => {
      return [
        { partNumber: 1, url: 'https://r2.example.com/part1' },
        { partNumber: 2, url: 'https://r2.example.com/part2' },
      ];
    });

    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('part1')) {
        return new Response(null, { status: 200, headers: { ETag: '"etag-1"' } });
      }
      if (url.includes('part2')) {
        return new Response(null, { status: 200, headers: { ETag: '"etag-2"' } });
      }
      return new Response('Not Found', { status: 404 });
    });

    const progressUpdates: number[] = [];
    const completedParts = await uploadFileMultipart(
      file,
      {
        partSize,
        partCount,
        getPartUrls: mockGetUrls,
        onProgress: (loaded, _total) => progressUpdates.push(loaded),
      },
      mockFetch as unknown as typeof fetch
    );

    expect(completedParts).toHaveLength(2);
    expect(completedParts[0]).toEqual({ partNumber: 1, etag: 'etag-1' });
    expect(completedParts[1]).toEqual({ partNumber: 2, etag: 'etag-2' });
    expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
  });

  // `ETag` is not a CORS-safelisted response header, so a bucket missing
  // `ExposeHeaders: ["ETag"]` hands back a 200 with no readable etag. Substituting a placeholder
  // made R2's completion call fail silently and the job queue against an object that was never
  // assembled — a failure that only showed up much later, in the transfer workflow.
  it('fails loudly when R2 accepts a part but hides its ETag', async () => {
    const file = new File([new Uint8Array(16)], 'clip.mp4', { type: 'video/mp4' });
    const fetchSpy = vi.fn(etaglessPut);

    const err = await uploadFileMultipart(
      file,
      {
        partSize: 16,
        partCount: 1,
        getPartUrls: async () => [{ partNumber: 1, url: 'https://r2.example.com/staged?partNumber=1' }],
      },
      fetchSpy as unknown as typeof fetch
    ).catch((e) => e as Error);

    expect(err).toBeInstanceOf(PartEtagUnavailableError);
    expect((err as PartEtagUnavailableError).partNumber).toBe(1);
    expect((err as Error).message).toContain('ExposeHeaders');
    // A CORS policy is not a transient fault; re-sending the part cannot make the header appear.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ==========================================
// STREAM DRIVER (browser-relayed sources)
// ==========================================

/** Sequential bytes, so a reordered or duplicated part is visible in the reassembled output. */
function sourceBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = i % 251;
  return out;
}

/** Hands the bytes out in the given chunk sizes, which deliberately do not align with the part size. */
function streamOf(bytes: Uint8Array, chunkSizes: number[]): ReadableStream<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const size of chunkSizes) {
    chunks.push(bytes.slice(offset, offset + size));
    offset += size;
  }
  if (offset < bytes.byteLength) chunks.push(bytes.slice(offset));

  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index++]);
    },
  });
}

interface RecordedPut {
  partNumber: number;
  body: Uint8Array;
}

function recordingPutFetch(
  statusFor: (partNumber: number, attempt: number) => number = () => 200
) {
  const puts: RecordedPut[] = [];
  const attempts = new Map<number, number>();

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const partNumber = Number(new URL(String(input)).searchParams.get('partNumber'));
    const attempt = (attempts.get(partNumber) || 0) + 1;
    attempts.set(partNumber, attempt);

    const body = new Uint8Array(init!.body as Uint8Array);
    puts.push({ partNumber, body });

    const status = statusFor(partNumber, attempt);
    return new Response(null, {
      status,
      headers: status === 200 ? { ETag: `W/"etag-${partNumber}"` } : {},
    });
  }) as unknown as typeof fetch;

  return { puts, fetchFn };
}

const signUrls = (from: number, count: number) =>
  Promise.resolve(
    Array.from({ length: count }, (_, i) => ({
      partNumber: from + i,
      url: `https://r2.example.com/staged?partNumber=${from + i}`,
    }))
  );

describe('Client-Side R2 Stream Upload Engine (browser relay)', () => {
  it('re-cuts reader chunks so every part but the last is exactly partSize', async () => {
    const bytes = sourceBytes(21);
    const { puts, fetchFn } = recordingPutFetch();

    const result = await uploadStreamMultipart(
      streamOf(bytes, [7, 7, 7]),
      { partSize: 10, getPartUrls: signUrls },
      fetchFn
    );

    // R2 rejects completion if a non-final part is short, and the reader's 7-byte chunks have
    // nothing to do with the 10-byte part size.
    expect(puts.map((p) => p.body.byteLength)).toEqual([10, 10, 1]);
    expect(puts.map((p) => p.partNumber)).toEqual([1, 2, 3]);

    const reassembled = new Uint8Array(21);
    let offset = 0;
    for (const put of puts) {
      reassembled.set(put.body, offset);
      offset += put.body.byteLength;
    }
    expect(Array.from(reassembled)).toEqual(Array.from(bytes));

    expect(result.totalBytes).toBe(21);
    // The weak-validator prefix and quotes have to come off before R2 will accept the etag back.
    expect(result.parts).toEqual([
      { partNumber: 1, etag: 'etag-1' },
      { partNumber: 2, etag: 'etag-2' },
      { partNumber: 3, etag: 'etag-3' },
    ]);
  });

  it('signs part URLs lazily in batches as part numbers are reached', async () => {
    const { fetchFn } = recordingPutFetch();
    const getPartUrls = vi.fn(signUrls);

    // A relayed source has no declared length, so there is no part count to sign up front.
    const result = await uploadStreamMultipart(
      streamOf(sourceBytes(25), [25]),
      { partSize: 1, getPartUrls },
      fetchFn
    );

    expect(result.parts).toHaveLength(25);
    expect(getPartUrls.mock.calls).toEqual([
      [1, 20],
      [21, 20],
    ]);
  });

  it('resends the identical bytes when a part PUT fails transiently', async () => {
    const bytes = sourceBytes(20);
    const { puts, fetchFn } = recordingPutFetch((partNumber, attempt) =>
      partNumber === 2 && attempt === 1 ? 500 : 200
    );

    const result = await uploadStreamMultipart(
      streamOf(bytes, [20]),
      { partSize: 10, getPartUrls: signUrls },
      fetchFn
    );

    const part2Puts = puts.filter((p) => p.partNumber === 2);
    expect(part2Puts).toHaveLength(2);
    // There is no seeking back into a stream, so the buffer has to outlive the failed attempt.
    expect(Array.from(part2Puts[0].body)).toEqual(Array.from(part2Puts[1].body));
    expect(result.parts.map((p) => p.partNumber)).toEqual([1, 2]);
    expect(result.totalBytes).toBe(20);
  });

  it('reports progress against the declared total and closes on the real one', async () => {
    const { fetchFn } = recordingPutFetch();
    const updates: [number, number][] = [];

    await uploadStreamMultipart(
      streamOf(sourceBytes(25), [10, 10, 5]),
      {
        partSize: 10,
        getPartUrls: signUrls,
        expectedTotalBytes: 25,
        onProgress: (staged, total) => updates.push([staged, total]),
      },
      fetchFn
    );

    expect(updates[0]).toEqual([10, 25]);
    expect(updates[updates.length - 1]).toEqual([25, 25]);
  });

  it('aborts mid-stream without uploading further parts', async () => {
    const controller = new AbortController();
    const { puts, fetchFn } = recordingPutFetch();

    const abortingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await fetchFn(input as RequestInfo, init);
      controller.abort();
      return res;
    }) as unknown as typeof fetch;

    const err = await uploadStreamMultipart(
      streamOf(sourceBytes(30), [30]),
      { partSize: 10, getPartUrls: signUrls, signal: controller.signal },
      abortingFetch
    ).catch((e) => e as RelayError);

    expect(err).toBeInstanceOf(RelayError);
    expect((err as RelayError).code).toBe('RELAY_ABORTED');
    expect(puts).toHaveLength(1);
  });

  it('stops as soon as the stream exceeds the size cap', async () => {
    const { fetchFn } = recordingPutFetch();

    const err = await uploadStreamMultipart(
      streamOf(sourceBytes(30), [10, 10, 10]),
      { partSize: 10, getPartUrls: signUrls, maxBytes: 15 },
      fetchFn
    ).catch((e) => e as RelayError);

    expect((err as RelayError).code).toBe('RELAY_TOO_LARGE');
  });

  it('refuses a source that sent no bytes at all', async () => {
    const { fetchFn } = recordingPutFetch();

    const err = await uploadStreamMultipart(
      streamOf(new Uint8Array(0), []),
      { partSize: 10, getPartUrls: signUrls },
      fetchFn
    ).catch((e) => e as RelayError);

    expect((err as RelayError).code).toBe('RELAY_SOURCE_EMPTY');
  });

  it('stops on the first part whose ETag is hidden instead of inventing one', async () => {
    const fetchSpy = vi.fn(etaglessPut);

    const err = await uploadStreamMultipart(
      streamOf(sourceBytes(30), [30]),
      { partSize: 10, getPartUrls: signUrls },
      fetchSpy as unknown as typeof fetch
    ).catch((e) => e as Error);

    expect(err).toBeInstanceOf(PartEtagUnavailableError);
    expect((err as PartEtagUnavailableError).partNumber).toBe(1);
    // No retry of part 1 and no attempt at parts 2-3: a relayed stream's bytes are held in memory
    // for exactly one pass, so continuing past this would burn the source for nothing.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
