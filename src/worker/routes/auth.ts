import { Hono } from 'hono';
import { Env } from '../env';
import {
  createAuthorizationUrl,
  exchangeCode,
  fetchGoogleProfile,
} from '../services/googleAuth';
import { encryptSecret, generateSecureRandomString, hashOpaqueToken } from '../services/crypto';
import {
  createSession,
  deleteSession,
  parseCookies,
  isSecureRequest,
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

authRoutes.get('/google/start', async (c) => {
  const loginHint = c.req.query('login_hint');
  const origin = c.env.APP_ORIGIN || new URL(c.req.url).origin;
  const redirectUri = `${origin}/api/v1/auth/google/callback`;

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

  return c.redirect(url, 302);
});

authRoutes.get('/google/callback', async (c) => {
  const state = c.req.query('state');
  const code = c.req.query('code');
  const error = c.req.query('error');

  if (error) {
    return c.redirect(`/login?error=${encodeURIComponent(error)}`, 302);
  }

  if (!state || !code) {
    return c.redirect('/login?error=invalid_request', 302);
  }

  // Look up and consume state
  const stateRecord = await c.env.DB.prepare(
    `SELECT * FROM oauth_states WHERE state = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  )
    .bind(state)
    .first<{ state: string; code_verifier: string; redirect_uri: string }>();

  if (!stateRecord) {
    return c.redirect('/login?error=invalid_state', 302);
  }

  // Atomically delete consumed state
  await c.env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();

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
    .bind(userId, profile.sub, profile.email, profile.name, profile.picture || null)
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
  const existingCookies = parseCookies(c.req.header('cookie'));
  if (existingCookies['gdu_session']) {
    const oldTokenHash = await hashOpaqueToken(existingCookies['gdu_session']);
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(oldTokenHash).run();
  }

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

export { authRoutes };
