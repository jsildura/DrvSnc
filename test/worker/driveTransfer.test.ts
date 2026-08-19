import { describe, it, expect, beforeAll, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from './testDb';
import { hashOpaqueToken, encryptSecret } from '../../src/worker/services/crypto';
import { runDriveTransfer } from '../../src/worker/workflows/DriveTransfer';

describe('DriveTransferWorkflow Background Transfer Runner', () => {
  const userId = 'usr-workflow-test';
  const rawToken = 'raw-session-workflow-test';
  const csrfToken = 'csrf-workflow-test';

  beforeAll(async () => {
    await applyMigrations(env.DB);

    // Seed User
    await env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userId, 'sub-workflow-test', 'wf@example.com', 'Workflow User', null)
      .run();

    const enc = await encryptSecret('refresh-workflow-test', env.TOKEN_ENCRYPTION_KEY, userId);
    await env.DB.prepare(
      `INSERT INTO google_credentials (user_id, ciphertext, iv, key_version)
       VALUES (?, ?, ?, ?)`
    )
      .bind(userId, enc.ciphertext, enc.iv, 1)
      .run();

    const tokenHash = await hashOpaqueToken(rawToken);
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`
    )
      .bind('sess-wf-test', userId, tokenHash, csrfToken)
      .run();
  });

  it('transfers remote file to Google Drive and transitions job to completed', async () => {
    const jobId = 'job-wf-remote-1';
    const encUrl = await encryptSecret('https://example.com/small.iso', env.TOKEN_ENCRYPTION_KEY, userId);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO upload_jobs (
           id, user_id, source_kind, source_url_redacted, source_url_encrypted, source_url_iv,
           filename, file_size, mime_type, status, version
         )
         VALUES (?, ?, 'remote', 'https://example.com/small.iso', ?, ?, 'small.iso', 1024, 'application/octet-stream', 'queued', 1)`
      ).bind(jobId, userId, encUrl.ciphertext, encUrl.iv),
      env.DB.prepare(
        `INSERT INTO upload_attempts
           (id, job_id, user_id, attempt_number, status)
         VALUES (?, ?, ?, 1, 'queued')`
      )
        .bind(`${jobId}-1`, jobId, userId),
    ]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      // Google Token Refresh
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({ access_token: 'mock-wf-access-token', expires_in: 3600 }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Remote file source
      if (urlStr === 'https://example.com/small.iso') {
        const dummyBytes = new Uint8Array(1024);
        return new Response(dummyBytes, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': '1024',
          },
        });
      }

      // Google Resumable Session Upload & Status Query (must check upload_id first)
      if (urlStr.includes('upload_id=mock-resumable-session-123')) {
        const headers = new Headers(init?.headers);
        const cr = headers.get('Content-Range');

        if (cr && cr.startsWith('bytes */')) {
          // Resumable offset query
          return new Response(null, {
            status: 308,
            headers: { Range: 'bytes=0--1' },
          });
        }

        // Chunk upload completion
        return new Response(
          JSON.stringify({
            id: 'drive-file-wf-success',
            name: 'small.iso',
            webViewLink: 'https://drive.google.com/file/d/drive-file-wf-success/view',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Google Resumable Upload Initiation (POST without upload_id)
      if (urlStr.includes('googleapis.com/upload/drive/v3/files?uploadType=resumable')) {
        return new Response(null, {
          status: 200,
          headers: {
            Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=mock-resumable-session-123',
          },
        });
      }

      return originalFetch(input, init);
    });

    try {
      const mockStep = {
        do: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
      };

      await runDriveTransfer(env, { jobId, userId }, mockStep);

      // Verify job is marked completed in D1
      const job = await env.DB.prepare('SELECT * FROM upload_jobs WHERE id = ?')
        .bind(jobId)
        .first<{
          status: string;
          drive_file_id: string;
          drive_file_link: string;
          progress_bytes: number;
        }>();

      expect(job?.status).toBe('completed');
      expect(job?.drive_file_id).toBe('drive-file-wf-success');
      expect(job?.drive_file_link).toContain('drive-file-wf-success');
      expect(job?.progress_bytes).toBe(1024);

      const attempt = await env.DB.prepare(
        'SELECT status, bytes_transferred FROM upload_attempts WHERE job_id = ?'
      ).bind(jobId).first<{ status: string; bytes_transferred: number }>();

      expect(attempt).toEqual({ status: 'completed', bytes_transferred: 1024 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('derives the size from Content-Range when the source omits Content-Length', async () => {
    const jobId = 'job-wf-ranged-size';
    const sourceUrl = 'https://example.com/get_zip_ngen_free/28748985/Release.zip';
    const totalSize = 2048;
    const encUrl = await encryptSecret(sourceUrl, env.TOKEN_ENCRYPTION_KEY, userId);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO upload_jobs (
           id, user_id, source_kind, source_url_redacted, source_url_encrypted,
           source_url_iv, filename, file_size, mime_type, status, version
         ) VALUES (?, ?, 'remote', ?, ?, ?, 'Release.zip', 0,
                   'application/octet-stream', 'queued', 1)`
      ).bind(jobId, userId, sourceUrl, encUrl.ciphertext, encUrl.iv),
      env.DB.prepare(
        `INSERT INTO upload_attempts
           (id, job_id, user_id, attempt_number, status)
         VALUES (?, ?, ?, 1, 'queued')`
      ).bind(`${jobId}-1`, jobId, userId),
    ]);

    const originalFetch = globalThis.fetch;
    const sourceRanges: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({ access_token: 'mock-wf-access-token', expires_in: 3600 }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (urlStr === sourceUrl) {
        // Seedr's generated zips answer HEAD with no Content-Length whatsoever.
        if (init?.method === 'HEAD') {
          return new Response(null, { status: 200, headers: { 'Accept-Ranges': 'bytes' } });
        }

        const range = new Headers(init?.headers).get('Range') || '';
        sourceRanges.push(range);

        if (range === 'bytes=0-0') {
          return new Response(new Uint8Array(1), {
            status: 206,
            headers: {
              'Content-Type': 'application/zip',
              'Content-Range': `bytes 0-0/${totalSize}`,
            },
          });
        }

        return new Response(new Uint8Array(totalSize), {
          status: 206,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Range': `bytes 0-${totalSize - 1}/${totalSize}`,
          },
        });
      }

      if (urlStr.includes('upload_id=mock-resumable-session-123')) {
        const cr = new Headers(init?.headers).get('Content-Range');
        if (cr && cr.startsWith('bytes */')) {
          return new Response(null, { status: 308, headers: { Range: 'bytes=0--1' } });
        }
        return new Response(
          JSON.stringify({
            id: 'drive-file-wf-ranged',
            name: 'Release.zip',
            webViewLink: 'https://drive.google.com/file/d/drive-file-wf-ranged/view',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (urlStr.includes('googleapis.com/upload/drive/v3/files?uploadType=resumable')) {
        return new Response(null, {
          status: 200,
          headers: {
            Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=mock-resumable-session-123',
          },
        });
      }

      return originalFetch(input, init);
    });

    try {
      const step = { do: async <T>(_name: string, fn: () => Promise<T>) => fn() };
      await runDriveTransfer(env, { jobId, userId }, step);

      const job = await env.DB.prepare(
        'SELECT status, file_size, mime_type, progress_bytes, drive_file_id FROM upload_jobs WHERE id = ?'
      ).bind(jobId).first<{
        status: string;
        file_size: number;
        mime_type: string;
        progress_bytes: number;
        drive_file_id: string;
      }>();

      expect(job).toEqual({
        status: 'completed',
        file_size: totalSize,
        mime_type: 'application/zip',
        progress_bytes: totalSize,
        drive_file_id: 'drive-file-wf-ranged',
      });

      // The single-byte probe is what recovered the total, so it must come first.
      expect(sourceRanges[0]).toBe('bytes=0-0');
      expect(sourceRanges[1]).toBe(`bytes=0-${totalSize - 1}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles cancellation gracefully before chunk upload', async () => {
    const jobId = 'job-wf-cancel-1';
    const encUrl = await encryptSecret('https://example.com/cancel.iso', env.TOKEN_ENCRYPTION_KEY, userId);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO upload_jobs (
           id, user_id, source_kind, source_url_redacted, source_url_encrypted, source_url_iv,
           filename, file_size, mime_type, status, version
         )
         VALUES (?, ?, 'remote', 'https://example.com/cancel.iso', ?, ?, 'cancel.iso', 1024, 'application/octet-stream', 'cancel_requested', 1)`
      ).bind(jobId, userId, encUrl.ciphertext, encUrl.iv),
      env.DB.prepare(
        `INSERT INTO upload_attempts
           (id, job_id, user_id, attempt_number, status)
         VALUES (?, ?, ?, 1, 'queued')`
      ).bind(`${jobId}-1`, jobId, userId),
    ]);

    const mockStep = {
      do: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
    };

    await runDriveTransfer(env, { jobId, userId }, mockStep);

    // Verify job transitioned to canceled
    const job = await env.DB.prepare('SELECT status FROM upload_jobs WHERE id = ?')
      .bind(jobId)
      .first<{ status: string }>();
    const attempt = await env.DB.prepare(
      'SELECT status, finished_at FROM upload_attempts WHERE job_id = ? AND attempt_number = 1'
    ).bind(jobId).first<{ status: string; finished_at: string | null }>();

    expect(job?.status).toBe('canceled');
    expect(attempt?.status).toBe('canceled');
    expect(attempt?.finished_at).not.toBeNull();
  });

  it('keeps job and attempt canceled when cancellation arrives during finalization', async () => {
    const jobId = 'job-wf-finalize-cancel';
    const encUrl = await encryptSecret('https://example.com/finalize-cancel.iso', env.TOKEN_ENCRYPTION_KEY, userId);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO upload_jobs (
           id, user_id, source_kind, source_url_redacted, source_url_encrypted, source_url_iv,
           filename, file_size, mime_type, status, version
         )
         VALUES (?, ?, 'remote', 'https://example.com/finalize-cancel.iso', ?, ?, 'finalize-cancel.iso', 1024, 'application/octet-stream', 'uploading', 1)`
      ).bind(jobId, userId, encUrl.ciphertext, encUrl.iv),
      env.DB.prepare(
        `INSERT INTO upload_attempts
           (id, job_id, user_id, attempt_number, status)
         VALUES (?, ?, ?, 1, 'uploading')`
      ).bind(`${jobId}-1`, jobId, userId),
    ]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({ access_token: 'mock-wf-access-token', expires_in: 3600 }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (urlStr === 'https://example.com/finalize-cancel.iso') {
        const dummyBytes = new Uint8Array(1024);
        return new Response(dummyBytes, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': '1024',
          },
        });
      }

      if (urlStr.includes('upload_id=mock-resumable-session-123')) {
        const headers = new Headers(init?.headers);
        const cr = headers.get('Content-Range');
        if (cr && cr.startsWith('bytes */')) {
          return new Response(null, {
            status: 308,
            headers: { Range: 'bytes=0--1' },
          });
        }
        return new Response(
          JSON.stringify({
            id: 'drive-file-wf-finalize-cancel',
            name: 'finalize-cancel.iso',
            webViewLink: 'https://drive.google.com/file/d/drive-file-wf-finalize-cancel/view',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (urlStr.includes('googleapis.com/upload/drive/v3/files?uploadType=resumable')) {
        return new Response(null, {
          status: 200,
          headers: {
            Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=mock-resumable-session-123',
          },
        });
      }

      return originalFetch(input, init);
    });

    try {
      const step = {
        do: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
          if (name === 'finalize-transfer') {
            await env.DB.prepare(
              `UPDATE upload_jobs
               SET status = 'cancel_requested', version = version + 1
               WHERE id = ?`
            ).bind(jobId).run();
          }
          return fn();
        },
      };

      await runDriveTransfer(env, { jobId, userId }, step);

      const job = await env.DB.prepare(
        'SELECT status, drive_file_id FROM upload_jobs WHERE id = ?'
      ).bind(jobId).first<{ status: string; drive_file_id: string | null }>();
      const attempt = await env.DB.prepare(
        'SELECT status, finished_at FROM upload_attempts WHERE job_id = ? AND attempt_number = 1'
      ).bind(jobId).first<{ status: string; finished_at: string | null }>();

      expect(job).toEqual({ status: 'canceled', drive_file_id: null });
      expect(attempt?.status).toBe('canceled');
      expect(attempt?.finished_at).not.toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not restart a failed job when a delayed workflow invocation arrives', async () => {
    const jobId = 'job-wf-already-failed';
    const encUrl = await encryptSecret(
      'https://example.com/already-failed.iso',
      env.TOKEN_ENCRYPTION_KEY,
      userId
    );

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO upload_jobs (
           id, user_id, source_kind, source_url_redacted, source_url_encrypted,
           source_url_iv, filename, file_size, mime_type, status, error_code, version
         ) VALUES (?, ?, 'remote', ?, ?, ?, 'already-failed.iso', 1024,
                   'application/octet-stream', 'failed', 'REMOTE_SIZE_UNKNOWN', 1)`
      ).bind(
        jobId,
        userId,
        'https://example.com/already-failed.iso',
        encUrl.ciphertext,
        encUrl.iv
      ),
      env.DB.prepare(
        `INSERT INTO upload_attempts
           (id, job_id, user_id, attempt_number, status, error_code)
         VALUES (?, ?, ?, 1, 'failed', 'REMOTE_SIZE_UNKNOWN')`
      ).bind(`${jobId}-1`, jobId, userId),
    ]);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const step = { do: async <T>(_name: string, fn: () => Promise<T>) => fn() };

    await runDriveTransfer(env, { jobId, userId }, step);

    const job = await env.DB.prepare(
      'SELECT status, error_code, version FROM upload_jobs WHERE id = ?'
    ).bind(jobId).first<{ status: string; error_code: string; version: number }>();

    expect(job).toEqual({ status: 'failed', error_code: 'REMOTE_SIZE_UNKNOWN', version: 1 });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('fails without creating a Drive file when remote size cannot be established', async () => {
    const jobId = 'job-wf-unknown-size';
    const sourceUrl = 'https://example.com/chunked.bin';
    const encUrl = await encryptSecret(sourceUrl, env.TOKEN_ENCRYPTION_KEY, userId);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO upload_jobs (
           id, user_id, source_kind, source_url_redacted, source_url_encrypted,
           source_url_iv, filename, file_size, mime_type, status, version
         ) VALUES (?, ?, 'remote', ?, ?, ?, 'chunked.bin', 0,
                   'application/octet-stream', 'queued', 1)`
      ).bind(jobId, userId, sourceUrl, encUrl.ciphertext, encUrl.iv),
      env.DB.prepare(
        `INSERT INTO upload_attempts
           (id, job_id, user_id, attempt_number, status)
         VALUES (?, ?, ?, 1, 'queued')`
      ).bind(`${jobId}-1`, jobId, userId),
    ]);

    const originalFetch = globalThis.fetch;
    const driveSessionRequests: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === sourceUrl && init?.method === 'HEAD') {
        return new Response(null, { status: 405 });
      }
      // Range probe: this server streams without ever declaring a length.
      if (url === sourceUrl) {
        return new Response(null, { status: 200 });
      }
      if (url.includes('googleapis.com/upload/drive/v3/files')) {
        driveSessionRequests.push(url);
      }
      return originalFetch(input, init);
    });

    try {
      const step = { do: async <T>(_name: string, fn: () => Promise<T>) => fn() };
      await expect(runDriveTransfer(env, { jobId, userId }, step)).rejects.toMatchObject({
        code: 'REMOTE_SIZE_UNKNOWN',
      });

      const job = await env.DB.prepare(
        'SELECT status, error_code, drive_file_id FROM upload_jobs WHERE id = ?'
      ).bind(jobId).first<{ status: string; error_code: string; drive_file_id: string | null }>();
      const attempt = await env.DB.prepare(
        'SELECT status, error_code FROM upload_attempts WHERE job_id = ?'
      ).bind(jobId).first<{ status: string; error_code: string }>();

      expect(job).toEqual({ status: 'failed', error_code: 'REMOTE_SIZE_UNKNOWN', drive_file_id: null });
      expect(attempt).toEqual({ status: 'failed', error_code: 'REMOTE_SIZE_UNKNOWN' });
      expect(driveSessionRequests).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each([null, '0', '-1', 'not-a-number'])(
    'fails without creating a Drive session for Content-Length %p',
    async (contentLength) => {
      const jobId = `job-wf-invalid-size-${String(contentLength).replace(/[^a-z0-9]/gi, '') || 'null'}`;
      const sourceUrl = 'https://example.com/invalid-size.bin';
      const encUrl = await encryptSecret(sourceUrl, env.TOKEN_ENCRYPTION_KEY, userId);

      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO upload_jobs (
             id, user_id, source_kind, source_url_redacted, source_url_encrypted,
             source_url_iv, filename, file_size, mime_type, status, version
           ) VALUES (?, ?, 'remote', ?, ?, ?, 'invalid-size.bin', 0,
                     'application/octet-stream', 'queued', 1)`
        ).bind(jobId, userId, sourceUrl, encUrl.ciphertext, encUrl.iv),
        env.DB.prepare(
          `INSERT INTO upload_attempts
             (id, job_id, user_id, attempt_number, status)
           VALUES (?, ?, ?, 1, 'queued')`
        ).bind(`${jobId}-1`, jobId, userId),
      ]);

      const originalFetch = globalThis.fetch;
      const driveSessionRequests: string[] = [];
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const headHeaders =
          contentLength === null ? undefined : { 'Content-Length': contentLength };

        if (url === sourceUrl && init?.method === 'HEAD') {
          return new Response(null, { status: 200, headers: headHeaders });
        }
        // Range probe: no Content-Range either, so the size stays unknown.
        if (url === sourceUrl) {
          return new Response(null, { status: 200, headers: headHeaders });
        }
        if (url.includes('googleapis.com/upload/drive/v3/files')) {
          driveSessionRequests.push(url);
        }
        return originalFetch(input, init);
      });

      try {
        const step = { do: async <T>(_name: string, fn: () => Promise<T>) => fn() };
        await expect(runDriveTransfer(env, { jobId, userId }, step)).rejects.toMatchObject({
          code: 'REMOTE_SIZE_UNKNOWN',
        });

        const job = await env.DB.prepare(
          'SELECT status FROM upload_jobs WHERE id = ?'
        ).bind(jobId).first<{ status: string }>();
        const attempt = await env.DB.prepare(
          'SELECT status FROM upload_attempts WHERE job_id = ?'
        ).bind(jobId).first<{ status: string }>();

        expect(Number.isFinite(Number(contentLength)) && Number(contentLength) > 0).toBe(false);
        expect(job?.status).toBe('failed');
        expect(attempt?.status).toBe('failed');
        expect(driveSessionRequests).toHaveLength(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});
