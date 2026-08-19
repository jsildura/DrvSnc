import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSeedrDeviceCode,
  pollSeedrDeviceAuthorization,
  saveSeedrCredentials,
  getSeedrCredentials,
  deleteSeedrCredentials,
  addSeedrMagnet,
  getSeedrContents,
} from '../../src/worker/services/seedrClient';

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

    globalThis.fetch = vi.fn().mockImplementation(async (url, opts: any) => {
      const body = opts?.body?.toString() || '';
      if (body.includes('action=add_torrent')) {
        return {
          ok: true,
          json: async () => ({ result: true, user_torrent_id: 999, title: 'Test ISO' }),
        };
      }
      if (body.includes('action=list_contents')) {
        return {
          ok: true,
          json: async () => ({
            space_used: 1000,
            space_max: 2000,
            torrents: [],
            folders: [],
            files: [{ id: 456, name: 'test.iso', size: 1000 }],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const addResult = await addSeedrMagnet(mockEnv, 'user-1', 'magnet:?xt=urn:btih:123');
    expect(addResult.result).toBe(true);
    expect(addResult.user_torrent_id).toBe(999);

    const contents = await getSeedrContents(mockEnv, 'user-1');
    expect(contents.files.length).toBe(1);
    expect(contents.files[0].name).toBe('test.iso');
  });
});
