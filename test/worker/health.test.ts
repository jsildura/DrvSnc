import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('Cloudflare Worker Health & SPA Fallback', () => {
  it('GET /api/v1/health returns 200 and exact status shape', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/health');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: 'ok', version: 1 });
  });

  it('GET /settings returns the SPA HTML document rather than a 404', async () => {
    const response = await SELF.fetch('https://example.com/settings');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('id="root"');
  });
});
