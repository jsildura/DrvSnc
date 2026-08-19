import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from './testDb';
import { hashOpaqueToken, encryptSecret } from '../../src/worker/services/crypto';
import { createBatch, retryBatch } from '../../src/worker/services/jobRepository';
import { Env } from '../../src/worker/env';
import { BatchView, UploadJobView } from '../../src/shared/contracts';

interface WorkflowCreateInput {
  id?: string;
  params?: Record<string, unknown>;
}

const workflowCreateSpy = vi.fn(async (_input: WorkflowCreateInput) => ({
  id: 'test-workflow-instance',
}));

describe('Batch Remote Upload API (/api/v1/jobs/batch)', () => {
  const userIdA = 'usr-batch-a';
  const userIdB = 'usr-batch-b';
  const rawTokenA = 'raw-session-batch-a';
  const rawTokenB = 'raw-session-batch-b';
  const csrfTokenA = 'csrf-batch-a';
  const csrfTokenB = 'csrf-batch-b';
  const cookieA = `gdu_session=${rawTokenA}; gdu_csrf=${csrfTokenA}`;
  const cookieB = `gdu_session=${rawTokenB}; gdu_csrf=${csrfTokenB}`;

  beforeAll(async () => {
    await applyMigrations(env.DB);

    // Seed User A
    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userIdA, 'sub-batch-a', 'batch-a@example.com', 'Batch A', null)
      .run();

    const encA = await encryptSecret('refresh-a', env.TOKEN_ENCRYPTION_KEY, userIdA);
    await env.DB.prepare(
      `INSERT INTO google_credentials (user_id, ciphertext, iv, key_version)
       VALUES (?, ?, ?, ?)`
    )
      .bind(userIdA, encA.ciphertext, encA.iv, 1)
      .run();

    const tokenHashA = await hashOpaqueToken(rawTokenA);
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`
    )
      .bind('sess-batch-a', userIdA, tokenHashA, csrfTokenA)
      .run();

    // Seed User B
    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userIdB, 'sub-batch-b', 'batch-b@example.com', 'Batch B', null)
      .run();

    const encB = await encryptSecret('refresh-b', env.TOKEN_ENCRYPTION_KEY, userIdB);
    await env.DB.prepare(
      `INSERT INTO google_credentials (user_id, ciphertext, iv, key_version)
       VALUES (?, ?, ?, ?)`
    )
      .bind(userIdB, encB.ciphertext, encB.iv, 1)
      .run();

    const tokenHashB = await hashOpaqueToken(rawTokenB);
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`
    )
      .bind('sess-batch-b', userIdB, tokenHashB, csrfTokenB)
      .run();
  });

  beforeEach(() => {
    workflowCreateSpy.mockClear();
    vi.spyOn(
      env.DRIVE_TRANSFER as unknown as { create: typeof workflowCreateSpy },
      'create'
    ).mockImplementation(workflowCreateSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects batch creation without Idempotency-Key', async () => {
    const res = await SELF.fetch('https://uploader.local/api/v1/jobs/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfTokenA,
        Cookie: cookieA,
      },
      body: JSON.stringify({
        items: [{ url: 'https://example.com/file1.mp4' }],
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json<{ error: { code: string } }>();
    expect(data.error.code).toBe('INVALID_REQUEST');
  });

  it('rejects invalid/non-HTTPS URLs', async () => {
    const res = await SELF.fetch('https://uploader.local/api/v1/jobs/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfTokenA,
        'Idempotency-Key': 'key-invalid-url-batch',
        Cookie: cookieA,
      },
      body: JSON.stringify({
        items: [
          { url: 'https://example.com/file1.mp4' },
          { url: 'http://insecure.com/file2.mp4' },
        ],
      }),
    });

    expect(res.status).toBe(400);
  });

  it('creates batch upload and child jobs atomically', async () => {
    const batchId = 'batch-key-001';
    const res = await SELF.fetch('https://uploader.local/api/v1/jobs/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfTokenA,
        'Idempotency-Key': batchId,
        Cookie: cookieA,
      },
      body: JSON.stringify({
        items: [
          { url: 'https://example.com/archive1.zip', filename: 'archive1.zip' },
          { url: 'https://example.com/video2.mp4', filename: 'video2.mp4' },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json<{ batch: BatchView; jobs: UploadJobView[] }>();
    expect(data.batch.id).toBe(batchId);
    expect(data.batch.itemCount).toBe(2);
    expect(data.batch.queuedCount).toBe(2);
    expect(data.batch.status).toBe('queued');
    expect(data.jobs).toHaveLength(2);
    expect(data.jobs[0].batchId).toBe(batchId);
    expect(data.jobs[0].sourceUrlRedacted).toBe('https://example.com/archive1.zip');

    expect(workflowCreateSpy).toHaveBeenCalledTimes(2);
    expect(workflowCreateSpy).toHaveBeenNthCalledWith(1, {
      id: `${batchId}-1`,
      params: { jobId: `${batchId}-1`, userId: userIdA },
    });
    expect(workflowCreateSpy).toHaveBeenNthCalledWith(2, {
      id: `${batchId}-2`,
      params: { jobId: `${batchId}-2`, userId: userIdA },
    });
  });

  it('returns existing batch on idempotent replay with same key', async () => {
    const batchId = 'batch-key-001';
    const res = await SELF.fetch('https://uploader.local/api/v1/jobs/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfTokenA,
        'Idempotency-Key': batchId,
        Cookie: cookieA,
      },
      body: JSON.stringify({
        items: [{ url: 'https://example.com/archive1.zip' }],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json<{ batch: BatchView; jobs: UploadJobView[] }>();
    expect(data.batch.id).toBe(batchId);
    expect(data.jobs).toHaveLength(2);

    expect(workflowCreateSpy).not.toHaveBeenCalled();
  });

  it('enforces cross-user isolation for batch queries', async () => {
    const batchId = 'batch-key-001';

    // User B attempts to get User A's batch
    const resB = await SELF.fetch(`https://uploader.local/api/v1/jobs/batch/${batchId}`, {
      headers: { Cookie: cookieB },
    });
    expect(resB.status).toBe(404);

    // User A gets their batch successfully
    const resA = await SELF.fetch(`https://uploader.local/api/v1/jobs/batch/${batchId}`, {
      headers: { Cookie: cookieA },
    });
    expect(resA.status).toBe(200);
    const dataA = await resA.json<{ batch: BatchView; jobs: UploadJobView[] }>();
    expect(dataA.batch.id).toBe(batchId);
  });

  it('cancels batch and requests cancellation on child jobs', async () => {
    const batchId = 'batch-key-001';
    const res = await SELF.fetch(`https://uploader.local/api/v1/jobs/batch/${batchId}/cancel`, {
      method: 'POST',
      headers: {
        'X-CSRF-Token': csrfTokenA,
        Cookie: cookieA,
      },
    });

    expect(res.status).toBe(200);
    const data = await res.json<{ batch: BatchView; jobs: UploadJobView[] }>();
    expect(['cancel_requested', 'canceled', 'running']).toContain(data.batch.status);
    expect(data.jobs.every((j) => ['cancel_requested', 'canceled'].includes(j.status))).toBe(true);
  });

  it('retries failed batch items', async () => {
    const batchId = 'batch-key-001';
    // Mark child jobs as failed to simulate terminal state ready for retry
    await env.DB.prepare("UPDATE upload_jobs SET status = 'failed' WHERE batch_id = ?").bind(batchId).run();

    const res = await SELF.fetch(`https://uploader.local/api/v1/jobs/batch/${batchId}/retry`, {
      method: 'POST',
      headers: {
        'X-CSRF-Token': csrfTokenA,
        Cookie: cookieA,
      },
    });

    expect(res.status).toBe(200);
    const data = await res.json<{ batch: BatchView; jobs: UploadJobView[] }>();
    expect(data.batch.status).toBe('queued');
    expect(data.batch.queuedCount).toBe(2);
    expect(data.jobs.every((j) => j.status === 'queued')).toBe(true);
  });

  it('lists batches with pagination', async () => {
    const res = await SELF.fetch('https://uploader.local/api/v1/jobs/batch', {
      headers: { Cookie: cookieA },
    });

    expect(res.status).toBe(200);
    const data = await res.json<{ batches: BatchView[]; nextCursor: string | null }>();
    expect(data.batches.length).toBeGreaterThanOrEqual(1);
    expect(data.batches[0].id).toBe('batch-key-001');
  });

  it('rejects duplicate URLs in the same batch', async () => {
    const res = await SELF.fetch('https://uploader.local/api/v1/jobs/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfTokenA,
        'Idempotency-Key': 'batch-duplicate-urls-test',
        Cookie: cookieA,
      },
      body: JSON.stringify({
        items: [
          { url: 'https://example.com/duplicate.mp4' },
          { url: 'https://example.com/duplicate.mp4' },
        ],
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json<{ error: { code: string; message: string } }>();
    expect(data.error.code).toBe('DUPLICATE_BATCH_URL');
  });

  it('redacts tokens and query parameters from stored sourceUrlRedacted and errors', async () => {
    const batchId = 'batch-redact-token-test';
    const res = await SELF.fetch('https://uploader.local/api/v1/jobs/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfTokenA,
        'Idempotency-Key': batchId,
        Cookie: cookieA,
      },
      body: JSON.stringify({
        items: [
          { url: 'https://example.com/video.mp4?token=secret123&signature=abc#frag' },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json<{ batch: BatchView; jobs: UploadJobView[] }>();
    expect(data.jobs[0].sourceUrlRedacted).toBe('https://example.com/video.mp4');
    expect(data.jobs[0].sourceUrlRedacted).not.toContain('secret123');
    expect(data.jobs[0].sourceUrlRedacted).not.toContain('frag');
  });

  it('rejects invalid or inaccessible destination folder', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({ access_token: 'mock-access-token', expires_in: 3600 }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.includes('googleapis.com/drive/v3/files/')) {
        return new Response(
          JSON.stringify({ error: { message: 'File not found', code: 404 } }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    try {
      const res = await SELF.fetch('https://uploader.local/api/v1/jobs/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfTokenA,
          'Idempotency-Key': 'batch-invalid-folder-test',
          Cookie: cookieA,
        },
        body: JSON.stringify({
          folderId: 'unauthorized-or-invalid-folder-xyz',
          items: [{ url: 'https://example.com/file1.mp4' }],
        }),
      });

      expect(res.status).toBe(404);
      const data = await res.json<{ error: { code: string } }>();
      expect(['DRIVE_NOT_FOUND', 'NOT_FOUND', 'INVALID_DESTINATION_FOLDER']).toContain(data.error.code);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('accepts valid destination folder and stores verified folder name', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({ access_token: 'mock-access-token', expires_in: 3600 }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.includes('googleapis.com/drive/v3/files/valid-folder-123')) {
        return new Response(
          JSON.stringify({
            id: 'valid-folder-123',
            name: 'Verified Downloads Folder',
            mimeType: 'application/vnd.google-apps.folder',
            trashed: false,
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    try {
      const res = await SELF.fetch('https://uploader.local/api/v1/jobs/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfTokenA,
          'Idempotency-Key': 'batch-valid-folder-test',
          Cookie: cookieA,
        },
        body: JSON.stringify({
          folderId: 'valid-folder-123',
          items: [{ url: 'https://example.com/file1.mp4' }],
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json<{ batch: BatchView; jobs: UploadJobView[] }>();
      expect(data.batch.destinationFolderId).toBe('valid-folder-123');
      expect(data.batch.destinationFolderName).toBe('Verified Downloads Folder');
      expect(data.jobs[0].destinationFolderId).toBe('valid-folder-123');
      expect(data.jobs[0].destinationFolderName).toBe('Verified Downloads Folder');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('enforces atomic rate limits when capacity would be exceeded', async () => {
    // Fill user active jobs close to MAX_CONCURRENT_JOBS_PER_USER (25)
    // We already have jobs seeded, insert dummy active jobs up to 24
    const existingCountRes = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM upload_jobs WHERE user_id = ? AND status IN ('staging', 'queued', 'fetching', 'uploading', 'cancel_requested')"
    )
      .bind(userIdB)
      .first<{ count: number }>();

    const currentActive = existingCountRes?.count || 0;
    const needed = 24 - currentActive;
    for (let i = 0; i < needed; i++) {
      await env.DB.prepare(
        `INSERT INTO upload_jobs (id, user_id, source_kind, filename, file_size, mime_type, status, version)
         VALUES (?, ?, 'remote', 'fill.mp4', 100, 'video/mp4', 'queued', 1)`
      )
        .bind(`fill-job-b-${i}`, userIdB)
        .run();
    }

    // Now submitting a batch of 2 items should exceed the limit of 25 (24 + 2 = 26 > 25)
    const res = await SELF.fetch('https://uploader.local/api/v1/jobs/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfTokenB,
        'Idempotency-Key': 'batch-rate-limit-overflow',
        Cookie: cookieB,
      },
      body: JSON.stringify({
        items: [
          { url: 'https://example.com/item1.mp4' },
          { url: 'https://example.com/item2.mp4' },
        ],
      }),
    });

    expect(res.status).toBe(429);
    const data = await res.json<{ error: { code: string } }>();
    expect(data.error.code).toBe('CONCURRENT_LIMIT_EXCEEDED');

    // Verify atomic all-or-nothing: no upload_batches or child jobs inserted
    const batchRow = await env.DB.prepare('SELECT * FROM upload_batches WHERE id = ?')
      .bind('batch-rate-limit-overflow')
      .first();
    expect(batchRow).toBeNull();
  });

  describe('Batch Repository (createBatch)', () => {
    it('returns one batch for simultaneous creates using the same idempotency key', async () => {
      const key = 'batch-concurrent-idempotency';
      const noDispatchEnv = { ...env, DRIVE_TRANSFER: undefined } as unknown as Env;
      const request = {
        items: [
          { url: 'https://example.com/concurrent-a.zip' },
          { url: 'https://example.com/concurrent-b.zip' },
        ],
      };

      const results = await Promise.allSettled([
        createBatch(noDispatchEnv, userIdA, key, request),
        createBatch(noDispatchEnv, userIdA, key, request),
      ]);

      expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
      const fulfilled = results.map((result) => {
        if (result.status !== 'fulfilled') throw result.reason;
        return result.value;
      });
      expect(fulfilled.map((result) => result.batch.id)).toEqual([key, key]);
      expect(fulfilled.every((result) => result.jobs.length === 2)).toBe(true);

      const batchCount = await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM upload_batches WHERE id = ?'
      ).bind(key).first<{ count: number }>();
      const jobCount = await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM upload_jobs WHERE batch_id = ?'
      ).bind(key).first<{ count: number }>();
      expect(batchCount?.count).toBe(1);
      expect(jobCount?.count).toBe(2);
    });
  });

  describe('Batch Repository (retryBatch)', () => {
    const retryUsers = {
      repeated: 'usr-batch-retry-repeated',
      capacity: 'usr-batch-retry-capacity',
      concurrent: 'usr-batch-retry-concurrent',
    };
    const noDispatchEnv = { ...env, DRIVE_TRANSFER: undefined } as unknown as Env;

    async function seedChild(
      userId: string,
      jobId: string,
      status: 'failed' | 'completed',
      attemptStatus = status
    ): Promise<void> {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO upload_jobs (
             id, user_id, batch_id, source_kind, source_url_redacted,
             filename, file_size, mime_type, status, attempt_count, version
           )
           VALUES (?, ?, ?, 'remote', ?, ?, 1024, 'application/octet-stream', ?, 1, 1)`
        ).bind(jobId, userId, jobId.replace(/-[0-9]+$/, ''), 'https://example.com/retry.bin', jobId, status),
        env.DB.prepare(
          `INSERT INTO upload_attempts
             (id, job_id, user_id, attempt_number, status)
           VALUES (?, ?, ?, 1, ?)`
        ).bind(`${jobId}-1`, jobId, userId, attemptStatus),
      ]);
    }

    async function seedBatch(
      userId: string,
      batchId: string,
      children: Array<{ id: string; status: 'failed' | 'completed' }>
    ): Promise<void> {
      await env.DB.prepare(
        `INSERT INTO upload_batches (id, user_id, item_count, version, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`
      )
        .bind(batchId, userId, children.length, new Date().toISOString(), new Date().toISOString())
        .run();
      for (const child of children) {
        await seedChild(userId, child.id, child.status);
      }
    }

    beforeAll(async () => {
      for (const [name, userId] of Object.entries(retryUsers)) {
        await env.DB.prepare(
          `INSERT INTO users (id, google_sub, email, name, picture)
           VALUES (?, ?, ?, ?, ?)`
        )
          .bind(userId, `sub-batch-retry-${name}`, `batch-retry-${name}@example.com`, 'Batch Retry', null)
          .run();
      }
    });

    it('treats repeated retries as successful no-ops with a single new attempt', async () => {
      const userId = retryUsers.repeated;
      const batchId = 'batch-retry-repeated';
      const failedJobId = `${batchId}-1`;
      const completedJobId = `${batchId}-2`;
      await seedBatch(userId, batchId, [
        { id: failedJobId, status: 'failed' },
        { id: completedJobId, status: 'completed' },
      ]);

      const first = await retryBatch(noDispatchEnv, userId, batchId);
      const second = await retryBatch(noDispatchEnv, userId, batchId);

      expect(first.jobs.find((job) => job.id === failedJobId)?.status).toBe('queued');
      expect(second.jobs.find((job) => job.id === failedJobId)?.status).toBe('queued');
      expect(second.jobs.find((job) => job.id === completedJobId)?.status).toBe('completed');

      const attempts = await env.DB.prepare(
        'SELECT attempt_number FROM upload_attempts WHERE job_id = ? ORDER BY attempt_number'
      ).bind(failedJobId).all<{ attempt_number: number }>();
      expect(attempts.results.map((row) => row.attempt_number)).toEqual([1, 2]);
    });

    it('rejects retry atomically when capacity would be exceeded', async () => {
      const userId = retryUsers.capacity;
      const batchId = 'batch-retry-capacity';
      const childA = `${batchId}-1`;
      const childB = `${batchId}-2`;
      await seedBatch(userId, batchId, [
        { id: childA, status: 'failed' },
        { id: childB, status: 'failed' },
      ]);

      for (let i = 0; i < 24; i++) {
        await env.DB.prepare(
          `INSERT INTO upload_jobs (id, user_id, source_kind, filename, file_size, mime_type, status, version)
           VALUES (?, ?, 'remote', 'fill-retry.mp4', 100, 'video/mp4', 'queued', 1)`
        )
          .bind(`retry-fill-${i}`, userId)
          .run();
      }

      await expect(retryBatch(noDispatchEnv, userId, batchId)).rejects.toMatchObject({
        code: 'CONCURRENT_LIMIT_EXCEEDED',
        status: 429,
      });

      const children = await env.DB.prepare(
        'SELECT status, attempt_count FROM upload_jobs WHERE batch_id = ? ORDER BY id'
      ).bind(batchId).all<{ status: string; attempt_count: number }>();
      expect(children.results).toEqual([
        { status: 'failed', attempt_count: 1 },
        { status: 'failed', attempt_count: 1 },
      ]);

      const attemptCount = await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM upload_attempts WHERE job_id IN (?, ?) AND attempt_number = 2'
      ).bind(childA, childB).first<{ count: number }>();
      expect(attemptCount?.count).toBe(0);
    });

    it('creates exactly one new attempt under simultaneous retries', async () => {
      const userId = retryUsers.concurrent;
      const batchId = 'batch-retry-concurrent';
      const childId = `${batchId}-1`;
      await seedBatch(userId, batchId, [{ id: childId, status: 'failed' }]);

      const results = await Promise.allSettled([
        retryBatch(noDispatchEnv, userId, batchId),
        retryBatch(noDispatchEnv, userId, batchId),
      ]);

      expect(results.every((result) => result.status === 'fulfilled')).toBe(true);

      const child = await env.DB.prepare(
        'SELECT status, attempt_count FROM upload_jobs WHERE id = ?'
      ).bind(childId).first<{ status: string; attempt_count: number }>();
      expect(child?.status).toBe('queued');
      expect(child?.attempt_count).toBe(2);

      const attempts = await env.DB.prepare(
        'SELECT attempt_number FROM upload_attempts WHERE job_id = ? ORDER BY attempt_number'
      ).bind(childId).all<{ attempt_number: number }>();
      expect(attempts.results.map((row) => row.attempt_number)).toEqual([1, 2]);
    });
  });
});

