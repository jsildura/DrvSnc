import { describe, it, expect, vi } from 'vitest';
import { uploadFileMultipart } from '../../src/web/uploads/multipartUpload';

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
});
