import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSeedrDeviceCode,
  pollSeedrDeviceAuthorization,
  saveSeedrCredentials,
  getSeedrCredentials,
  deleteSeedrCredentials,
  addSeedrMagnet,
  getSeedrContents,
  createSeedrArchiveUrl,
  deleteSeedrItem,
} from '../../src/worker/services/seedrClient';

/** Seedr answers resource.php with a JSON body the client reads as text. */
function seedrResponse(payload: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
  };
}

describe('Seedr Client Service', () => {
  let dbStore: Record<string, any> = {};

  const mockEnv: any = {
    TOKEN_ENCRYPTION_KEY: 'test-key-32-chars-long-1234567890',
    DB: {
      prepare: vi.fn((query: string) => ({
        bind: (...args: any[]) => ({
          run: async () => {
            if (query.includes('INSERT INTO seedr_credentials')) {
              dbStore[args[0]] = {
                user_id: args[0],
                encrypted_access_token: args[1],
                encrypted_refresh_token: args[2],
                seedr_username: args[3],
              };
            }
            if (query.includes('DELETE FROM seedr_credentials')) {
              delete dbStore[args[0]];
            }
            return { success: true };
          },
          first: async () => {
            if (query.includes('SELECT')) {
              return dbStore[args[0]] || null;
            }
            return null;
          },
        }),
      })),
    },
  };

  beforeEach(() => {
    dbStore = {};
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('fetches device code from Seedr API', async () => {
    const mockResponse = {
      device_code: 'dev-123',
      user_code: 'ABC-DEF',
      verification_url: 'https://www.seedr.cc/devices',
      expires_in: 300,
      interval: 5,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as any);

    const res = await getSeedrDeviceCode();
    expect(res.user_code).toBe('ABC-DEF');
    expect(res.device_code).toBe('dev-123');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/device/code?client_id=seedr_xbmc')
    );
  });

  it('polls device authorization status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        access_token: 'seedr-access-token',
        refresh_token: 'seedr-refresh-token',
        expires_in: 3600,
      }),
    } as any);

    const authRes = await pollSeedrDeviceAuthorization('dev-123');
    expect(authRes.status).toBe(true);
    expect(authRes.tokens?.access_token).toBe('seedr-access-token');
  });

  it('saves, retrieves, and deletes encrypted credentials in D1', async () => {
    await saveSeedrCredentials(
      mockEnv,
      'user-1',
      'my-seedr-access-token',
      'my-seedr-refresh-token',
      'Test Seedr User'
    );

    const retrieved = await getSeedrCredentials(mockEnv, 'user-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.accessToken).toBe('my-seedr-access-token');
    expect(retrieved?.refreshToken).toBe('my-seedr-refresh-token');
    expect(retrieved?.username).toBe('Test Seedr User');

    await deleteSeedrCredentials(mockEnv, 'user-1');
    const deleted = await getSeedrCredentials(mockEnv, 'user-1');
    expect(deleted).toBeNull();
  });

  it('adds a magnet link to Seedr and lists contents', async () => {
    await saveSeedrCredentials(mockEnv, 'user-1', 'valid-access-token');

    const bodies: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (url, opts: any) => {
      const body = opts?.body?.toString() || '';
      bodies.push(body);
      if (body.includes('func=add_torrent')) {
        return seedrResponse({ result: true, user_torrent_id: 999, title: 'Test ISO' });
      }
      if (body.includes('func=list_contents')) {
        return seedrResponse({
          space_used: 1000,
          space_max: 2000,
          torrents: [],
          folders: [],
          files: [{ id: 456, name: 'test.iso', size: 1000 }],
        });
      }
      return seedrResponse({});
    });

    const addResult = await addSeedrMagnet(mockEnv, 'user-1', 'magnet:?xt=urn:btih:123');
    expect(addResult.result).toBe(true);
    expect(addResult.user_torrent_id).toBe(999);

    const contents = await getSeedrContents(mockEnv, 'user-1');
    expect(contents.files.length).toBe(1);
    expect(contents.files[0].name).toBe('test.iso');

    // list_contents keys off content_id; folder_id alone always returns the root.
    await getSeedrContents(mockEnv, 'user-1', '778899');
    expect(new URLSearchParams(bodies[bodies.length - 1]).get('content_id')).toBe('778899');
  });

  it('creates a folder archive with the fetch_archive shape Seedr expects', async () => {
    await saveSeedrCredentials(mockEnv, 'user-1', 'valid-access-token');

    const requests: Array<{ url: string; body: string }> = [];
    globalThis.fetch = vi.fn().mockImplementation(async (url, opts: any) => {
      const body = opts?.body?.toString() || '';
      requests.push({ url: String(url), body });
      if (String(url).includes('func=fetch_archive')) {
        return seedrResponse({
          result: true,
          url: 'https://nw31.seedr.cc/get_zip_ngen_free/12345/Release.zip?st=abc&e=1787219472',
        });
      }
      return seedrResponse({ result: false, error: 'unknown_func' }, { ok: false, status: 404 });
    });

    const url = await createSeedrArchiveUrl(mockEnv, 'user-1', '12345');
    // The live API answers with `url`, not `archive_url`.
    expect(url).toBe(
      'https://nw31.seedr.cc/get_zip_ngen_free/12345/Release.zip?st=abc&e=1787219472'
    );

    // One request only: create_empty_archive/create_archive are gone, not fallbacks.
    expect(requests).toHaveLength(1);

    const params = new URLSearchParams(requests[0].body);
    expect(params.get('func')).toBe('fetch_archive');
    expect(params.get('archive_arr')).toBe('[{"type":"folder","id":12345}]');
    expect(params.get('folder_id')).toBeNull();
    // resource.php ignores `action` entirely — sending it implies a dispatch key that
    // does not exist (action alone answers {"error":"unknown_func","func":null}).
    expect(params.get('action')).toBeNull();
    expect(new URL(requests[0].url).searchParams.get('action')).toBeNull();
  });

  it('surfaces reason_phrase, the shape Seedr uses for handler-level failures', async () => {
    await saveSeedrCredentials(mockEnv, 'user-1', 'valid-access-token');

    globalThis.fetch = vi.fn().mockResolvedValue(
      seedrResponse(
        { status_code: 400, reason_phrase: 'Folder not found' },
        { ok: false, status: 400 }
      )
    );

    await expect(createSeedrArchiveUrl(mockEnv, 'user-1', 42)).rejects.toThrow(
      /fetch_archive.*400.*Folder not found/
    );
  });

  it('surfaces the upstream Seedr response body when a request fails', async () => {
    await saveSeedrCredentials(mockEnv, 'user-1', 'valid-access-token');

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        seedrResponse({ error: 'folder is still downloading' }, { ok: false, status: 400 })
      );

    await expect(createSeedrArchiveUrl(mockEnv, 'user-1', 42)).rejects.toThrow(
      /fetch_archive.*400.*folder is still downloading/
    );
  });

  it('deletes a Seedr item with an unquoted id and reports upstream failures', async () => {
    await saveSeedrCredentials(mockEnv, 'user-1', 'valid-access-token');

    let lastBody = '';
    globalThis.fetch = vi.fn().mockImplementation(async (_url, opts: any) => {
      lastBody = opts?.body?.toString() || '';
      return seedrResponse({ result: true });
    });

    await deleteSeedrItem(mockEnv, 'user-1', 'folder', '555');
    expect(new URLSearchParams(lastBody).get('delete_arr')).toBe(
      '[{"type":"folder","id":555}]'
    );

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(seedrResponse({ result: false, error: 'item not found' }));

    await expect(deleteSeedrItem(mockEnv, 'user-1', 'file', 9)).rejects.toThrow('item not found');
  });
});
