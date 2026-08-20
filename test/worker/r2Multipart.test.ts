import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from './testDb';
import { hashOpaqueToken, encryptSecret } from '../../src/worker/services/crypto';
import { UploadJobView } from '../../src/shared/contracts';
import { generateR2Key, stagingFallbackKey } from '../../src/worker/services/r2Multipart';

describe('R2 staging key construction', () => {
  // Every segment of this key is interpolated into a presigned S3 URL, and the signature covers the
  // path. A segment that can carry `/`, `..`, `?` or `#` can therefore address a different object
  // than the one that was signed for — including one under another user's prefix.
  const hostile = [
    '../../usr-2/job-9',
    '../../../etc/passwd',
    'job?uploadId=stolen',
    'job#fragment',
    'job/../../elsewhere',
    '..',
    '.',
    '....//',
    '.hidden',
  ];

  it('leaves an ordinary key untouched', () => {
    expect(generateR2Key('usr-1', 'job-1', 'clip.mp4')).toBe('staging/usr-1/job-1/clip.mp4');
    expect(stagingFallbackKey('usr-1', 'job-1')).toBe('staging/usr-1/job-1');
  });

  it('confines each segment to one non-relative path element', () => {
    for (const value of hostile) {
      for (const key of [
        generateR2Key(value, 'job-1', 'clip.mp4'),
        generateR2Key('usr-1', value, 'clip.mp4'),
        generateR2Key('usr-1', 'job-1', value),
        stagingFallbackKey('usr-1', value),
      ]) {
        const segments = key.split('/');
        expect(segments[0]).toBe('staging');
        expect(segments.length).toBeLessThanOrEqual(4);
        for (const segment of segments) {
          expect(segment).not.toBe('');
          expect(segment).not.toContain('..');
          expect(segment.startsWith('.')).toBe(false);
          expect(segment).toMatch(/^[a-zA-Z0-9._-]+$/);
        }
      }
    }
  });

  it('falls back rather than emitting an empty segment', () => {
    expect(generateR2Key('', '', '')).toBe('staging/user/job/file');
  });
});

describe('R2 Multipart Local File Staging API', () => {
  const userIdA = 'usr-r2-a';
  const userIdB = 'usr-r2-b';
  const rawTokenA = 'raw-session-r2-a';
  const rawTokenB = 'raw-session-r2-b';
  const csrfTokenA = 'csrf-r2-a';
  const csrfTokenB = 'csrf-r2-b';
  const cookieA = `gdu_session=${rawTokenA}; gdu_csrf=${csrfTokenA}`;
  const cookieB = `gdu_session=${rawTokenB}; gdu_csrf=${csrfTokenB}`;

  beforeAll(async () => {
    await applyMigrations(env.DB);

    // Seed User A
    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userIdA, 'sub-r2-a', 'r2-a@example.com', 'R2 User A', null)
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
      .bind('sess-r2-a', userIdA, tokenHashA, csrfTokenA)
      .run();

    // Seed User B
    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userIdB, 'sub-r2-b', 'r2-b@example.com', 'R2 User B', null)
      .run();

    const tokenHashB = await hashOpaqueToken(rawTokenB);
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`
    )
      .bind('sess-r2-b', userIdB, tokenHashB, csrfTokenB)
      .run();
  });

  describe('POST /api/v1/jobs/local', () => {
    it('creates a staging local upload job and calculates part layout', async () => {
      const idempotencyKey = 'key-local-test-1';
      const fileSize = 35 * 1024 * 1024; // 35 MiB -> 3 parts with 16 MiB part size

      const res = await SELF.fetch('https://example.com/api/v1/jobs/local', {
        method: 'POST',
        headers: {
          Cookie: cookieA,
          'X-CSRF-Token': csrfTokenA,
          'Idempotency-Key': idempotencyKey,
          Origin: 'https://example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: 'archive.zip',
          fileSize,
          mimeType: 'application/zip',
          folderId: 'drive-folder-1',
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json<{
        job: UploadJobView;
        partSize: number;
        partCount: number;
        uploadId: string;
      }>();

      expect(data.job.id).toBe(idempotencyKey);
      expect(data.job.status).toBe('staging');
      expect(data.job.sourceKind).toBe('local');
      expect(data.partSize).toBe(16 * 1024 * 1024);
      expect(data.partCount).toBe(3);
      expect(data.uploadId).toBeDefined();
    });

    const createLocal = (idempotencyKey: string, cookie = cookieA, csrf = csrfTokenA) =>
      SELF.fetch('https://example.com/api/v1/jobs/local', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'X-CSRF-Token': csrf,
          'Idempotency-Key': idempotencyKey,
          Origin: 'https://example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: 'archive.zip',
          fileSize: 1024,
          mimeType: 'application/zip',
        }),
      });

    // The key is not just a dedupe token: it becomes the job id, a segment of the presigned R2 path
    // and the Workflow instance id, so its shape is checked at the boundary rather than downstream.
    it('rejects an Idempotency-Key that is not an opaque identifier', async () => {
      for (const bad of ['../../etc/passwd', 'short', 'has space', 'key/with/slashes', 'a?b=c']) {
        const res = await createLocal(bad);
        expect(res.status).toBe(400);
        const body = await res.json<{ error: { code: string } }>();
        expect(body.error.code).toBe('INVALID_REQUEST');
      }
    });

    it('answers 409 for a key another account already owns', async () => {
      const shared = 'key-local-shared-owner';
      expect((await createLocal(shared)).status).toBe(201);

      // `upload_jobs.id` *is* the key, so it is unique table-wide. Scoping the existence check by
      // user made this land on the insert as a bare UNIQUE violation — a 500 — and left the
      // multipart upload opened moments earlier with no row to reference it.
      const res = await createLocal(shared, cookieB, csrfTokenB);
      expect(res.status).toBe(409);
      const body = await res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('CONFLICT');
    });

    it('replays the recorded upload id when the same key is sent twice', async () => {
      const key = 'key-local-replayed';
      const first = await createLocal(key);
      expect(first.status).toBe(201);
      const firstData = await first.json<{ uploadId: string }>();

      const second = await createLocal(key);
      expect(second.status).toBe(200);
      const secondData = await second.json<{ job: UploadJobView; uploadId: string }>();

      // A second multipart upload here would be unreferenced and billable, so the retry has to hand
      // back the one the row already points at.
      expect(secondData.job.id).toBe(key);
      expect(secondData.uploadId).toBe(firstData.uploadId);
    });
  });

  describe('GET /api/v1/jobs/:id/parts & POST /api/v1/jobs/:id/complete', () => {
    const jobId = 'key-local-part-test';
    const fileSize = 5 * 1024 * 1024; // 5 MiB (1 part)

    beforeAll(async () => {
      // Create local job
      await SELF.fetch('https://example.com/api/v1/jobs/local', {
        method: 'POST',
        headers: {
          Cookie: cookieA,
          'X-CSRF-Token': csrfTokenA,
          'Idempotency-Key': jobId,
          Origin: 'https://example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: 'single-part.bin',
          fileSize,
          mimeType: 'application/octet-stream',
        }),
      });
    });

    it('returns signed part URLs for batch upload', async () => {
      const res = await SELF.fetch(`https://example.com/api/v1/jobs/${jobId}/parts?from=1&count=2`, {
        headers: { Cookie: cookieA },
      });

      expect(res.status).toBe(200);
      const body = await res.json<{ parts: { partNumber: number; url: string }[] }>();
      expect(body.parts).toHaveLength(1);
      expect(body.parts[0].partNumber).toBe(1);
      expect(body.parts[0].url).toContain('partNumber=1');
    });

    it('rejects cross-user access to parts', async () => {
      const res = await SELF.fetch(`https://example.com/api/v1/jobs/${jobId}/parts?from=1&count=1`, {
        headers: { Cookie: cookieB },
      });
      expect(res.status).toBe(404);
    });

    it('completes multipart staging and transitions status to queued', async () => {
      // Perform mock multipart complete
      const completeRes = await SELF.fetch(`https://example.com/api/v1/jobs/${jobId}/complete`, {
        method: 'POST',
        headers: {
          Cookie: cookieA,
          'X-CSRF-Token': csrfTokenA,
          Origin: 'https://example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parts: [{ partNumber: 1, etag: 'mock-etag-part-1' }],
        }),
      });

      expect(completeRes.status).toBe(200);
      const job = await completeRes.json<UploadJobView>();
      expect(job.status).toBe('queued');
    });
  });
});
