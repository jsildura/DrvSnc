import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from './testDb';
import { hashOpaqueToken, encryptSecret } from '../../src/worker/services/crypto';
import { UploadJobView } from '../../src/shared/contracts';

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
