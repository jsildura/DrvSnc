import { describe, it, expect, beforeAll, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from './testDb';
import { hashOpaqueToken, encryptSecret } from '../../src/worker/services/crypto';
import { BatchDriveResponse } from '../../src/shared/contracts';

describe('Batch Drive Operations API (/api/v1/drive/batch)', () => {
  const userId = 'usr-batch-drive-1';
  const rawToken = 'raw-session-batch-drive-1';
  const csrfToken = 'csrf-batch-drive-1';
  const cookie = `gdu_session=${rawToken}; gdu_csrf=${csrfToken}`;

  beforeAll(async () => {
    await applyMigrations(env.DB);

    // Seed User
    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userId, 'sub-batch-drive', 'batch@example.com', 'Batch User', null)
      .run();

    const enc = await encryptSecret('refresh-batch-drive', env.TOKEN_ENCRYPTION_KEY, userId);
    await env.DB.prepare(
      `INSERT INTO google_credentials (user_id, ciphertext, iv, key_version)
       VALUES (?, ?, ?, ?)`
    )
      .bind(userId, enc.ciphertext, enc.iv, 1)
      .run();

    const tokenHash = await hashOpaqueToken(rawToken);
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`
    )
      .bind('sess-batch-drive', userId, tokenHash, csrfToken)
      .run();
  });

  it('rejects batch operations without CSRF token (403)', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/drive/batch', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: 'https://example.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'trash', itemIds: ['file-1'] }),
    });

    expect(res.status).toBe(403);
  });

  it('rejects invalid action or empty itemIds (400)', async () => {
    // Empty itemIds
    const resEmpty = await SELF.fetch('https://example.com/api/v1/drive/batch', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-CSRF-Token': csrfToken,
        Origin: 'https://example.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'trash', itemIds: [] }),
    });
    expect(resEmpty.status).toBe(400);

    // Invalid action
    const resInvalid = await SELF.fetch('https://example.com/api/v1/drive/batch', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-CSRF-Token': csrfToken,
        Origin: 'https://example.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'explode', itemIds: ['file-1'] }),
    });
    expect(resInvalid.status).toBe(400);
  });

  it('requires destinationFolderId when action is move (400)', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/drive/batch', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-CSRF-Token': csrfToken,
        Origin: 'https://example.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'move', itemIds: ['file-1'] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: { message: string } }>();
    expect(body.error.message).toContain('destinationFolderId is required');
  });

  it('executes batch operations using Google Batch multipart API endpoint', async () => {
    const originalFetch = globalThis.fetch;
    let batchEndpointCalled = false;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({ access_token: 'mock-batch-access-token', expires_in: 3600 }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (urlStr.includes('googleapis.com/batch/drive/v3')) {
        batchEndpointCalled = true;
        const boundary = 'batch_response_boundary';
        const multipartBody = [
          `--${boundary}`,
          'Content-Type: application/http',
          'Content-ID: <response-file-1>',
          '',
          'HTTP/1.1 200 OK',
          'Content-Type: application/json; charset=UTF-8',
          '',
          JSON.stringify({
            id: 'file-1',
            name: 'Document 1.pdf',
            mimeType: 'application/pdf',
            trashed: true,
            shared: false,
          }),
          `--${boundary}`,
          'Content-Type: application/http',
          'Content-ID: <response-file-2>',
          '',
          'HTTP/1.1 200 OK',
          'Content-Type: application/json; charset=UTF-8',
          '',
          JSON.stringify({
            id: 'file-2',
            name: 'Document 2.pdf',
            mimeType: 'application/pdf',
            trashed: true,
            shared: false,
          }),
          `--${boundary}--`,
        ].join('\r\n');

        return new Response(multipartBody, {
          status: 200,
          headers: {
            'Content-Type': `multipart/mixed; boundary="${boundary}"`,
          },
        });
      }

      return originalFetch(input, init);
    });

    try {
      const res = await SELF.fetch('https://example.com/api/v1/drive/batch', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'X-CSRF-Token': csrfToken,
          Origin: 'https://example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'trash',
          itemIds: ['file-1', 'file-2'],
        }),
      });

      expect(res.status).toBe(200);
      expect(batchEndpointCalled).toBe(true);

      const data = await res.json<BatchDriveResponse>();
      expect(data.success).toBe(true);
      expect(data.action).toBe('trash');
      expect(data.total).toBe(2);
      expect(data.succeeded).toBe(2);
      expect(data.failed).toBe(0);
      expect(data.results[0].id).toBe('file-1');
      expect(data.results[0].success).toBe(true);
      expect(data.results[0].item?.trashed).toBe(true);
      expect(data.results[1].id).toBe('file-2');
      expect(data.results[1].success).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('gracefully falls back to individual requests when batch endpoint fails', async () => {
    const originalFetch = globalThis.fetch;
    const individualCalls: string[] = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({ access_token: 'mock-batch-access-token', expires_in: 3600 }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Simulate batch endpoint rejecting or failing (e.g. 400 or network error)
      if (urlStr.includes('googleapis.com/batch/drive/v3')) {
        return new Response('Bad Request', { status: 400 });
      }

      // Individual fallback calls
      if (urlStr.includes('googleapis.com/drive/v3/files/')) {
        individualCalls.push(urlStr);
        const match = urlStr.match(/files\/([^?]+)/);
        const id = match ? match[1] : 'unknown';
        return new Response(
          JSON.stringify({
            id,
            name: `Item ${id}.pdf`,
            mimeType: 'application/pdf',
            starred: true,
            trashed: false,
            shared: false,
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      return originalFetch(input, init);
    });

    try {
      const res = await SELF.fetch('https://example.com/api/v1/drive/batch', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'X-CSRF-Token': csrfToken,
          Origin: 'https://example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'star',
          itemIds: ['file-alpha', 'file-beta'],
        }),
      });

      expect(res.status).toBe(200);
      expect(individualCalls.length).toBe(2);

      const data = await res.json<BatchDriveResponse>();
      expect(data.success).toBe(true);
      expect(data.action).toBe('star');
      expect(data.total).toBe(2);
      expect(data.succeeded).toBe(2);
      expect(data.results[0].id).toBe('file-alpha');
      expect(data.results[0].success).toBe(true);
      expect(data.results[0].item?.starred).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
