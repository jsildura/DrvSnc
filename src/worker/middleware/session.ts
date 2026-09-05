import { MiddlewareHandler } from 'hono';
import { Env } from '../env';
import { hashOpaqueToken, generateSecureRandomString } from '../services/crypto';
import { AccountView } from '../../shared/contracts';

export interface AuthenticatedSession {
  id: string;
  userId: string;
  csrfToken: string;
  expiresAt: string;
}

export function isSecureRequest(c: { req: { url: string; header: (name: string) => string | undefined } }): boolean {
  try {
    const url = new URL(c.req.url);
    if (url.protocol === 'https:') return true;
    if (c.req.header('x-forwarded-proto') === 'https') return true;
    return false;
  } catch {
    return false;
  }
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;

  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    const name = parts[0]?.trim();
    const value = parts.slice(1).join('=').trim();
    if (name) {
      try {
        list[name] = decodeURIComponent(value);
      } catch {
        console.warn(`Malformed cookie value for ${name}`);
      }
    }
  });

  return list;
}

export const sessionMiddleware: MiddlewareHandler<{
  Bindings: Env;
  Variables: {
    user?: AccountView;
    session?: AuthenticatedSession;
    requestId: string;
  };
}> = async (c, next) => {
  const cookies = parseCookies(c.req.header('cookie'));
  const rawSessionToken = cookies['gdu_session'];

  if (rawSessionToken) {
    const tokenHash = await hashOpaqueToken(rawSessionToken);

    const row = await c.env.DB.prepare(
      `SELECT s.id as session_id, s.user_id, s.csrf_token, s.expires_at, s.last_active_at,
              u.email, u.name, u.picture, u.created_at as user_created_at, u.last_used_at, u.revoked_at
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token_hash = ? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AND u.revoked_at IS NULL`
    )
      .bind(tokenHash)
      .first<{
        session_id: string;
        user_id: string;
        csrf_token: string;
        expires_at: string;
        last_active_at: string;
        email: string;
        name: string;
        picture: string | null;
        user_created_at: string;
        last_used_at: string;
        revoked_at: string | null;
      }>();

    if (row) {
      c.set('session', {
        id: row.session_id,
        userId: row.user_id,
        csrfToken: row.csrf_token,
        expiresAt: row.expires_at,
      });

      c.set('user', {
        id: row.user_id,
        email: row.email,
        name: row.name,
        picture: row.picture,
        createdAt: row.user_created_at,
        lastUsedAt: row.last_used_at,
        revokedAt: row.revoked_at,
      });

      // Throttled last_active_at update (once per hour)
      const lastActive = new Date(row.last_active_at).getTime();
      const oneHourAgo = Date.now() - 3600000;
      if (isNaN(lastActive) || lastActive < oneHourAgo) {
        c.executionCtx.waitUntil?.(
          c.env.DB.prepare(
            `UPDATE sessions SET last_active_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
          )
            .bind(row.session_id)
            .run()
            .catch((err) => {
              console.error('Failed to update session activity:', err);
            })
        );
      }
    }
  }

  await next();
};

export const requireSession: MiddlewareHandler<{
  Bindings: Env;
  Variables: {
    user?: AccountView;
    session?: AuthenticatedSession;
    requestId: string;
  };
}> = async (c, next) => {
  const user = c.get('user');
  if (!user) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      401
    );
  }
  await next();
};

export async function createSession(
  env: Env,
  userId: string
): Promise<{ token: string; csrfToken: string; expiresAt: string }> {
  const rawToken = generateSecureRandomString(32);
  const tokenHash = await hashOpaqueToken(rawToken);
  const csrfToken = generateSecureRandomString(32);
  const sessionId = generateSecureRandomString(16);

  const expiresDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const expiresAt = expiresDate.toISOString();

  try {
    const result = await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id`
    )
      .bind(sessionId, userId, tokenHash, csrfToken, expiresAt)
      .first<{ id: string }>();

    if (!result) {
      throw new Error('Failed to create session');
    }

    return {
      token: rawToken,
      csrfToken,
      expiresAt,
    };
  } catch (error) {
    console.error('Session creation failed:', error);
    throw new Error('Failed to create session');
  }
}

export async function deleteSession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}

export async function deleteUserSessions(env: Env, userId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}
