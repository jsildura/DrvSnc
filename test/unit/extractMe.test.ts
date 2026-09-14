import { describe, it, expect, vi } from 'vitest';
import {
  getExtractMeApiUrl,
  getExtractMeDownloadUrl,
  getExtractMeZipUrl,
  DEFAULT_EXTRACT_ME_HOST,
  EXTRACT_ME_SITE_ID,
} from '../../src/worker/services/extractMe';

describe('extractMe service URL builders', () => {
  it('builds base API URL', () => {
    const url = getExtractMeApiUrl('s87.extract.io');
    expect(url).toBe('https://s87.extract.io/unarchiver');
  });

  it('builds individual file download URL', () => {
    const url = getExtractMeDownloadUrl('s87.extract.io', 'uid123', 'tmp_abc', 'subfolder/file.txt');
    expect(url).toBe('https://s87.extract.io/unarchiver/download_d/uid123/tmp_abc/subfolder%2Ffile.txt');
  });

  it('builds individual file download URL when uid is empty', () => {
    const url = getExtractMeDownloadUrl('s87.extract.io', '', 'tmp_abc', 'file.txt');
    expect(url).toBe('https://s87.extract.io/unarchiver/download_d/nouid/tmp_abc/file.txt');
  });

  it('builds ZIP download URL with uid', () => {
    const url = getExtractMeZipUrl('s87.extract.io', 'uid123', 'tmp_abc');
    expect(url).toBe('https://s87.extract.io/unarchiver/compress/zip/uid123/tmp_abc');
  });

  it('builds ZIP download URL without uid', () => {
    const url = getExtractMeZipUrl('s87.extract.io', '', 'tmp_abc');
    expect(url).toBe('https://s87.extract.io/unarchiver/compress/zip/nouid/tmp_abc');
  });

  it('uses default host and site ID constants', () => {
    expect(DEFAULT_EXTRACT_ME_HOST).toBe('s88.extract.me');
    expect(EXTRACT_ME_SITE_ID).toBe('unarchiver');
  });
});

describe('ExtractMeClient web service', () => {
  it('correctly encodes nested path parts with %2F for download URL', async () => {
    const { ExtractMeClient } = await import('../../src/web/services/extractMeClient');
    const client = new ExtractMeClient('s84.extract.me', 'testuid');
    const urls = client.getFileDownloadUrl('tmp123', ['subfolder', 'deep', 'hello.txt'], 'hello.txt');

    expect(urls.directUrl).toBe('https://s84.extract.me/unarchiver/download_d/testuid/tmp123/subfolder%2Fdeep%2Fhello.txt');
    expect(urls.proxiedUrl).toContain('/api/v1/converter/download?url=');
    expect(urls.proxiedUrl).toContain(encodeURIComponent(urls.directUrl));
  });

  it('normalizes legacy extract.io hosts to extract.me in constructor', async () => {
    const { ExtractMeClient } = await import('../../src/web/services/extractMeClient');
    const client = new ExtractMeClient('s87.extract.io');
    expect(client.host).toBe('s87.extract.me');
  });

  it('resolves actual zip download URL from compress endpoint response', async () => {
    const { ExtractMeClient } = await import('../../src/web/services/extractMeClient');
    const client = new ExtractMeClient('s84.extract.me', 'uid_abc');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/v1/converter/download') && url.includes('compress%2Fzip')) {
        return new Response(
          JSON.stringify({ download_url: '/download_compressed/s84_zipped.zip' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    try {
      const result = await client.requestZipDownload('tmp_abc', 'my-backup.zip');
      expect(result.directUrl).toBe('https://s84.extract.me/unarchiver/download_compressed/s84_zipped.zip');
      expect(result.proxiedUrl).toContain(encodeURIComponent(result.directUrl));
      expect(result.proxiedUrl).toContain('filename=my-backup.zip');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
