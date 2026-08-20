import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from './testDb';
import { hashOpaqueToken, encryptSecret } from '../../src/worker/services/crypto';
import { UploadJobView } from '../../src/shared/contracts';

const workflowCreateSpy = vi.fn(
  async (_input: { id?: string; params?: Record<string, unknown> }) => ({
    id: 'test-workflow-instance',
  })
);

describe('Durable Upload Job API (/api/v1/jobs)', () => {
  const userIdA = 'usr-job-a';
  const userIdB = 'usr-job-b';
  const rawTokenA = 'raw-session-job-a';
  const rawTokenB = 'raw-session-job-b';
  const csrfTokenA = 'csrf-job-a';
  const csrfTokenB = 'csrf-job-b';
  const cookieA = `gdu_session=${rawTokenA}; gdu_csrf=${csrfTokenA}`;
  const cookieB = `gdu_session=${rawTokenB}; gdu_csrf=${csrfTokenB}`;

  beforeAll(async () => {
    await applyMigrations(env.DB);

    // Seed User A
    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userIdA, 'sub-job-a', 'job-a@example.com', 'Job A', null)
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
      .bind('sess-job-a', userIdA, tokenHashA, csrfTokenA)
      .run();

    // Seed User B
    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userIdB, 'sub-job-b', 'job-b@example.com', 'Job B', null)
      .run();

    const tokenHashB = await hashOpaqueToken(rawTokenB);
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`
    )
      .bind('sess-job-b', userIdB, tokenHashB, csrfTokenB)
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

  describe('POST /api/v1/jobs/remote', () => {
    it('requires Idempotency-Key header', async () => {
      const res = await SELF.fetch('https://example.com/api/v1/jobs/remote', {
        method: 'POST',
        headers: {
          Cookie: cookieA,
          'X-CSRF-Token': csrfTokenA,
          Origin: 'https://example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://example.com/file.zip',
        }),
      });

      expect(res.status).toBe(400);
      const err = await res.json<{ error: { code: string } }>();
      expect(err.error.code).toBe('INVALID_REQUEST');
    });

    it('rejects URL schemes that cannot be upgraded to https', async () => {
      const res = await SELF.fetch('https://example.com/api/v1/jobs/remote', {
        method: 'POST',
        headers: {
          Cookie: cookieA,
          'X-CSRF-Token': csrfTokenA,
          'Idempotency-Key': 'key-scheme-fail',
          Origin: 'https://example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: 'ftp://example.com/insecure.iso',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('accepts a token-protected progressive MP4 over http', async () => {
      // A pasted delivery link: plain http, the real name hidden behind a signed `file=` token,
      // and a path that names a PHP script rather than the video.
      const token = `${'R8cOl0GU0HGcB0AC3ezd'.repeat(5)}_uFD2K9m2SW`;
      const res = await SELF.fetch('https://example.com/api/v1/jobs/remote', {
        method: 'POST',
        headers: {
          Cookie: cookieA,
          'X-CSRF-Token': csrfTokenA,
          'Idempotency-Key': 'key-progressive-mp4',
          Origin: 'https://example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: `http://videos15.example.com/remote_control.php?file=${token}.mp4&acctoken=ZWRmZGRi`,
        }),
      });

      expect(res.status).toBe(201);
      const job = await res.json<UploadJobView>();
      expect(job.filename).toBe('remote_control.mp4');
      // Stored as https, and with the signed token stripped out of the loggable form.
      expect(job.sourceUrlRedacted).toBe('https://videos15.example.com/remote_control.php');
    });

    it('creates remote job and returns idempotent result on retry', async () => {
      const idempotencyKey = 'key-remote-success-1';

      const res1 = await SELF.fetch('https://example.com/api/v1/jobs/remote', {
        method: 'POST',
        headers: {
          Cookie: cookieA,
          'X-CSRF-Token': csrfTokenA,
          'Idempotency-Key': idempotencyKey,
          Origin: 'https://example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://example.com/data.tar.gz',
          filename: 'data.tar.gz',
        }),
      });

      expect(res1.status).toBe(201);
      const job1 = await res1.json<UploadJobView>();
      expect(job1.id).toBeDefined();
      expect(job1.sourceKind).toBe('remote');
      expect(job1.status).toBe('queued');
      expect(job1.sourceUrlRedacted).toBe('https://example.com/data.tar.gz');

      // Idempotent retry with same key
      const res2 = await SELF.fetch('https://example.com/api/v1/jobs/remote', {
        method: 'POST',
        headers: {
          Cookie: cookieA,
          'X-CSRF-Token': csrfTokenA,
          'Idempotency-Key': idempotencyKey,
          Origin: 'https://example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://example.com/data.tar.gz',
          filename: 'data.tar.gz',
        }),
      });

      expect(res2.status).toBe(200);
      const job2 = await res2.json<UploadJobView>();
      expect(job2.id).toBe(job1.id);

      expect(workflowCreateSpy).toHaveBeenCalledTimes(1);
      expect(workflowCreateSpy).toHaveBeenNthCalledWith(1, {
        id: idempotencyKey,
        params: { jobId: idempotencyKey, userId: userIdA },
      });
    });
  });

  describe('GET /api/v1/jobs & Pagination / ETag', () => {
    it('lists jobs for authenticated user and supports ETag 304', async () => {
      const res1 = await SELF.fetch('https://example.com/api/v1/jobs', {
        headers: { Cookie: cookieA },
      });

      expect(res1.status).toBe(200);
      const etag = res1.headers.get('ETag');
      expect(etag).toBeDefined();

      const body = await res1.json<{ jobs: UploadJobView[]; nextCursor: string | null }>();
      expect(body.jobs.length).toBeGreaterThanOrEqual(1);

      // Verify ETag 304
      const res304 = await SELF.fetch('https://example.com/api/v1/jobs', {
        headers: {
          Cookie: cookieA,
          'If-None-Match': etag!,
        },
      });
      expect(res304.status).toBe(304);
    });

    it('enforces multi-tenant isolation', async () => {
      // User B should not see User A's jobs
      const res = await SELF.fetch('https://example.com/api/v1/jobs', {
        headers: { Cookie: cookieB },
      });

      expect(res.status).toBe(200);
      const body = await res.json<{ jobs: UploadJobView[] }>();
      expect(body.jobs).toHaveLength(0);
    });
  });

  describe('Cancel, Retry, and Terminal Lifecycle', () => {
    let testJobId: string;

    beforeAll(async () => {
      // Insert a failed job and an active job for User A
      testJobId = 'job-lifecycle-test-1';
      await env.DB.prepare(
        `INSERT INTO upload_jobs (id, user_id, source_kind, filename, file_size, mime_type, status, version)
         VALUES (?, ?, 'remote', 'sample.iso', 1048576, 'application/octet-stream', 'uploading', 1)`
      )
        .bind(testJobId, userIdA)
        .run();
    });

    it('cancels active job and updates status to cancel_requested or canceled', async () => {
      const res = await SELF.fetch(`https://example.com/api/v1/jobs/${testJobId}/cancel`, {
        method: 'POST',
        headers: {
          Cookie: cookieA,
          'X-CSRF-Token': csrfTokenA,
          Origin: 'https://example.com',
        },
      });

      expect(res.status).toBe(200);
      const job = await res.json<UploadJobView>();
      expect(['cancel_requested', 'canceled']).toContain(job.status);
    });

    it('retries job only from failed or canceled status', async () => {
      // Mark as failed first
      await env.DB.prepare(
        `UPDATE upload_jobs SET status = 'failed', error_code = 'UPLOAD_TIMEOUT' WHERE id = ?`
      )
        .bind(testJobId)
        .run();

      const res = await SELF.fetch(`https://example.com/api/v1/jobs/${testJobId}/retry`, {
        method: 'POST',
        headers: {
          Cookie: cookieA,
          'X-CSRF-Token': csrfTokenA,
          Origin: 'https://example.com',
        },
      });

      expect(res.status).toBe(200);
      const job = await res.json<UploadJobView>();
      expect(job.status).toBe('queued');
      expect(job.attemptCount).toBe(2);
      expect(job.errorCode).toBeNull();

      expect(workflowCreateSpy).toHaveBeenCalledTimes(1);
      expect(workflowCreateSpy).toHaveBeenNthCalledWith(1, {
        id: `${testJobId}-attempt-2`,
        params: { jobId: testJobId, userId: userIdA, attemptNumber: 2 },
      });
    });

    it('DELETE /api/v1/jobs/:id deletes terminal job history', async () => {
      // Set to completed
      await env.DB.prepare(
        `UPDATE upload_jobs SET status = 'completed' WHERE id = ?`
      )
        .bind(testJobId)
        .run();

      const res = await SELF.fetch(`https://example.com/api/v1/jobs/${testJobId}`, {
        method: 'DELETE',
        headers: {
          Cookie: cookieA,
          'X-CSRF-Token': csrfTokenA,
          Origin: 'https://example.com',
        },
      });

      expect(res.status).toBe(200);

      // Verify removed from D1
      const check = await env.DB.prepare('SELECT * FROM upload_jobs WHERE id = ?')
        .bind(testJobId)
        .first();
      expect(check).toBeNull();
    });
  });
});
