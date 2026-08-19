import { describe, it, expect, beforeAll, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from './testDb';
import { hashOpaqueToken, encryptSecret } from '../../src/worker/services/crypto';

describe('Batch Empty Trash API (/api/v1/drive/trash/empty)', () => {
  const userId = 'usr-trash-batch-1';
  const rawToken = 'raw-session-trash-batch-1';
  const csrfToken = 'csrf-trash-batch-1';
  const cookie = `gdu_session=${rawToken}; gdu_csrf=${csrfToken}`;

  beforeAll(async () => {
    await applyMigrations(env.DB);

    // Seed User
    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userId, 'sub-trash-batch', 'trash@example.com', 'Trash User', null)
      .run();

    const enc = await encryptSecret('refresh-trash-batch', env.TOKEN_ENCRYPTION_KEY, userId);
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
      .bind('sess-trash-batch', userId, tokenHash, csrfToken)
      .run();
  });

  it('requires CSRF token to empty trash', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/drive/trash/empty', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: 'https://example.com',
      },
    });

    expect(res.status).toBe(403);
  });

  it('executes empty trash with mock Google API', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({ access_token: 'mock-trash-access-token', expires_in: 3600 }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (urlStr.includes('googleapis.com/drive/v3/files/trash')) {
        return new Response(null, { status: 204 });
      }

      return originalFetch(input, init);
    });

    try {
      const res = await SELF.fetch('https://example.com/api/v1/drive/trash/empty', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'X-CSRF-Token': csrfToken,
          Origin: 'https://example.com',
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json<{ success: boolean }>();
      expect(data.success).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
