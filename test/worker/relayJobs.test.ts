import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from './testDb';
import { hashOpaqueToken, encryptSecret } from '../../src/worker/services/crypto';
import { UploadJobView } from '../../src/shared/contracts';

/**
 * Browser-relayed transfers: the tab fetches an IP-bound source itself and stages it into R2, so the
 * job is stored as `local` (the R2 → Drive workflow is unchanged) but records where the bytes came
 * from. These are the server-side halves of that: a job the client can sign parts against without
 * knowing the length up front, a size that is authoritative by the time Drive needs it, and a cancel
 * that does not leave a half-written multipart upload behind.
 */
describe('Browser Relay Staging API', () => {
  const userIdA = 'usr-relay-a';
  const userIdB = 'usr-relay-b';
  const rawTokenA = 'raw-session-relay-a';
  const rawTokenB = 'raw-session-relay-b';
  const csrfTokenA = 'csrf-relay-a';
  const csrfTokenB = 'csrf-relay-b';
  const cookieA = `gdu_session=${rawTokenA}; gdu_csrf=${csrfTokenA}`;
  const cookieB = `gdu_session=${rawTokenB}; gdu_csrf=${csrfTokenB}`;

  // The shape that motivates the whole feature: the access token lives in the query string and the
  // path names a delivery script rather than a file.
  const signedUrl =
    'https://cdn.example.com/media/remote_control.php?file=clip.mp4&acctoken=SUPERSECRETTOKEN';

  // Stands in for the R2 → Drive workflow. Left real it would run against a fake refresh token and
  // spray auth failures across the run; stubbed it also records that leg 3 was dispatched at all.
  const workflowCreateSpy = vi.fn(async (opts: { id: string }) => ({ id: opts.id }));

  const writeHeaders = (cookie: string, csrf: string, idempotencyKey?: string) => ({
    Cookie: cookie,
    'X-CSRF-Token': csrf,
    Origin: 'https://example.com',
    'Content-Type': 'application/json',
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  });

  async function createRelayJob(
    idempotencyKey: string,
    body: Record<string, unknown> = {}
  ): Promise<{ job: UploadJobView; partSize: number; partCount: number; uploadId: string }> {
    const res = await SELF.fetch('https://example.com/api/v1/jobs/relay', {
      method: 'POST',
      headers: writeHeaders(cookieA, csrfTokenA, idempotencyKey),
      body: JSON.stringify({ url: signedUrl, fileSize: 0, ...body }),
    });

    expect(res.status).toBe(201);
    return res.json();
  }

  async function stagingRow(jobId: string) {
    return env.DB.prepare(
      'SELECT r2_object_key, r2_upload_id, file_size, status, source_kind, source_url_redacted FROM upload_jobs WHERE id = ?'
    )
      .bind(jobId)
      .first<{
        r2_object_key: string;
        r2_upload_id: string;
        file_size: number;
        status: string;
        source_kind: string;
        source_url_redacted: string | null;
      }>();
  }

  beforeAll(async () => {
    await applyMigrations(env.DB);

    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userIdA, 'sub-relay-a', 'relay-a@example.com', 'Relay User A', null)
      .run();

    const encA = await encryptSecret('refresh-a', env.TOKEN_ENCRYPTION_KEY, userIdA);
    await env.DB.prepare(
      `INSERT INTO google_credentials (user_id, ciphertext, iv, key_version) VALUES (?, ?, ?, ?)`
    )
      .bind(userIdA, encA.ciphertext, encA.iv, 1)
      .run();

    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`
    )
      .bind('sess-relay-a', userIdA, await hashOpaqueToken(rawTokenA), csrfTokenA)
      .run();

    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userIdB, 'sub-relay-b', 'relay-b@example.com', 'Relay User B', null)
      .run();

    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`
    )
      .bind('sess-relay-b', userIdB, await hashOpaqueToken(rawTokenB), csrfTokenB)
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

  describe('POST /api/v1/jobs/relay', () => {
    it('creates a staging local job that records the source without its token', async () => {
      const data = await createRelayJob('key-relay-create');

      expect(data.job.id).toBe('key-relay-create');
      expect(data.job.status).toBe('staging');
      // The R2 → Drive workflow branch is chosen by `sourceKind`, and a relay uses the local one.
      expect(data.job.sourceKind).toBe('local');
      // ...but the redacted URL is what tells the UI this was a relay rather than a picked file.
      expect(data.job.sourceUrlRedacted).toBe('https://cdn.example.com/media/remote_control.php');
      expect(data.job.sourceUrlRedacted).not.toContain('SUPERSECRETTOKEN');

      // Recovered from `file=` because the path names a PHP endpoint; Drive previews on the type.
      expect(data.job.filename).toBe('clip.mp4');
      expect(data.job.mimeType).toBe('video/mp4');

      expect(data.uploadId).toBeTruthy();
      expect(data.partSize).toBe(16 * 1024 * 1024);

      const row = await stagingRow(data.job.id);
      expect(row?.r2_object_key).toContain('clip.mp4');
      expect(row?.r2_upload_id).toBe(data.uploadId);
      expect(row?.file_size).toBe(0);
    });

    it('rejects a request with no Idempotency-Key', async () => {
      const res = await SELF.fetch('https://example.com/api/v1/jobs/relay', {
        method: 'POST',
        headers: writeHeaders(cookieA, csrfTokenA),
        body: JSON.stringify({ url: signedUrl, fileSize: 0 }),
      });

      expect(res.status).toBe(400);
    });

    it('applies the same SSRF policy the worker-side fetch does', async () => {
      const res = await SELF.fetch('https://example.com/api/v1/jobs/relay', {
        method: 'POST',
        headers: writeHeaders(cookieA, csrfTokenA, 'key-relay-ssrf'),
        body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data', fileSize: 0 }),
      });

      expect(res.status).toBe(400);
      const body = await res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('INVALID_REQUEST');
    });
  });

  describe('GET /api/v1/jobs/:id/parts', () => {
    it('signs past the declared part count when the length is unknown', async () => {
      const data = await createRelayJob('key-relay-parts');

      const res = await SELF.fetch(
        `https://example.com/api/v1/jobs/${data.job.id}/parts?from=1&count=20`,
        { headers: { Cookie: cookieA } }
      );

      expect(res.status).toBe(200);
      const body = await res.json<{ parts: { partNumber: number; url: string }[] }>();
      // `calculatePartLayout(0)` says one part. A streamed source has no length to lay out, so the
      // client discovers the end by reaching it and must be able to sign ahead of that.
      expect(body.parts).toHaveLength(20);
      expect(body.parts[19].partNumber).toBe(20);
      expect(body.parts[19].url).toContain('partNumber=20');
    });

    it('still caps at the part count for a source of declared length', async () => {
      const data = await createRelayJob('key-relay-parts-known', {
        fileSize: 20 * 1024 * 1024, // 2 parts at 16 MiB
      });

      const res = await SELF.fetch(
        `https://example.com/api/v1/jobs/${data.job.id}/parts?from=1&count=20`,
        { headers: { Cookie: cookieA } }
      );

      const body = await res.json<{ parts: { partNumber: number }[] }>();
      expect(body.parts).toHaveLength(2);
    });

    it('rejects cross-user access to parts', async () => {
      const data = await createRelayJob('key-relay-parts-cross');

      const res = await SELF.fetch(
        `https://example.com/api/v1/jobs/${data.job.id}/parts?from=1&count=1`,
        { headers: { Cookie: cookieB } }
      );

      expect(res.status).toBe(404);
    });

    it('falls back to defaults for an unparseable range instead of signing nothing', async () => {
      const data = await createRelayJob('key-relay-parts-nan');

      const res = await SELF.fetch(
        `https://example.com/api/v1/jobs/${data.job.id}/parts?from=abc&count=xyz`,
        { headers: { Cookie: cookieA } }
      );

      expect(res.status).toBe(200);
      const body = await res.json<{ parts: { partNumber: number }[] }>();
      // `parseInt('abc')` is NaN, and NaN passes straight through Math.max/Math.min — so the loop
      // bound was NaN and the client got an empty list with a 200 and no explanation.
      expect(body.parts).toHaveLength(10);
      expect(body.parts[0].partNumber).toBe(1);
    });
  });

  describe('POST /api/v1/jobs/:id/complete', () => {
    it('writes the size R2 confirms, not the one the client reported', async () => {
      const data = await createRelayJob('key-relay-complete-confirmed');
      const row = await stagingRow(data.job.id);

      // Stage a real part through the binding so the multipart completion actually succeeds and R2
      // can report the assembled length.
      const upload = env.UPLOADS.resumeMultipartUpload(row!.r2_object_key, row!.r2_upload_id);
      const staged = await upload.uploadPart(1, new Uint8Array(1234567));

      const res = await SELF.fetch(`https://example.com/api/v1/jobs/${data.job.id}/complete`, {
        method: 'POST',
        headers: writeHeaders(cookieA, csrfTokenA),
        body: JSON.stringify({
          parts: [{ partNumber: 1, etag: staged.etag }],
          // Deliberately wrong: R2's own report has to win, because Drive's resumable session
          // rejects a Content-Range that disagrees with the bytes it receives.
          totalBytes: 999,
        }),
      });

      expect(res.status).toBe(200);
      const job = await res.json<UploadJobView>();
      expect(job.status).toBe('queued');
      expect(job.fileSize).toBe(1234567);

      // Leg 3 is the unchanged local branch of the transfer workflow.
      expect(workflowCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: data.job.id, params: { jobId: data.job.id, userId: userIdA } })
      );
    });

    it('falls back to the client byte count when R2 cannot confirm the size', async () => {
      const data = await createRelayJob('key-relay-complete-fallback');

      // No parts were really staged, so completion fails and reports "unconfirmed" — the path a
      // mocked or non-R2 environment takes.
      const res = await SELF.fetch(`https://example.com/api/v1/jobs/${data.job.id}/complete`, {
        method: 'POST',
        headers: writeHeaders(cookieA, csrfTokenA),
        body: JSON.stringify({
          parts: [{ partNumber: 1, etag: 'not-a-real-etag' }],
          totalBytes: 4242,
        }),
      });

      expect(res.status).toBe(200);
      const job = await res.json<UploadJobView>();
      expect(job.status).toBe('queued');
      expect(job.fileSize).toBe(4242);
    });

    it('prefers the staged byte count over a declared size that disagrees with it', async () => {
      // A relay's `file_size` is only what the remote host claimed in `Content-Length` before the
      // transfer began. Hosts truncate, re-encode and lie; the client's count is of bytes that
      // actually reached R2. Writing the claim would make Drive reject the first Content-Range.
      const data = await createRelayJob('key-relay-complete-disagree', {
        fileSize: 20 * 1024 * 1024,
      });

      const res = await SELF.fetch(`https://example.com/api/v1/jobs/${data.job.id}/complete`, {
        method: 'POST',
        headers: writeHeaders(cookieA, csrfTokenA),
        body: JSON.stringify({
          parts: [{ partNumber: 1, etag: 'not-a-real-etag' }],
          totalBytes: 7_777_777,
        }),
      });

      expect(res.status).toBe(200);
      const job = await res.json<UploadJobView>();
      expect(job.fileSize).toBe(7_777_777);
    });

    it('refuses to queue a transfer whose size is unknown', async () => {
      const data = await createRelayJob('key-relay-complete-sizeless');

      const res = await SELF.fetch(`https://example.com/api/v1/jobs/${data.job.id}/complete`, {
        method: 'POST',
        headers: writeHeaders(cookieA, csrfTokenA),
        body: JSON.stringify({ parts: [{ partNumber: 1, etag: 'not-a-real-etag' }] }),
      });

      // Drive's resumable upload needs an exact total; queueing without one only fails later.
      expect(res.status).toBe(400);
      const body = await res.json<{ error: { code: string; message: string } }>();
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('totalBytes');

      expect((await stagingRow(data.job.id))?.status).toBe('staging');
      expect(workflowCreateSpy).not.toHaveBeenCalled();
    });

    it('rejects a client byte count over the upload maximum', async () => {
      const data = await createRelayJob('key-relay-complete-too-large');

      const res = await SELF.fetch(`https://example.com/api/v1/jobs/${data.job.id}/complete`, {
        method: 'POST',
        headers: writeHeaders(cookieA, csrfTokenA),
        body: JSON.stringify({
          parts: [{ partNumber: 1, etag: 'not-a-real-etag' }],
          totalBytes: 6 * 1024 * 1024 * 1024,
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/jobs/:id/cancel', () => {
    it('abandons the R2 multipart upload when a staging relay is canceled', async () => {
      const data = await createRelayJob('key-relay-cancel');
      const row = await stagingRow(data.job.id);

      const res = await SELF.fetch(`https://example.com/api/v1/jobs/${data.job.id}/cancel`, {
        method: 'POST',
        headers: writeHeaders(cookieA, csrfTokenA),
      });

      expect(res.status).toBe(200);
      const job = await res.json<UploadJobView>();
      expect(job.status).toBe('canceled');

      // A relay hits this path routinely — the source refuses the fetch, or the tab closes
      // mid-stream — and R2 keeps abandoned parts billable until the upload is explicitly aborted.
      const resumed = env.UPLOADS.resumeMultipartUpload(row!.r2_object_key, row!.r2_upload_id);
      await expect(resumed.uploadPart(1, new Uint8Array(8))).rejects.toThrow();
    });
  });
});
