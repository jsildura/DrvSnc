import { Hono } from 'hono';
import { Env } from '../env';
import { requireSession, isSecureRequest, AuthenticatedSession } from '../middleware/session';
import { requireCsrf } from '../middleware/csrf';
import { decryptSecret, generateSecureRandomString } from '../services/crypto';
import { revokeToken } from '../services/googleAuth';
import { invalidateTokenCache } from '../services/driveClient';
import { AccountView } from '../../shared/contracts';

const accountRoutes = new Hono<{
  Bindings: Env;
  Variables: {
    user?: AccountView;
    session?: AuthenticatedSession;
    requestId: string;
  };
}>();

accountRoutes.delete('/', requireSession, requireCsrf, async (c) => {
  const user = c.get('user')!;
  const userId = user.id;

  // 1. Fetch encrypted Google credential and attempt revocation
  const cred = await c.env.DB.prepare(
    'SELECT ciphertext, iv FROM google_credentials WHERE user_id = ?'
  )
    .bind(userId)
    .first<{ ciphertext: string; iv: string }>();

  if (cred) {
    try {
      const refreshToken = await decryptSecret(
        cred.ciphertext,
        cred.iv,
        c.env.TOKEN_ENCRYPTION_KEY,
        userId
      );
      if (refreshToken) {
        await revokeToken(refreshToken);
      }
    } catch (_err) {
      // Gracefully continue deletion if token revocation fails
    }
  }

  // 2. Delete credentials
  await c.env.DB.prepare('DELETE FROM google_credentials WHERE user_id = ?').bind(userId).run();

  // Drop any in-isolate access token so a revoked account cannot keep calling Drive
  invalidateTokenCache(userId);

  // 3. Cancel non-terminal upload jobs
  await c.env.DB.prepare(
    `UPDATE upload_jobs
     SET status = 'canceled', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE user_id = ? AND status IN ('staging', 'queued', 'fetching', 'uploading', 'cancel_requested')`
  )
    .bind(userId)
    .run();

  // 4. Delete all sessions for user
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();

  // 5. Mark user record as revoked
  await c.env.DB.prepare(
    `UPDATE users SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
  )
    .bind(userId)
    .run();

  // 6. Record audit event
  const auditId = generateSecureRandomString(16);
  await c.env.DB.prepare(
    `INSERT INTO audit_events (id, user_id, action, resource_type, resource_id)
     VALUES (?, ?, 'account_deleted', 'user', ?)`
  )
    .bind(auditId, userId, userId)
    .run();

  // 7. Clear cookies
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

export { accountRoutes };
