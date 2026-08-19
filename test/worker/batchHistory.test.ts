import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from './testDb';
import { hashOpaqueToken } from '../../src/worker/services/crypto';
import {
  computeBatchView,
  deleteJobHistory,
  getBatch,
  listBatches,
  requestCancelBatch,
} from '../../src/worker/services/jobRepository';
import { BatchView } from '../../src/shared/contracts';

// A BatchView is derived from its surviving children on every read, so deleting a child job
// from transfer history changes what the parent batch means. These cover the fallout: a
// finished batch must clear rather than reappear as a pending transfer.
describe('Batch consistency when child jobs are deleted from history', () => {
  const userId = 'usr-batch-history';
  const httpUserId = 'usr-batch-history-http';
  const rawToken = 'raw-session-batch-history';
  const csrfToken = 'csrf-batch-history';
  const cookie = `gdu_session=${rawToken}; gdu_csrf=${csrfToken}`;

  async function seedBatch(
    ownerId: string,
    batchId: string,
    children: Array<{ id: string; status: string }>,
    itemCount = children.length
  ): Promise<void> {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO upload_batches (
         id, user_id, destination_folder_id, destination_folder_name, item_count, version, created_at, updated_at
       )
       VALUES (?, ?, NULL, 'Android Wallpaper', ?, 1, ?, ?)`
    )
      .bind(batchId, ownerId, itemCount, now, now)
      .run();

    for (const child of children) {
      const progress = child.status === 'completed' ? 2048 : 0;
      await env.DB.prepare(
        `INSERT INTO upload_jobs (
           id, user_id, batch_id, source_kind, source_url_redacted, filename,
           file_size, mime_type, status, progress_bytes, attempt_count, version
         )
         VALUES (?, ?, ?, 'remote', 'https://example.com/wallpaper.jpg', ?, 2048, 'image/jpeg', ?, ?, 1, 1)`
      )
        .bind(child.id, ownerId, batchId, `${child.id}.jpg`, child.status, progress)
        .run();
    }
  }

  beforeAll(async () => {
    await applyMigrations(env.DB);

    for (const [id, sub] of [
      [userId, 'sub-batch-history'],
      [httpUserId, 'sub-batch-history-http'],
    ]) {
      await env.DB.prepare(
        `INSERT INTO users (id, google_sub, email, name, picture)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(id, sub, `${id}@example.com`, 'Batch History', null)
        .run();
    }

    const tokenHash = await hashOpaqueToken(rawToken);
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))`
    )
      .bind('sess-batch-history', httpUserId, tokenHash, csrfToken)
      .run();
  });

  it('clears the parent batch when its last child is deleted from history', async () => {
    await seedBatch(userId, 'batch-last-child', [{ id: 'batch-last-child-1', status: 'completed' }]);

    await deleteJobHistory(env, userId, 'batch-last-child-1');

    const remaining = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM upload_batches WHERE id = ?'
    )
      .bind('batch-last-child')
      .first<{ count: number }>();
    expect(Number(remaining?.count)).toBe(0);

    expect(await getBatch(env, userId, 'batch-last-child')).toBeNull();

    const { batches } = await listBatches(env, userId, { limit: 50 });
    expect(batches.map((b) => b.id)).not.toContain('batch-last-child');
  });

  it('keeps a partly deleted batch and trues up its file count', async () => {
    await seedBatch(userId, 'batch-partial-delete', [
      { id: 'batch-partial-delete-1', status: 'completed' },
      { id: 'batch-partial-delete-2', status: 'completed' },
      { id: 'batch-partial-delete-3', status: 'completed' },
    ]);

    await deleteJobHistory(env, userId, 'batch-partial-delete-2');

    const result = await getBatch(env, userId, 'batch-partial-delete');
    expect(result).not.toBeNull();
    // The header reads "Batch Transfer ({itemCount} files)", so a stale item_count claims
    // files the batch no longer has and drags the progress percentage down with it.
    expect(result!.batch.itemCount).toBe(2);
    expect(result!.batch.completedCount).toBe(2);
    expect(result!.batch.status).toBe('completed');
    expect(result!.jobs.map((j) => j.id)).toEqual([
      'batch-partial-delete-1',
      'batch-partial-delete-3',
    ]);
    expect(result!.batch.version).toBe(2);
  });

  it('leaves a standalone job deletion untouched by the batch bookkeeping', async () => {
    await env.DB.prepare(
      `INSERT INTO upload_jobs (
         id, user_id, source_kind, source_url_redacted, filename,
         file_size, mime_type, status, progress_bytes, attempt_count, version
       )
       VALUES (?, ?, 'remote', 'https://example.com/solo.bin', 'solo.bin', 10, 'application/octet-stream', 'completed', 10, 1, 1)`
    )
      .bind('job-standalone-history', userId)
      .run();

    await deleteJobHistory(env, userId, 'job-standalone-history');

    const row = await env.DB.prepare('SELECT id FROM upload_jobs WHERE id = ?')
      .bind('job-standalone-history')
      .first();
    expect(row).toBeNull();
  });

  it('does not surface a batch row whose children are already gone', async () => {
    // Reproduces a database orphaned by the old delete path: the batch row still claims
    // five files but every child job has been removed.
    await seedBatch(userId, 'batch-orphaned', [], 5);

    const { batches } = await listBatches(env, userId, { limit: 50 });
    expect(batches.map((b) => b.id)).not.toContain('batch-orphaned');

    expect(await getBatch(env, userId, 'batch-orphaned')).toBeNull();

    // The old behaviour recomputed an identical 'queued' view and returned 200, which is
    // what made "Cancel Batch" look like a dead button.
    await expect(requestCancelBatch(env, userId, 'batch-orphaned')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('derives a terminal status for a batch with no surviving children', () => {
    const view = computeBatchView(
      {
        id: 'batch-empty-view',
        user_id: userId,
        item_count: 5,
        created_at: '2026-08-19T12:05:00.000Z',
        updated_at: '2026-08-19T12:05:00.000Z',
        version: 1,
      },
      []
    );

    expect(view.status).not.toBe('queued');
    expect(view.status).toBe('completed');
  });

  it('drops the batch card once the last file is cleared from history over HTTP', async () => {
    await seedBatch(httpUserId, 'batch-http-delete', [
      { id: 'batch-http-delete-1', status: 'completed' },
      { id: 'batch-http-delete-2', status: 'completed' },
    ]);

    const listBefore = await SELF.fetch('https://example.com/api/v1/jobs/batch', {
      headers: { Cookie: cookie },
    });
    expect(listBefore.status).toBe(200);
    const before = await listBefore.json<{ batches: BatchView[] }>();
    expect(before.batches).toHaveLength(1);
    expect(before.batches[0].itemCount).toBe(2);

    for (const jobId of ['batch-http-delete-1', 'batch-http-delete-2']) {
      const del = await SELF.fetch(`https://example.com/api/v1/jobs/${jobId}`, {
        method: 'DELETE',
        headers: {
          Cookie: cookie,
          'X-CSRF-Token': csrfToken,
          Origin: 'https://example.com',
        },
      });
      expect(del.status).toBe(200);
    }

    const listAfter = await SELF.fetch('https://example.com/api/v1/jobs/batch', {
      headers: { Cookie: cookie },
    });
    const after = await listAfter.json<{ batches: BatchView[] }>();
    expect(after.batches).toHaveLength(0);
  });
});
