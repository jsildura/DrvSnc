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

  it('ingests server-side via extract-ingest (not open_remote) and resolves tmp_filename', async () => {
    const { ExtractMeClient } = await import('../../src/web/services/extractMeClient');
    const client = new ExtractMeClient('s88.extract.me', 'uid_test');

    const requestedUrls: string[] = [];
    let sawArchiveByteRequest = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      requestedUrls.push(url);
      // The browser must NOT pull raw archive bytes anymore — that now happens
      // worker-side. A ranged GET to the Drive download endpoint would be a regression.
      if (
        url.includes('/api/v1/drive/files/') &&
        url.includes('/download') &&
        (init?.method || 'GET').toUpperCase() !== 'HEAD'
      ) {
        sawArchiveByteRequest = true;
      }
      if (url.includes('/api/v1/drive/files/extract-ingest')) {
        // Worker relays the chunk and reports the accepting host + tmp filename.
        return new Response(
          JSON.stringify({ host: 's88.extract.me', tmpFilename: 'unarc_flow_123' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    // open_remote must NOT be used anymore — a WebSocket should never be constructed.
    const originalWs = globalThis.WebSocket;
    const wsSpy = vi.fn();
    (globalThis as any).WebSocket = wsSpy;

    try {
      const task = client.openFromDrive({
        fileId: 'gdrive-file-123',
        accessToken: 'mock-oauth-token',
        fileName: 'my-archive.zip',
        fileSize: 3,
        streamUrl: 'https://drvsnc.workers.dev/api/v1/converter/stream/my-archive.zip?ticket=test-ticket',
      });

      const res = await task.promise;
      expect(res.tmp_filename).toBe('unarc_flow_123');
      expect(res.archive_filename).toBe('my-archive.zip');

      // Verify the server-side ingest endpoint was used, no archive bytes crossed the
      // browser, and no WebSocket was opened.
      expect(requestedUrls.some((u) => u.includes('/api/v1/drive/files/extract-ingest'))).toBe(true);
      expect(sawArchiveByteRequest).toBe(false);
      expect(wsSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
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

  it('correctly classifies empty directories with children=[] as folders', async () => {
    const { ExtractMeClient } = await import('../../src/web/services/extractMeClient');
    const client = new ExtractMeClient('s88.extract.me', 'custom_session_uid');

    const tree = [
      {
        text: 'empty_folder',
        children: [],
        icon: 'folder',
      },
      {
        text: 'regular_file.txt',
        data: { size: 100 },
      },
    ];

    const flattened = client.flattenTree(tree);
    expect(flattened).toHaveLength(2);
    expect(flattened[0].name).toBe('empty_folder');
    expect(flattened[0].isFolder).toBe(true);
    expect(flattened[1].name).toBe('regular_file.txt');
    expect(flattened[1].isFolder).toBe(false);
  });
});

describe('ingestArchiveChunkToExtractMe server-side relay', () => {
  it('reads a Drive chunk and relays it to extract.me, returning host + tmp_filename', async () => {
    const { ingestArchiveChunkToExtractMe } = await import('../../src/worker/services/extractMe');
    const driveClient = await import('../../src/worker/services/driveClient');

    const downloadSpy = vi.spyOn(driveClient, 'downloadFile').mockResolvedValue({
      ok: true,
      status: 206,
      arrayBuffer: async () => new ArrayBuffer(3),
    } as any);

    const flowUrls: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = typeof input === 'string' ? input : input.toString();
      flowUrls.push(url);
      return new Response(JSON.stringify({ tmp_filename: 's88_temp_xyz.zip', error: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    try {
      const res = await ingestArchiveChunkToExtractMe({} as any, 'user-123', {
        fileId: 'gdrive-1',
        fileName: 'my-archive.zip',
        fileSize: 3,
        chunkNumber: 1,
        chunkSize: 8 * 1024 * 1024,
        totalChunks: 1,
        identifier: '3-myarchivezip',
        uid: 'uid_abc',
        host: 's88.extract.me',
      });

      expect(res.host).toBe('s88.extract.me');
      expect(res.tmpFilename).toBe('s88_temp_xyz.zip');

      // Read exactly the requested byte range from Drive
      expect(downloadSpy).toHaveBeenCalledWith({}, 'user-123', 'gdrive-1', 'bytes=0-2');
      // Relayed to the extract.me Flow.js upload endpoint carrying the client uid
      expect(flowUrls.some((u) => u.includes('/unarchiver/upload/flow/') && u.includes('uid=uid_abc'))).toBe(
        true
      );
    } finally {
      downloadSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it('never relays archive bytes to a disallowed host', async () => {
    const { ingestArchiveChunkToExtractMe, isAllowedExtractMeHost } = await import(
      '../../src/worker/services/extractMe'
    );

    // Guard the route relies on to reject bad hosts before the service is ever reached.
    expect(isAllowedExtractMeHost('evil.example.com')).toBe(false);
    expect(isAllowedExtractMeHost('s88.extract.me')).toBe(true);
    expect(isAllowedExtractMeHost('s85.extract.io')).toBe(true);

    const driveClient = await import('../../src/worker/services/driveClient');
    const downloadSpy = vi.spyOn(driveClient, 'downloadFile').mockResolvedValue({
      ok: true,
      status: 206,
      arrayBuffer: async () => new ArrayBuffer(3),
    } as any);

    const fetchTargets: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      fetchTargets.push(typeof input === 'string' ? input : input.toString());
      return new Response(JSON.stringify({ tmp_filename: 't.zip', error: 0 }), { status: 200 });
    });

    try {
      // A disallowed host on a mid-upload chunk has no valid fallback, so it must reject
      // outright without ever POSTing the bytes anywhere.
      await expect(
        ingestArchiveChunkToExtractMe({} as any, 'user-123', {
          fileId: 'gdrive-1',
          fileName: 'a.zip',
          fileSize: 20 * 1024 * 1024,
          chunkNumber: 2,
          chunkSize: 8 * 1024 * 1024,
          totalChunks: 3,
          identifier: '20971520-azip',
          uid: 'uid_abc',
          host: 'evil.example.com',
        })
      ).rejects.toThrow();

      // No relay POST reached the disallowed host.
      expect(fetchTargets.some((u) => u.includes('evil.example.com'))).toBe(false);
    } finally {
      downloadSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });
});

describe('uploadExtractedStreamToDrive zero-byte handling', () => {
  it('creates empty file directly on Google Drive when fileSize is 0 without calling engine', async () => {
    const { uploadExtractedStreamToDrive } = await import('../../src/worker/services/extractMe');
    const driveClient = await import('../../src/worker/services/driveClient');
    const createSpy = vi.spyOn(driveClient, 'createEmptyDriveFile').mockResolvedValue({
      id: 'empty_file_drive_id',
    } as any);

    const mockEnv = {} as any;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await uploadExtractedStreamToDrive(mockEnv, 'user-123', {
      downloadUrl: 'https://s88.extract.me/unarchiver/download_d/uid/tmp/empty.txt',
      fileName: 'empty.txt',
      destinationFolderId: 'folder-123',
      fileSize: 0,
    });

    expect(res.fileId).toBe('empty_file_drive_id');
    expect(res.fileName).toBe('empty.txt');
    expect(createSpy).toHaveBeenCalledWith(mockEnv, 'user-123', {
      name: 'empty.txt',
      mimeType: 'application/octet-stream',
      folderId: 'folder-123',
    });
    // Upstream engine should not have been called
    expect(fetchSpy).not.toHaveBeenCalled();

    createSpy.mockRestore();
    fetchSpy.mockRestore();
  });
});

