import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from './testDb';
import { hashOpaqueToken } from '../../src/worker/services/crypto';
import { PreferencesView } from '../../src/shared/contracts';

describe('Preferences API (/api/v1/preferences)', () => {
  const userIdA = 'usr-pref-a';
  const userIdB = 'usr-pref-b';
  const rawTokenA = 'raw-session-token-pref-a';
  const rawTokenB = 'raw-session-token-pref-b';
  const csrfTokenA = 'csrf-token-pref-a';
  const csrfTokenB = 'csrf-token-pref-b';
  const cookieA = `gdu_session=${rawTokenA}; gdu_csrf=${csrfTokenA}`;
  const cookieB = `gdu_session=${rawTokenB}; gdu_csrf=${csrfTokenB}`;

  beforeAll(async () => {
    await applyMigrations(env.DB);

    // Seed User A
    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userIdA, 'sub-pref-a', 'user-a@example.com', 'User A', null)
      .run();

    const tokenHashA = await hashOpaqueToken(rawTokenA);
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`
    )
      .bind('sess-pref-a', userIdA, tokenHashA, csrfTokenA)
      .run();

    // Seed User B
    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userIdB, 'sub-pref-b', 'user-b@example.com', 'User B', null)
      .run();

    const tokenHashB = await hashOpaqueToken(rawTokenB);
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`
    )
      .bind('sess-pref-b', userIdB, tokenHashB, csrfTokenB)
      .run();
  });

  it('GET /api/v1/preferences returns default preferences when none saved', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/preferences', {
      headers: { Cookie: cookieA },
    });

    expect(res.status).toBe(200);
    const data = await res.json<PreferencesView>();
    expect(data.themeMode).toBe('light');
    expect(data.colorScheme).toBe('drive');
    expect(data.filenamePattern).toBe('{filename}');
    expect(data.notificationsEnabled).toBe(true);
    expect(data.rememberAccount).toBe(true);
  });

  it('PATCH /api/v1/preferences validates and updates preferences', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/preferences', {
      method: 'PATCH',
      headers: {
        Cookie: cookieA,
        'X-CSRF-Token': csrfTokenA,
        Origin: 'https://example.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        themeMode: 'dark',
        colorScheme: 'ocean',
        filenamePattern: '{date}_{filename}',
        notificationsEnabled: false,
        defaultFolderId: 'folder-abc-123',
        defaultFolderName: 'Target Folder',
        rememberAccount: false,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json<PreferencesView>();
    expect(data.themeMode).toBe('dark');
    expect(data.colorScheme).toBe('ocean');
    expect(data.filenamePattern).toBe('{date}_{filename}');
    expect(data.notificationsEnabled).toBe(false);
    expect(data.defaultFolderId).toBe('folder-abc-123');
    expect(data.defaultFolderName).toBe('Target Folder');
    expect(data.rememberAccount).toBe(false);
  });

  it('maintains strict multi-tenant preference isolation', async () => {
    // User B fetches preferences and should still see defaults, not User A's changes
    const res = await SELF.fetch('https://example.com/api/v1/preferences', {
      headers: { Cookie: cookieB },
    });

    expect(res.status).toBe(200);
    const data = await res.json<PreferencesView>();
    expect(data.themeMode).toBe('light');
    expect(data.colorScheme).toBe('drive');
    expect(data.defaultFolderId).toBeNull();
  });

  it('rejects invalid preference payloads', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/preferences', {
      method: 'PATCH',
      headers: {
        Cookie: cookieA,
        'X-CSRF-Token': csrfTokenA,
        Origin: 'https://example.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        themeMode: 'neon-invalid',
      }),
    });

    expect(res.status).toBe(400);
    const errorJson = await res.json<{ error: { code: string } }>();
    expect(errorJson.error.code).toBe('INVALID_REQUEST');
  });
});
