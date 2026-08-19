import { describe, it, expect, beforeAll, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from './testDb';
import { hashOpaqueToken, encryptSecret } from '../../src/worker/services/crypto';
import { DrivePage, QuotaView, PermissionView } from '../../src/shared/contracts';

describe('Drive API Endpoints (/api/v1/drive/*)', () => {
  const userId = 'usr-drive-test';
  const rawToken = 'raw-session-token-drive-test';
  const csrfToken = 'csrf-token-drive-test';
  const cookie = `gdu_session=${rawToken}; gdu_csrf=${csrfToken}`;

  beforeAll(async () => {
    await applyMigrations(env.DB);

    // Seed test user
    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userId, 'sub-drive-test', 'drive-user@example.com', 'Drive User', null)
      .run();

    // Seed encrypted credentials
    const enc = await encryptSecret('mock-refresh-token-value', env.TOKEN_ENCRYPTION_KEY, userId);
    await env.DB.prepare(
      `INSERT INTO google_credentials (user_id, ciphertext, iv, key_version)
       VALUES (?, ?, ?, ?)`
    )
      .bind(userId, enc.ciphertext, enc.iv, enc.keyVersion)
      .run();

    // Seed active session
    const tokenHash = await hashOpaqueToken(rawToken);
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`
    )
      .bind('sess-drive-test', userId, tokenHash, csrfToken)
      .run();
  });

  it('GET /api/v1/drive/items returns 401 when unauthenticated', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/drive/items');
    expect(res.status).toBe(401);
  });

  it('POST /api/v1/drive/folders returns 403 without CSRF token', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/drive/folders', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'New Folder' }),
    });
    expect(res.status).toBe(403);
  });

  it('performs Drive operations with mock Google API and automatic token refresh', async () => {
    const originalFetch = globalThis.fetch;
    let refreshCount = 0;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      // Google Token Refresh
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        refreshCount++;
        return new Response(
          JSON.stringify({
            access_token: 'mock-fresh-access-token',
            expires_in: 3600,
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // About / Quota
      if (urlStr.includes('googleapis.com/drive/v3/about')) {
        return new Response(
          JSON.stringify({
            storageQuota: {
              limit: '16106127360',
              usage: '5368709120',
              usageInDrive: '4294967296',
              usageInDriveTrash: '1073741824',
            },
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Files list / search / query
      if (urlStr.includes('googleapis.com/drive/v3/files') && (!init || init.method === 'GET' || !init.method)) {
        if (urlStr.includes('alt=media')) {
          return new Response('Mock binary file content', {
            status: 200,
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Length': '23',
            },
          });
        }

        if (urlStr.includes('/permissions')) {
          return new Response(
            JSON.stringify({
              permissions: [
                {
                  id: 'perm-1',
                  role: 'writer',
                  type: 'user',
                  emailAddress: 'collab@example.com',
                  displayName: 'Collab User',
                },
              ],
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({
            files: [
              {
                id: 'file-doc-1',
                name: 'Document.pdf',
                mimeType: 'application/pdf',
                size: '2048',
                shared: false,
                trashed: false,
                modifiedTime: '2026-08-18T10:00:00.000Z',
              },
            ],
            nextPageToken: null,
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Folder creation
      if (urlStr.includes('googleapis.com/drive/v3/files') && init?.method === 'POST') {
        if (urlStr.includes('/permissions')) {
          return new Response(
            JSON.stringify({
              id: 'perm-new',
              role: 'reader',
              type: 'anyone',
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        }

        const body = JSON.parse(init.body as string);
        return new Response(
          JSON.stringify({
            id: 'folder-new-123',
            name: body.name,
            mimeType: body.mimeType,
            shared: false,
            trashed: false,
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // File update (rename, move, trash, restore)
      if (urlStr.includes('googleapis.com/drive/v3/files/') && init?.method === 'PATCH') {
        const body = init.body ? JSON.parse(init.body as string) : {};
        return new Response(
          JSON.stringify({
            id: 'file-doc-1',
            name: body.name || 'Document.pdf',
            mimeType: 'application/pdf',
            trashed: body.trashed ?? false,
            shared: false,
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Delete file
      if (urlStr.includes('googleapis.com/drive/v3/files/') && init?.method === 'DELETE') {
        return new Response('', { status: 204 });
      }

      return originalFetch(input, init);
    });

    try {
      // 1. Test GET Quota
      const quotaRes = await SELF.fetch('https://example.com/api/v1/drive/quota', {
        headers: { Cookie: cookie },
      });
      expect(quotaRes.status).toBe(200);
      const quota = await quotaRes.json<QuotaView>();
      expect(quota.limit).toBe(16106127360);
      expect(quota.usage).toBe(5368709120);

      // 2. Test GET Items
      const itemsRes = await SELF.fetch('https://example.com/api/v1/drive/items', {
        headers: { Cookie: cookie },
      });
      expect(itemsRes.status).toBe(200);
      const page = await itemsRes.json<DrivePage>();
      expect(page.items).toHaveLength(1);
      expect(page.items[0].name).toBe('Document.pdf');

      // 3. Test POST Folder
      const createFolderRes = await SELF.fetch('https://example.com/api/v1/drive/folders', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'X-CSRF-Token': csrfToken,
          Origin: 'https://example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Project Alpha' }),
      });
      expect(createFolderRes.status).toBe(200);
      const folderData = await createFolderRes.json<{ id: string; name: string; isFolder: boolean }>();
      expect(folderData.id).toBe('folder-new-123');
      expect(folderData.isFolder).toBe(true);

      // 4. Test Trash & Restore
      const trashRes = await SELF.fetch('https://example.com/api/v1/drive/items/file-doc-1/trash', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'X-CSRF-Token': csrfToken,
          Origin: 'https://example.com',
        },
      });
      expect(trashRes.status).toBe(200);

      const restoreRes = await SELF.fetch('https://example.com/api/v1/drive/items/file-doc-1/restore', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'X-CSRF-Token': csrfToken,
          Origin: 'https://example.com',
        },
      });
      expect(restoreRes.status).toBe(200);

      // 5. Test Download stream
      const downloadRes = await SELF.fetch('https://example.com/api/v1/drive/files/file-doc-1/download', {
        headers: { Cookie: cookie },
      });
      expect(downloadRes.status).toBe(200);
      const text = await downloadRes.text();
      expect(text).toBe('Mock binary file content');

      // 6. Test Permissions
      const permRes = await SELF.fetch('https://example.com/api/v1/drive/files/file-doc-1/permissions', {
        headers: { Cookie: cookie },
      });
      expect(permRes.status).toBe(200);
      const perms = await permRes.json<{ permissions: PermissionView[] }>();
      expect(perms.permissions).toHaveLength(1);
      expect(perms.permissions[0].role).toBe('writer');

      expect(refreshCount).toBeGreaterThanOrEqual(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
