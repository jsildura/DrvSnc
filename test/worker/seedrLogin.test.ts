import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from './testDb';
import { hashOpaqueToken, encryptSecret } from '../../src/worker/services/crypto';

describe('POST /api/v1/seedr/login', () => {
  const userId = 'usr-seedr-login';
  const rawToken = 'raw-session-seedr-login';
  const csrfToken = 'csrf-seedr-login';
  const cookie = `gdu_session=${rawToken}; gdu_csrf=${csrfToken}`;

  let originalFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    await applyMigrations(env.DB);

    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userId, 'sub-seedr-login', 'login@example.com', 'Login User', null)
      .run();

    const enc = await encryptSecret('refresh-token', env.TOKEN_ENCRYPTION_KEY, userId);
    await env.DB.prepare(
      `INSERT INTO google_credentials (user_id, ciphertext, iv, key_version) VALUES (?, ?, ?, ?)`
    )
      .bind(userId, enc.ciphertext, enc.iv, enc.keyVersion)
      .run();

    const tokenHash = await hashOpaqueToken(rawToken);
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`
    )
      .bind('sess-seedr-login', userId, tokenHash, csrfToken)
      .run();
  });

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    await env.DB.prepare('DELETE FROM seedr_credentials WHERE user_id = ?').bind(userId).run();
  });

  /** Stub Seedr's token.php, the only upstream call the login route makes. */
  function mockSeedrToken(payload: unknown, init: { ok?: boolean; status?: number } = {}) {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('token.php')) {
        return new Response(JSON.stringify(payload), {
          status: init.ok === false ? init.status || 400 : 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch to ${url}`);
    }) as typeof globalThis.fetch;
  }

  function login() {
    return SELF.fetch('https://example.com/api/v1/seedr/login', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-CSRF-Token': csrfToken,
        Origin: 'https://example.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'login@example.com', password: 'seedr-pass' }),
    });
  }

  it('stores the connection when Seedr accepts the credentials', async () => {
    mockSeedrToken({ access_token: 'seedr-access', refresh_token: 'seedr-refresh' });

    const res = await login();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, username: 'login@example.com' });

    const row = await env.DB.prepare(
      'SELECT seedr_username FROM seedr_credentials WHERE user_id = ?'
    )
      .bind(userId)
      .first<{ seedr_username: string }>();
    expect(row?.seedr_username).toBe('login@example.com');
  });

  it('answers 401 only when Seedr itself rejects the credentials', async () => {
    mockSeedrToken({ error: 'invalid_grant', error_description: 'Wrong password' }, { ok: false });

    const res = await login();
    expect(res.status).toBe(401);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain('Wrong password');
  });

  it('answers 500, not 401, when the login succeeds but persistence fails', async () => {
    // Reproduces the live outage: migration 0004 was never applied to production, so
    // the INSERT hit "no such table: seedr_credentials" and users were told their
    // password was wrong.
    mockSeedrToken({ access_token: 'seedr-access', refresh_token: 'seedr-refresh' });

    const realPrepare = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, 'prepare').mockImplementation((query: string) => {
      if (query.includes('INSERT INTO seedr_credentials')) {
        throw new Error('D1_ERROR: no such table: seedr_credentials: SQLITE_ERROR');
      }
      return realPrepare(query);
    });

    const res = await login();
    expect(res.status).toBe(500);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain('no such table: seedr_credentials');
    expect(body.error).toContain('saving the connection failed');
  });
});
