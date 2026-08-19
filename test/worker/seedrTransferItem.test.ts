import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from './testDb';
import { hashOpaqueToken, encryptSecret } from '../../src/worker/services/crypto';

const workflowCreateSpy = vi.fn(
  async (_input: { id?: string; params?: Record<string, unknown> }) => ({
    id: 'test-workflow-instance',
  })
);

describe('POST /api/v1/seedr/transfer-item', () => {
  const userId = 'usr-seedr-transfer';
  const rawToken = 'raw-session-seedr-transfer';
  const csrfToken = 'csrf-seedr-transfer';
  const cookie = `gdu_session=${rawToken}; gdu_csrf=${csrfToken}`;

  let seedrBodies: string[] = [];
  let seedrUrls: string[] = [];
  let originalFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    await applyMigrations(env.DB);

    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userId, 'sub-seedr-transfer', 'seedr@example.com', 'Seedr User', null)
      .run();

    const enc = await encryptSecret('refresh-token', env.TOKEN_ENCRYPTION_KEY, userId);
    await env.DB.prepare(
      `INSERT INTO google_credentials (user_id, ciphertext, iv, key_version) VALUES (?, ?, ?, ?)`
    )
      .bind(userId, enc.ciphertext, enc.iv, enc.keyVersion)
      .run();

    const tokenHash = await hashOpaqueToken(rawToken);
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`
    )
      .bind('sess-seedr-transfer', userId, tokenHash, csrfToken)
      .run();

    const seedrToken = await encryptSecret('seedr-access', env.TOKEN_ENCRYPTION_KEY, userId);
    await env.DB.prepare(
      `INSERT INTO seedr_credentials (user_id, encrypted_access_token, seedr_username)
       VALUES (?, ?, ?)`
    )
      .bind(userId, `${seedrToken.ciphertext}:${seedrToken.iv}`, 'seedr@example.com')
      .run();
  });

  beforeEach(() => {
    seedrBodies = [];
    seedrUrls = [];
    workflowCreateSpy.mockClear();
    vi.spyOn(
      env.DRIVE_TRANSFER as unknown as { create: typeof workflowCreateSpy },
      'create'
    ).mockImplementation(workflowCreateSpy);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  /** Stub Seedr's resource.php so archive creation succeeds unless told otherwise. */
  function mockSeedr(archive: { ok: boolean; payload: unknown; status?: number }) {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('seedr.cc')) {
        seedrUrls.push(url);
        seedrBodies.push(String(init?.body || ''));
        return new Response(JSON.stringify(archive.payload), {
          status: archive.ok ? 200 : archive.status || 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch to ${url}`);
    }) as typeof globalThis.fetch;
  }

  it('queues one transfer, keeps the Seedr source, and zips a folder', async () => {
    mockSeedr({
      ok: true,
      payload: {
        result: true,
        url: 'https://nw31.seedr.cc/get_zip_ngen_free/28749794/My%20Release.zip?st=abc&e=1787222814',
      },
    });

    const res = await SELF.fetch('https://example.com/api/v1/seedr/transfer-item', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-CSRF-Token': csrfToken,
        Origin: 'https://example.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ itemType: 'folder', itemId: 4242, itemName: 'My Release' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json<{ success: boolean; jobId: string; title: string }>();
    expect(body.success).toBe(true);
    expect(body.title).toBe('My Release.zip');

    // createRemoteJob already starts the workflow — a second instance would upload twice.
    expect(workflowCreateSpy).toHaveBeenCalledTimes(1);

    // A cleanup scheduled with waitUntil runs after the response, so give it room to
    // land before asserting it never happened.
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The source must survive until the workflow has downloaded it.
    expect(seedrBodies.some((b) => b.includes('func=delete'))).toBe(false);
    // fetch_archive is the live archive func; create_empty_archive answers 404 now.
    expect(seedrBodies.some((b) => b.includes('func=fetch_archive'))).toBe(true);
    expect(seedrBodies.some((b) => b.includes('create_empty_archive'))).toBe(false);
    expect(seedrUrls.some((u) => u.includes('func=fetch_archive'))).toBe(true);

    const job = await env.DB.prepare(
      'SELECT filename, source_url_redacted, status FROM upload_jobs WHERE id = ?'
    )
      .bind(body.jobId)
      .first<{ filename: string; source_url_redacted: string; status: string }>();

    expect(job?.filename).toBe('My Release.zip');
    // The signing query is stripped before the URL is stored.
    expect(job?.source_url_redacted).toContain('get_zip_ngen_free/28749794');
    expect(job?.source_url_redacted).not.toContain('st=abc');
    expect(job?.status).toBe('queued');
  });

  it('reports the upstream Seedr reason instead of a bare 500', async () => {
    mockSeedr({
      ok: false,
      status: 400,
      payload: { result: false, error: 'folder is still downloading' },
    });

    const res = await SELF.fetch('https://example.com/api/v1/seedr/transfer-item', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-CSRF-Token': csrfToken,
        Origin: 'https://example.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ itemType: 'folder', itemId: 4243, itemName: 'Broken' }),
    });

    expect(res.status).toBe(500);
    const err = await res.json<{ error: string }>();
    expect(err.error).toContain('folder is still downloading');
    expect(workflowCreateSpy).not.toHaveBeenCalled();
  });
});
