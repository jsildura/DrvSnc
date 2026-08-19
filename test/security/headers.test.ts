import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('HTTP Security Headers and Cache Policies', () => {
  it('includes strict security headers on all responses', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/health');
    expect(res.status).toBe(200);

    // Standard security headers
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('Permissions-Policy')).toBeDefined();

    // CSP
    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).toBeDefined();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");

    // Cache control for API responses
    const cacheControl = res.headers.get('Cache-Control');
    expect(cacheControl).toContain('no-store');
  });
});
