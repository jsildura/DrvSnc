import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from './testDb';

describe('IP Rate Limiting on Authentication Endpoints', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  it('allows normal auth requests and responds with redirect', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/auth/google/start', {
      redirect: 'manual',
      headers: {
        'CF-Connecting-IP': '198.51.100.1',
      },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('accounts.google.com');
  });

  it('rejects excessive requests from same IP with 429 and Retry-After', async () => {
    const spamIp = '203.0.113.99';

    // Trigger rate limit threshold (20 requests)
    let lastStatus = 200;
    let rateLimitedRes: Response | null = null;

    for (let i = 0; i < 25; i++) {
      const res = await SELF.fetch('https://example.com/api/v1/auth/google/start', {
        redirect: 'manual',
        headers: {
          'CF-Connecting-IP': spamIp,
        },
      });
      lastStatus = res.status;
      if (res.status === 429) {
        rateLimitedRes = res;
        break;
      }
    }

    expect(lastStatus).toBe(429);
    expect(rateLimitedRes).not.toBeNull();
    expect(rateLimitedRes!.headers.get('Retry-After')).toBeDefined();

    const data = await rateLimitedRes!.json<{ error: { code: string } }>();
    expect(data.error.code).toBe('RATE_LIMITED');
  }, 15000);
});
