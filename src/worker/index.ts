import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { Env } from './env';
import { sessionMiddleware, requireSession, AuthenticatedSession } from './middleware/session';
import { ipRateLimiter } from './middleware/rateLimit';
import { authRoutes } from './routes/auth';
import { accountRoutes } from './routes/account';
import { preferencesRoutes } from './routes/preferences';
import { driveRoutes } from './routes/drive';
import { jobRoutes } from './routes/jobs';
import { seedrRoutes } from './routes/seedr';
import { converterRoutes } from './routes/converter';
import { uploadRoutes } from './routes/uploads';
import { handleScheduledCleanup } from './scheduled/cleanup';
import { AccountView } from '../shared/contracts';

const app = new Hono<{
  Bindings: Env;
  Variables: {
    user?: AccountView;
    session?: AuthenticatedSession;
    requestId: string;
  };
}>();

// Global Security headers & Request ID middleware
app.use('*', async (c, next) => {
  const reqId = c.req.header('x-request-id') || crypto.randomUUID();
  c.set('requestId', reqId);
  c.header('X-Request-Id', reqId);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.googleusercontent.com https://*.google.com https://drive.google.com; font-src 'self' data:; connect-src 'self' https://*.r2.cloudflarestorage.com wss://*.video-converter.com https://*.video-converter.com https://*.convert.io wss://*.convert.io http://localhost:8787 ws://localhost:8787 http://127.0.0.1:8787 ws://127.0.0.1:8787; frame-src 'self' https://drive.google.com https://docs.google.com blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'"
  );

  if (c.req.url.startsWith('https://')) {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  await next();
});

// CORS middleware for all API routes
app.use(
  '/api/*',
  cors({
    origin: (origin, c) => {
      if (!origin) return '*';
      const allowed = [
        'http://localhost:5173',
        'http://localhost:8787',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:8787',
      ];
      if (c.env.APP_ORIGIN) allowed.push(c.env.APP_ORIGIN);
      if (allowed.includes(origin) || origin.endsWith('.workers.dev')) {
        return origin;
      }
      return origin;
    },
    allowMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Content-Length',
      'Authorization',
      'X-Request-Id',
      'Idempotency-Key',
      'Range',
      'X-CSRF-Token',
      'baggage',
      'sentry-trace',
    ],
    exposeHeaders: ['ETag', 'Content-Length', 'Content-Range', 'X-Request-Id'],
    credentials: true,
    maxAge: 86400,
  })
);

// Cache control for all API responses
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  c.header('Pragma', 'no-cache');
  c.header('Expires', '0');
  await next();
});

// Health check
app.get('/api/v1/health', (c) => {
  return c.json({ status: 'ok', version: 1 });
});

// Session middleware for API routes
app.use('/api/v1/*', sessionMiddleware);

// Rate limiting on OAuth initiation & callback
app.use('/api/v1/auth/google/*', ipRateLimiter({ maxRequests: 20, windowSeconds: 60 }));

// Mount API routes
app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/account', accountRoutes);
app.route('/api/v1/preferences', preferencesRoutes);
app.route('/api/v1/drive', driveRoutes);
app.route('/api/v1/jobs', jobRoutes);
app.route('/api/v1/seedr', seedrRoutes);
app.route('/api/v1/converter', converterRoutes);
app.route('/api/v1/uploads', uploadRoutes);

// Active session profile route
app.get('/api/v1/session', requireSession, (c) => {
  const user = c.get('user');
  const session = c.get('session');
  return c.json({
    user,
    expiresAt: session?.expiresAt,
    csrfToken: session?.csrfToken,
  });
});

// Delegate non-API requests to static assets / SPA fallback
app.all('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('Not Found', 404);
});

export { DriveTransferWorkflow } from './workflows/DriveTransfer';

export class DriveCopyWorkflow extends WorkflowEntrypoint<Env, Record<string, unknown>> {
  async run(_event: WorkflowEvent<Record<string, unknown>>, _step: WorkflowStep) {
    // Scaffolded workflow entrypoint
  }
}

export default {
  fetch: app.fetch,
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(handleScheduledCleanup(env));
  },
};
