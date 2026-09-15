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

  it('uses public streamUrl as remote_url in WebSocket open_remote payload', async () => {
    const { ExtractMeClient } = await import('../../src/web/services/extractMeClient');
    const client = new ExtractMeClient('s88.extract.me', 'uid_test');

    const sentMessages: string[] = [];
    class MockWebSocket {
      readyState = 1;
      onopen: (() => void) | null = null;
      onmessage: ((ev: { data: any }) => void) | null = null;
      onerror: ((err: any) => void) | null = null;
      onclose: (() => void) | null = null;

      constructor() {
        setTimeout(() => {
          this.onopen?.();
          this.onmessage?.({ data: '0{"sid":"mock-sid"}' });
        }, 5);
      }

      send(data: string) {
        sentMessages.push(data);
        if (data === '40') {
          setTimeout(() => {
            this.onmessage?.({ data: '40' });
          }, 5);
        } else if (data.startsWith('42["open_remote"')) {
          setTimeout(() => {
            this.onmessage?.({
              data: '42["open_remote",{"message_type":"final_result","tmp_filename":"unarc_123"}]',
            });
          }, 5);
        }
      }

      close() {}
    }

    const originalWs = globalThis.WebSocket;
    (globalThis as any).WebSocket = MockWebSocket;

    try {
      const task = client.openFromDrive({
        fileId: 'gdrive-file-123',
        accessToken: 'mock-oauth-token',
        fileName: 'my-archive.zip',
        fileSize: 50000000,
        streamUrl: 'https://drvsnc.workers.dev/api/v1/converter/stream/my-archive.zip?ticket=test-ticket',
      });

      const res = await task.promise;
      expect(res.tmp_filename).toBe('unarc_123');

      const openRemoteMsg = sentMessages.find((m) => m.startsWith('42["open_remote"'));
      expect(openRemoteMsg).toBeDefined();
      const parsed = JSON.parse(openRemoteMsg!.substring(2));
      expect(parsed[0]).toBe('open_remote');
      expect(parsed[1].remote_url).toBe(
        'https://drvsnc.workers.dev/api/v1/converter/stream/my-archive.zip?ticket=test-ticket'
      );
      // HTTP stream URLs must include params matching extract.me's URL-open format
      expect(parsed[1].params).toBeDefined();
      expect(parsed[1].params.original_filename).toBe('my-archive.zip');
      expect(parsed[1].params.filesize).toBe(50000000);
      expect(parsed[1].params.secondary).toBe(false);
      expect(parsed[1].ud).toBe(1);
      expect(parsed[1].params.ud).toBe(1);
    } finally {
      globalThis.WebSocket = originalWs;
    }
  });

  it('passes client uid to unpackArchive', async () => {
    const { ExtractMeClient } = await import('../../src/web/services/extractMeClient');
    const driveApi = await import('../../src/web/api/drive');
    const spy = vi.spyOn(driveApi, 'unpackArchive').mockResolvedValue({
      tree: [{ text: 'file.txt' }],
    });

    const client = new ExtractMeClient('s88.extract.me', 'custom_session_uid');
    const res = await client.unpack({
      tmp_filename: 's88_temp_123.zip',
      archive_filename: 'test.zip',
    });

    expect(spy).toHaveBeenCalledWith({
      host: 's88.extract.me',
      tmp_filename: 's88_temp_123.zip',
      archive_filename: 'test.zip',
      password: undefined,
      uid: 'custom_session_uid',
    });
    expect(res.tree_data).toEqual([{ text: 'file.txt' }]);
    spy.mockRestore();
  });
});
