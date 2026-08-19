import { MiddlewareHandler } from 'hono';
import { Env } from '../env';

// In-memory token bucket/sliding window for IP-based rate limiting
interface RateLimitBucket {
  count: number;
  resetTime: number;
}

const ipBuckets = new Map<string, RateLimitBucket>();

// Cleanup stale buckets periodically
function cleanStaleBuckets() {
  const now = Date.now();
  for (const [key, bucket] of ipBuckets.entries()) {
    if (now > bucket.resetTime) {
      ipBuckets.delete(key);
    }
  }
}

export function ipRateLimiter(options: {
  maxRequests: number;
  windowSeconds: number;
}): MiddlewareHandler<{ Bindings: Env; Variables: { requestId: string } }> {
  return async (c, next) => {
    const ip =
      c.req.header('CF-Connecting-IP') ||
      c.req.header('X-Forwarded-For')?.split(',')[0].trim() ||
      '127.0.0.1';

    const now = Date.now();
    const windowMs = options.windowSeconds * 1000;

    let bucket = ipBuckets.get(ip);
    if (!bucket || now > bucket.resetTime) {
      bucket = { count: 0, resetTime: now + windowMs };
      ipBuckets.set(ip, bucket);
    }

    bucket.count++;

    if (bucket.count > options.maxRequests) {
      const retryAfterSeconds = Math.ceil((bucket.resetTime - now) / 1000);
      c.header('Retry-After', String(Math.max(1, retryAfterSeconds)));
      return c.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Please try again later.',
            retriable: true,
            requestId: c.get('requestId') || 'req-id',
          },
        },
        429
      );
    }

    if (Math.random() < 0.05) {
      cleanStaleBuckets();
    }

    await next();
  };
}
