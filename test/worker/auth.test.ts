import { describe, it, expect, beforeAll, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from './testDb';
import { hashOpaqueToken } from '../../src/worker/services/crypto';

describe('Authentication, Sessions, CSRF, and Google OAuth Routes', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  describe('GET /api/v1/auth/google/start', () => {
    it('generates PKCE state and redirects to Google OAuth endpoint', async () => {
      const res = await SELF.fetch('https://example.com/api/v1/auth/google/start?login_hint=test%40example.com', {
        redirect: 'manual',
      });

      expect(res.status).toBe(302);
      const location = res.headers.get('Location');
      expect(location).toBeDefined();

      const url = new URL(location!);
      expect(url.hostname).toBe('accounts.google.com');
      expect(url.pathname).toBe('/o/oauth2/v2/auth');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('select_account consent');
      expect(url.searchParams.get('login_hint')).toBe('test@example.com');
      expect(url.searchParams.get('code_challenge')).toBeDefined();
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');

      const state = url.searchParams.get('state');
      expect(state).toBeDefined();

      // Check state in D1
      const savedState = await env.DB.prepare('SELECT * FROM oauth_states WHERE state = ?')
        .bind(state!)
        .first<{ state: string; code_verifier: string; expires_at: string }>();

      expect(savedState).not.toBeNull();
      expect(savedState?.code_verifier).toBeDefined();
    });
  });

  describe('GET /api/v1/auth/google/callback', () => {
    it('rejects missing or invalid state', async () => {
      const res = await SELF.fetch('https://example.com/api/v1/auth/google/callback?state=invalid&code=abc', {
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toContain('error=invalid_state');
    });

    it('consumes state one-time and establishes session on valid OAuth exchange', async () => {
      // 1. Create a state in D1
      const testState = 'valid-test-state-12345';
      const testVerifier = 'test-code-verifier-string-long-enough';
      await env.DB.prepare(
        `INSERT INTO oauth_states (state, code_verifier, redirect_uri, expires_at)
         VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+10 minutes'))`
      )
        .bind(testState, testVerifier, 'https://example.com/api/v1/auth/google/callback')
        .run();

      // 2. Mock fetch for Google OAuth token and userinfo
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'ya29.mock_access_token',
              refresh_token: '1//mock_refresh_token_value',
              expires_in: 3600,
              token_type: 'Bearer',
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (urlStr.includes('googleapis.com/oauth2/v3/userinfo')) {
          return new Response(
            JSON.stringify({
              sub: 'google-sub-99999',
              email: 'testuser@example.com',
              name: 'Test OAuth User',
              picture: 'https://example.com/pic.png',
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        }

        return originalFetch(input, init);
      });

      try {
        const res = await SELF.fetch(
          `https://example.com/api/v1/auth/google/callback?state=${testState}&code=mock-auth-code`,
          { redirect: 'manual' }
        );

        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toContain('/uploads?auth=success');

        // Check Set-Cookie headers
        const cookies = res.headers.get('Set-Cookie') || '';
        expect(cookies).toContain('gdu_session=');
        expect(cookies).toContain('gdu_csrf=');
        expect(cookies).toContain('HttpOnly');
        expect(cookies).toContain('SameSite=Lax');

        // Verify state is consumed (deleted)
        const stateRecord = await env.DB.prepare('SELECT * FROM oauth_states WHERE state = ?')
          .bind(testState)
          .first();
        expect(stateRecord).toBeNull();

        // Verify user and encrypted credentials in D1
        const user = await env.DB.prepare('SELECT * FROM users WHERE google_sub = ?')
          .bind('google-sub-99999')
          .first<{ id: string; email: string }>();
        expect(user).not.toBeNull();
        expect(user?.email).toBe('testuser@example.com');

        const creds = await env.DB.prepare('SELECT * FROM google_credentials WHERE user_id = ?')
          .bind(user!.id)
          .first<{ ciphertext: string; iv: string }>();
        expect(creds).not.toBeNull();
        expect(creds?.ciphertext).not.toBe('1//mock_refresh_token_value'); // Must be encrypted!
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('invalidates pre-existing session from cookie when switching accounts', async () => {
      // 1. Create previous session in D1
      const oldUserId = 'usr-old-switch-test';
      await env.DB.prepare(
        `INSERT INTO users (id, google_sub, email, name, picture)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(oldUserId, 'sub-old-switch', 'olduser@example.com', 'Old User', null)
        .run();

      const oldRawToken = 'old-switch-token-xyz';
      const oldTokenHash = await hashOpaqueToken(oldRawToken);
      const oldSessionId = 'sess-old-to-delete';

      await env.DB.prepare(
        `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
         VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`
      )
        .bind(oldSessionId, oldUserId, oldTokenHash, 'csrf-old')
        .run();

      // 2. Setup OAuth state for new user login
      const testState = 'state-switch-test-999';
      const testVerifier = 'verifier-switch-test-999';
      await env.DB.prepare(
        `INSERT INTO oauth_states (state, code_verifier, redirect_uri, expires_at)
         VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+10 minutes'))`
      )
        .bind(testState, testVerifier, 'https://example.com/api/v1/auth/google/callback')
        .run();

      // 3. Mock Google fetch
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'ya29.new_access_token',
              refresh_token: '1//new_refresh_token',
              expires_in: 3600,
              token_type: 'Bearer',
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.includes('googleapis.com/oauth2/v3/userinfo')) {
          return new Response(
            JSON.stringify({
              sub: 'google-sub-new-switch',
              email: 'newuser@example.com',
              name: 'New Switch User',
              picture: null,
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        }
        return originalFetch(input, init);
      });

      try {
        const res = await SELF.fetch(
          `https://example.com/api/v1/auth/google/callback?state=${testState}&code=new-auth-code`,
          {
            redirect: 'manual',
            headers: {
              Cookie: `gdu_session=${oldRawToken}; gdu_csrf=csrf-old`,
            },
          }
        );

        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toContain('/uploads?auth=success');

        // Verify old session was deleted from D1
        const oldSessionInDb = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?')
          .bind(oldSessionId)
          .first();
        expect(oldSessionInDb).toBeNull();

        // Verify new user has active session
        const newUser = await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?')
          .bind('google-sub-new-switch')
          .first<{ id: string }>();
        expect(newUser).not.toBeNull();

        const newSessions = await env.DB.prepare('SELECT * FROM sessions WHERE user_id = ?')
          .bind(newUser!.id)
          .all();
        expect(newSessions.results).toHaveLength(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('Session & CSRF Lifecycle', () => {
    let sessionCookie: string;
    let csrfCookie: string;
    let csrfToken: string;

    beforeAll(async () => {
      // Create test user, credentials, and active session
      const userId = 'usr-session-test';
      await env.DB.prepare(
        `INSERT INTO users (id, google_sub, email, name, picture)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(userId, 'sub-session-test', 'sess@example.com', 'Sess User', null)
        .run();

      const rawToken = 'raw-test-session-token-12345';
      const tokenHash = await hashOpaqueToken(rawToken);
      csrfToken = 'csrf-token-secret-value-abc';

      await env.DB.prepare(
        `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
         VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`
      )
        .bind('sess-active-1', userId, tokenHash, csrfToken)
        .run();

      sessionCookie = `gdu_session=${rawToken}`;
      csrfCookie = `gdu_csrf=${csrfToken}`;
    });

    it('GET /api/v1/session returns 401 when no session cookie is present', async () => {
      const res = await SELF.fetch('https://example.com/api/v1/session');
      expect(res.status).toBe(401);
      const json = await res.json<{ error: { code: string } }>();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    it('GET /api/v1/session returns safe AccountView and NO tokens or secrets', async () => {
      const res = await SELF.fetch('https://example.com/api/v1/session', {
        headers: {
          Cookie: `${sessionCookie}; ${csrfCookie}`,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json<{ user: Record<string, unknown> }>();
      expect(data.user.email).toBe('sess@example.com');
      expect(data.user.name).toBe('Sess User');

      // Assert complete absence of any token/secret properties
      expect(data.user.access_token).toBeUndefined();
      expect(data.user.refresh_token).toBeUndefined();
      expect(data.user.ciphertext).toBeUndefined();
      expect(data.user.token_hash).toBeUndefined();
    });

    it('POST /api/v1/auth/logout destroys session and clears cookies', async () => {
      const successRes = await SELF.fetch('https://example.com/api/v1/auth/logout', {
        method: 'POST',
        headers: {
          Cookie: `${sessionCookie}; ${csrfCookie}`,
          'X-CSRF-Token': csrfToken,
          Origin: 'https://example.com',
        },
      });

      expect(successRes.status).toBe(200);
      const cookies = successRes.headers.get('Set-Cookie') || '';
      expect(cookies).toContain('gdu_session=;');
      expect(cookies).toContain('Max-Age=0');

      // Verify session removed from D1
      const sessionInDb = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?')
        .bind('sess-active-1')
        .first();
      expect(sessionInDb).toBeNull();
    });
  });
});
