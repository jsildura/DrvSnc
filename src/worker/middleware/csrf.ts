import { MiddlewareHandler } from 'hono';
import { Env } from '../env';
import { parseCookies, AuthenticatedSession } from './session';
import { timingSafeEqual } from '../services/crypto';
import { AccountView } from '../../shared/contracts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const requireCsrf: MiddlewareHandler<{
  Bindings: Env;
  Variables: {
    user?: AccountView;
    session?: AuthenticatedSession;
    requestId: string;
  };
}> = async (c, next) => {
  const method = c.req.method.toUpperCase();

  if (SAFE_METHODS.has(method)) {
    return next();
  }

  // Exempt OAuth callback
  const path = c.req.path;
  if (path === '/api/v1/auth/google/callback') {
    return next();
  }

  // Origin check if present (must match request origin or configured APP_ORIGIN)
  const origin = c.req.header('origin');
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const reqUrl = new URL(c.req.url);
      const appOriginUrl = c.env.APP_ORIGIN ? new URL(c.env.APP_ORIGIN) : null;
      const isAllowedHost =
        originUrl.host === reqUrl.host ||
        (appOriginUrl && (originUrl.host === appOriginUrl.host || originUrl.hostname === appOriginUrl.hostname)) ||
        originUrl.hostname === reqUrl.hostname ||
        (originUrl.hostname === 'localhost' && reqUrl.hostname === '127.0.0.1') ||
        (originUrl.hostname === '127.0.0.1' && reqUrl.hostname === 'localhost');

      if (!isAllowedHost) {
        return c.json(
          {
            error: {
              code: 'CSRF_VALIDATION_FAILED',
              message: 'Cross-origin request blocked',
              retriable: false,
              requestId: c.get('requestId') || 'req-id',
            },
          },
          403
        );
      }
    } catch {
      // Invalid origin header format
    }
  }

  // Logout is protected by Origin check; exempt from double-submit header check
  if (path === '/api/v1/auth/logout') {
    return next();
  }

  const cookies = parseCookies(c.req.header('cookie'));
  const csrfCookie = cookies['gdu_csrf'];
  const csrfHeader = c.req.header('X-CSRF-Token') || c.req.header('x-csrf-token');

  if (!csrfCookie || !csrfHeader || !timingSafeEqual(csrfCookie, csrfHeader)) {
    return c.json(
      {
        error: {
          code: 'CSRF_VALIDATION_FAILED',
          message: 'Invalid or missing CSRF token',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      403
    );
  }

  await next();
};
