import { describe, it, expect, beforeAll, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from './testDb';
import { hashOpaqueToken } from '../../src/worker/services/crypto';

describe('Account Deletion & Revocation API (/api/v1/account)', () => {
  const userId = 'usr-account-test';
  const rawToken = 'raw-session-token-account-test';
  const csrfToken = 'csrf-token-account-test';
  const sessionCookie = `gdu_session=${rawToken}`;
  const csrfCookie = `gdu_csrf=${csrfToken}`;

  beforeAll(async () => {
    await applyMigrations(env.DB);

    // Seed test user
    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userId, 'sub-account-test', 'delete-me@example.com', 'Delete Me', null)
      .run();

    // Seed encrypted credentials
    await env.DB.prepare(
      `INSERT INTO google_credentials (user_id, ciphertext, iv, key_version)
       VALUES (?, ?, ?, ?)`
    )
      .bind(userId, 'ciphertext-secret', 'iv-secret', 1)
      .run();

    // Seed active session
    const tokenHash = await hashOpaqueToken(rawToken);
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`
    )
      .bind('sess-account-test', userId, tokenHash, csrfToken)
      .run();

    // Seed active and queued jobs
    await env.DB.prepare(
      `INSERT INTO upload_jobs (id, user_id, source_kind, filename, file_size, mime_type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind('job-active-1', userId, 'local', 'active.mp4', 5000, 'video/mp4', 'uploading')
      .run();

    await env.DB.prepare(
      `INSERT INTO upload_jobs (id, user_id, source_kind, filename, file_size, mime_type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind('job-completed-1', userId, 'local', 'done.mp4', 5000, 'video/mp4', 'completed')
      .run();
  });

  it('DELETE /api/v1/account returns 401 without session', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/account', {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });

  it('DELETE /api/v1/account returns 403 without CSRF token', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/account', {
      method: 'DELETE',
      headers: {
        Cookie: `${sessionCookie}; ${csrfCookie}`,
      },
    });
    expect(res.status).toBe(403);
  });

  it('DELETE /api/v1/account cancels jobs, deletes credentials/sessions, and revokes access', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.includes('oauth2.googleapis.com/revoke')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return originalFetch(input, init);
    });

    try {
      const res = await SELF.fetch('https://example.com/api/v1/account', {
        method: 'DELETE',
        headers: {
          Cookie: `${sessionCookie}; ${csrfCookie}`,
          'X-CSRF-Token': csrfToken,
          Origin: 'https://example.com',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json<{ success: boolean }>();
      expect(body.success).toBe(true);

      // Verify cookies are cleared
      const setCookie = res.headers.get('Set-Cookie') || '';
      expect(setCookie).toContain('gdu_session=;');
      expect(setCookie).toContain('Max-Age=0');

      // Verify google_credentials deleted
      const creds = await env.DB.prepare('SELECT * FROM google_credentials WHERE user_id = ?')
        .bind(userId)
        .first();
      expect(creds).toBeNull();

      // Verify sessions deleted
      const sessions = await env.DB.prepare('SELECT * FROM sessions WHERE user_id = ?')
        .bind(userId)
        .all();
      expect(sessions.results).toHaveLength(0);

      // Verify non-terminal jobs transitioned to canceled
      const activeJob = await env.DB.prepare('SELECT status FROM upload_jobs WHERE id = ?')
        .bind('job-active-1')
        .first<{ status: string }>();
      expect(activeJob?.status).toBe('canceled');

      // Verify completed job remains completed
      const doneJob = await env.DB.prepare('SELECT status FROM upload_jobs WHERE id = ?')
        .bind('job-completed-1')
        .first<{ status: string }>();
      expect(doneJob?.status).toBe('completed');

      // Verify user marked revoked
      const user = await env.DB.prepare('SELECT revoked_at FROM users WHERE id = ?')
        .bind(userId)
        .first<{ revoked_at: string | null }>();
      expect(user?.revoked_at).not.toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
