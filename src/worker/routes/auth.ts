import { Hono } from 'hono';
import { Env } from '../env';
import {
  createAuthorizationUrl,
  exchangeCode,
  fetchGoogleProfile,
} from '../services/googleAuth';
import {
  decryptSecret,
  encryptSecret,
  generateSecureRandomString,
  hashOpaqueToken,
  timingSafeEqual,
} from '../services/crypto';
import {
  createSession,
  deleteSession,
  parseCookies,
  isSecureRequest,
  requireSession,
  AuthenticatedSession,
} from '../middleware/session';
import { requireCsrf } from '../middleware/csrf';
import { AccountView } from '../../shared/contracts';

const authRoutes = new Hono<{
  Bindings: Env;
  Variables: {
    user?: AccountView;
    session?: AuthenticatedSession;
    requestId: string;
  };
}>();

/**
 * Ties an in-flight `state` to the browser that started the flow.
 *
 * A server-side `oauth_states` row alone only proves the state was issued by us — not that it was
 * issued to *this* visitor. Without that second half an attacker can run the consent screen against
 * their own Google account, keep the resulting `?state=&code=` callback URL instead of following it,
 * and hand it to a victim: the victim's browser lands on a valid state, and the worker mints a
 * session for the attacker's account in the victim's browser. Everything the victim uploads then
 * goes to the attacker's Drive.
 *
 * Scoped to the auth prefix so it rides along on nothing else, and `SameSite=Lax` rather than
 * `Strict` because the callback arrives as a cross-site top-level navigation from Google — a
 * `Strict` cookie would be withheld there and no login would ever complete.
 */
const OAUTH_STATE_COOKIE = 'gdu_oauth_state';
const OAUTH_STATE_COOKIE_PATH = '/api/v1/auth';
/** Matches the `oauth_states` row's own lifetime, so neither half outlives the other. */
const OAUTH_STATE_TTL_SECONDS = 600;

function oauthStateCookie(state: string, isSecure: boolean): string {
  const secureFlag = isSecure ? '; Secure' : '';
  return (
    `${OAUTH_STATE_COOKIE}=${state}; HttpOnly${secureFlag}; SameSite=Lax; ` +
    `Path=${OAUTH_STATE_COOKIE_PATH}; Max-Age=${OAUTH_STATE_TTL_SECONDS}`
  );
}

function clearedOauthStateCookie(isSecure: boolean): string {
  const secureFlag = isSecure ? '; Secure' : '';
  return (
    `${OAUTH_STATE_COOKIE}=; HttpOnly${secureFlag}; SameSite=Lax; ` +
    `Path=${OAUTH_STATE_COOKIE_PATH}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  );
}

authRoutes.get('/google/start', async (c) => {
  const loginHint = c.req.query('login_hint');

  // Validate APP_ORIGIN is set
  if (!c.env.APP_ORIGIN) {
    return c.json(
      { error: 'APP_ORIGIN environment variable is required' },
      500
    );
  }

  // Validate APP_ORIGIN is a valid URL
  try {
    new URL(c.env.APP_ORIGIN);
  } catch {
    return c.json(
      { error: 'Invalid APP_ORIGIN configuration' },
      500
    );
  }

  const redirectUri = `${c.env.APP_ORIGIN}/api/v1/auth/google/callback`;

  const { url, state, codeVerifier } = await createAuthorizationUrl(c.env, {
    redirectUri,
    loginHint,
  });

  await c.env.DB.prepare(
    `INSERT INTO oauth_states (state, code_verifier, redirect_uri, expires_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+10 minutes'))`
  )
    .bind(state, codeVerifier, redirectUri)
    .run();

  c.header('Set-Cookie', oauthStateCookie(state, isSecureRequest(c)), { append: true });

  return c.redirect(url, 302);
});

authRoutes.get('/google/callback', async (c) => {
  const state = c.req.query('state');
  const code = c.req.query('code');
  const error = c.req.query('error');
  const cookies = parseCookies(c.req.header('cookie'));

  if (error) {
    return c.redirect(`/login?error=${encodeURIComponent(error)}`, 302);
  }

  if (!state || !code) {
    return c.redirect('/login?error=invalid_request', 302);
  }

  // Confirm this browser is the one that started the flow, before the state row is touched: a
  // callback that fails this check must not be able to burn someone else's in-flight state. The
  // cookie is deliberately left in place here for the same reason — clearing it would let a
  // one-click bogus callback cancel a login the victim is halfway through.
  const boundState = cookies[OAUTH_STATE_COOKIE];
  if (!boundState || !timingSafeEqual(boundState, state)) {
    return c.redirect('/login?error=state_mismatch', 302);
  }

  // Check if state exists at all (distinguishing missing from expired)
  const allStates = await c.env.DB.prepare(
    `SELECT expires_at FROM oauth_states WHERE state = ?`
  )
    .bind(state)
    .first<{ expires_at: string }>();

  if (!allStates) {
    return c.redirect('/login?error=invalid_state&reason=not_found', 302);
  }

  if (new Date(allStates.expires_at) < new Date()) {
    // Clean up expired state
    await c.env.DB.prepare(`DELETE FROM oauth_states WHERE state = ?`).bind(state).run();
    c.header('Set-Cookie', clearedOauthStateCookie(isSecureRequest(c)), { append: true });
    return c.redirect('/login?error=invalid_state&reason=expired', 302);
  }

  // One statement, so two concurrent callbacks cannot both come away with the verifier.
  const stateRecord = await c.env.DB.prepare(
    `DELETE FROM oauth_states
     WHERE state = ?
     RETURNING code_verifier, redirect_uri`
  )
    .bind(state)
    .first<{ code_verifier: string; redirect_uri: string }>();

  if (!stateRecord) {
    return c.redirect('/login?error=invalid_state&reason=not_found', 302);
  }

  // Spent, whichever way the rest of this goes.
  c.header('Set-Cookie', clearedOauthStateCookie(isSecureRequest(c)), { append: true });

  let tokenResp;
  try {
    tokenResp = await exchangeCode(
      c.env,
      code,
      stateRecord.code_verifier,
      stateRecord.redirect_uri
    );
  } catch (_err) {
    return c.redirect('/login?error=exchange_failed', 302);
  }

  let profile;
  try {
    profile = await fetchGoogleProfile(tokenResp.accessToken);
  } catch (_err) {
    return c.redirect('/login?error=profile_failed', 302);
  }

  const userId = generateSecureRandomString(16);
  // Upsert user by Google sub
  const userRow = await c.env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, picture, last_used_at)
     VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT (google_sub) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       picture = excluded.picture,
       last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       revoked_at = NULL
     RETURNING id`
  )
    .bind(userId, profile.sub, profile.email, profile.name, profile.picture ?? null)
    .first<{ id: string }>();

  const activeUserId = userRow?.id || userId;

  // Handle credentials
  if (tokenResp.refreshToken) {
    const encrypted = await encryptSecret(
      tokenResp.refreshToken,
      c.env.TOKEN_ENCRYPTION_KEY,
      activeUserId
    );

    await c.env.DB.prepare(
      `INSERT INTO google_credentials (user_id, ciphertext, iv, key_version, updated_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT (user_id) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         key_version = excluded.key_version,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    )
      .bind(activeUserId, encrypted.ciphertext, encrypted.iv, encrypted.keyVersion)
      .run();
  } else {
    // Check existing credentials
    const existingCreds = await c.env.DB.prepare(
      `SELECT user_id FROM google_credentials WHERE user_id = ?`
    )
      .bind(activeUserId)
      .first();

    if (!existingCreds) {
      return c.redirect('/login?error=missing_refresh_token', 302);
    }
  }

  // Ensure default preferences exist
  await c.env.DB.prepare(
    `INSERT INTO preferences (user_id, theme_mode, color_scheme, remember_account)
     VALUES (?, 'light', 'drive', 1)
     ON CONFLICT (user_id) DO NOTHING`
  )
    .bind(activeUserId)
    .run();

  // Invalidate any existing session from cookie
  if (cookies['gdu_session']) {
    const oldTokenHash = await hashOpaqueToken(cookies['gdu_session']);
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(oldTokenHash).run();
  }

  // Invalidate ALL existing sessions for this user upon re-login
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(activeUserId).run();

  // Create new session
  const session = await createSession(c.env, activeUserId);

  // Set secure cookies
  const isSecure = isSecureRequest(c);
  const secureFlag = isSecure ? '; Secure' : '';

  c.header(
    'Set-Cookie',
    `gdu_session=${session.token}; HttpOnly${secureFlag}; SameSite=Lax; Path=/; Max-Age=2592000`,
    { append: true }
  );
  c.header(
    'Set-Cookie',
    `gdu_csrf=${session.csrfToken}${secureFlag}; SameSite=Lax; Path=/; Max-Age=2592000`,
    { append: true }
  );

  return c.redirect('/uploads?auth=success', 302);
});

authRoutes.post('/revoke-all-sessions', requireSession, async (c) => {
  const user = c.get('user');
  if (user?.id) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
  }
  return c.json({ success: true });
});

authRoutes.post('/logout', requireCsrf, async (c) => {
  const session = c.get('session');
  if (session) {
    await deleteSession(c.env, session.id);
  }

  const cookies = parseCookies(c.req.header('cookie'));
  if (cookies['gdu_session']) {
    const tokenHash = await hashOpaqueToken(cookies['gdu_session']);
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }

  const isSecure = isSecureRequest(c);
  const secureFlag = isSecure ? '; Secure' : '';

  c.header(
    'Set-Cookie',
    `gdu_session=; HttpOnly${secureFlag}; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    { append: true }
  );
  c.header(
    'Set-Cookie',
    `gdu_csrf=${secureFlag}; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    { append: true }
  );

  return c.json({ success: true });
});

async function exchangeRefreshToken(
  env: Env,
  refreshToken: string
): Promise<{ accessToken: string; refreshToken?: string }> {
  const params = new URLSearchParams();
  params.set('client_id', env.GOOGLE_CLIENT_ID);
  params.set('client_secret', env.GOOGLE_CLIENT_SECRET);
  params.set('refresh_token', refreshToken);
  params.set('grant_type', 'refresh_token');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    throw new Error(`Google OAuth token refresh failed with status ${res.status}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
  };
}

export async function refreshAccessToken(env: Env, userId: string): Promise<string> {
  const creds = await env.DB.prepare(
    `SELECT ciphertext, iv FROM google_credentials WHERE user_id = ?`
  )
    .bind(userId)
    .first<{ ciphertext: string; iv: string }>();

  if (!creds) {
    throw new Error('No Google credentials found for user');
  }

  const refreshToken = await decryptSecret(
    creds.ciphertext,
    creds.iv,
    env.TOKEN_ENCRYPTION_KEY,
    userId
  );

  const newTokenResp = await exchangeRefreshToken(env, refreshToken);

  // If Google issued a new refresh token, store it (token rotation)
  if (newTokenResp.refreshToken) {
    const encrypted = await encryptSecret(
      newTokenResp.refreshToken,
      env.TOKEN_ENCRYPTION_KEY,
      userId
    );
    await env.DB.prepare(
      `UPDATE google_credentials
       SET ciphertext = ?, iv = ?, key_version = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE user_id = ?`
    )
      .bind(encrypted.ciphertext, encrypted.iv, encrypted.keyVersion, userId)
      .run();
  }

  return newTokenResp.accessToken;
}

export { authRoutes };
