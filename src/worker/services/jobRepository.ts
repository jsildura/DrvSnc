import { Env } from '../env';
import { encryptSecret } from './crypto';
import { redactSourceUrl } from './remoteUrlPolicy';
import { deriveRemoteFilename } from './remoteFilename';
import { abortMultipartUpload } from './r2Multipart';
import {
  UploadJobView,
  CreateRemoteJobRequest,
  CreateLocalJobRequest,
  CreateBatchRequest,
  BatchView,
  BatchStatus,
  SourceKind,
  MAX_CONCURRENT_JOBS_PER_USER,
  MAX_DAILY_JOBS_PER_USER,
  MAX_BATCH_URLS,
} from '../../shared/contracts';
import { UploadJobStatus, isTerminalStatus, canTransition } from '../../shared/jobState';

export class JobError extends Error {
  code: string;
  status: number;
  retriable: boolean;

  constructor(code: string, message: string, status = 400, retriable = false) {
    super(message);
    this.name = 'JobError';
    this.code = code;
    this.status = status;
    this.retriable = retriable;
  }
}

export function redactUrl(urlStr: string): string {
  return redactSourceUrl(urlStr);
}

function deriveFilenameFromUrl(urlStr: string): string {
  return deriveRemoteFilename(urlStr);
}

export function normalizeJobRow(row: Record<string, unknown>): UploadJobView {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    batchId: row.batch_id ? String(row.batch_id) : null,
    sourceKind: String(row.source_kind) as SourceKind,
    sourceUrlRedacted: row.source_url_redacted ? String(row.source_url_redacted) : null,
    filename: String(row.filename),
    fileSize: Number(row.file_size || 0),
    mimeType: String(row.mime_type || 'application/octet-stream'),
    destinationFolderId: row.destination_folder_id ? String(row.destination_folder_id) : null,
    destinationFolderName: row.destination_folder_name ? String(row.destination_folder_name) : null,
    hlsDurationSeconds: row.hls_duration_seconds ? Number(row.hls_duration_seconds) : null,
    status: String(row.status) as UploadJobStatus,
    progressBytes: Number(row.progress_bytes || 0),
    attemptCount: Number(row.attempt_count || 1),
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    driveFileId: row.drive_file_id ? String(row.drive_file_id) : null,
    driveFileLink: row.drive_file_link ? String(row.drive_file_link) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    version: Number(row.version || 1),
  };
}

export function computeBatchView(
  batchRow: Record<string, unknown>,
  jobs: UploadJobView[]
): BatchView {
  const queuedCount = jobs.filter((j) => j.status === 'queued' || j.status === 'staging').length;
  const activeCount = jobs.filter(
    (j) => j.status === 'fetching' || j.status === 'uploading' || j.status === 'cancel_requested'
  ).length;
  const completedCount = jobs.filter((j) => j.status === 'completed').length;
  const failedCount = jobs.filter((j) => j.status === 'failed').length;
  const canceledCount = jobs.filter((j) => j.status === 'canceled').length;

  const progressBytes = jobs.reduce((sum, j) => sum + (j.progressBytes || 0), 0);
  const totalKnownBytes = jobs.reduce((sum, j) => sum + (j.fileSize || 0), 0);

  let status: BatchStatus;
  if (jobs.length === 0) {
    // A batch with no surviving children can never change again: its jobs were deleted
    // from history or reaped by cleanup, so there is nothing left to queue, run or retry.
    // Leaving it 'queued' (the old default when no branch matched) made a finished batch
    // render as a pending transfer — original file count, every counter at zero, and a
    // Cancel Batch button with nothing to cancel.
    status = 'completed';
  } else if (activeCount > 0) {
    status = 'running';
  } else if (queuedCount > 0) {
    status = 'queued';
  } else if (completedCount === jobs.length) {
    status = 'completed';
  } else if (canceledCount === jobs.length) {
    status = 'canceled';
  } else if (completedCount > 0) {
    status = 'partial';
  } else {
    status = 'failed';
  }

  return {
    id: String(batchRow.id),
    userId: String(batchRow.user_id),
    destinationFolderId: batchRow.destination_folder_id ? String(batchRow.destination_folder_id) : null,
    destinationFolderName: batchRow.destination_folder_name ? String(batchRow.destination_folder_name) : null,
    itemCount: Number(batchRow.item_count || jobs.length),
    queuedCount,
    activeCount,
    completedCount,
    failedCount,
    canceledCount,
    progressBytes,
    totalKnownBytes,
    status,
    createdAt: String(batchRow.created_at),
    updatedAt: String(batchRow.updated_at),
    version: Number(batchRow.version || 1),
    jobs,
  };
}

/**
 * Resolve an idempotency key to the job it already created, if any.
 *
 * `upload_jobs.id` *is* the key, so it is unique across the whole table rather than per user. Scoping
 * this lookup by `user_id` — as the create paths used to — hides a row another account owns: the
 * caller reads "no such job", inserts, and D1 raises a bare UNIQUE violation that surfaces as a 500.
 * For the staging paths it is worse, because the multipart upload opened just before the insert is
 * then left with no row to reference and nothing to abort it.
 */
export async function findJobForIdempotencyKey(
  env: Env,
  userId: string,
  idempotencyKey: string
): Promise<{ job: UploadJobView; r2UploadId: string | null } | null> {
  const row = await env.DB.prepare('SELECT * FROM upload_jobs WHERE id = ?')
    .bind(idempotencyKey)
    .first<Record<string, unknown>>();

  if (!row) return null;
  if (String(row.user_id) !== userId) {
    throw new JobError('CONFLICT', 'Idempotency key in use', 409);
  }

  return {
    job: normalizeJobRow(row),
    r2UploadId: row.r2_upload_id ? String(row.r2_upload_id) : null,
  };
}

/** Clamp a caller-supplied page size. A negative LIMIT is *unlimited* in SQLite, not empty. */
function clampPageLimit(limit: number | undefined): number {
  const parsed = Math.trunc(Number(limit));
  if (!Number.isFinite(parsed) || parsed < 1) return 20;
  return Math.min(parsed, 50);
}

export async function checkRateLimits(env: Env, userId: string, additionalSlots = 1): Promise<void> {
  // 1. Check daily job creation limit
  const dailyCountRow = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM upload_jobs
     WHERE user_id = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')`
  )
    .bind(userId)
    .first<{ count: number }>();

  const currentDaily = Number(dailyCountRow?.count || 0);
  if (currentDaily + additionalSlots > MAX_DAILY_JOBS_PER_USER) {
    throw new JobError('DAILY_LIMIT_EXCEEDED', `Daily upload job limit reached (100 jobs per 24 hours). Requested: ${additionalSlots}, Available: ${Math.max(0, MAX_DAILY_JOBS_PER_USER - currentDaily)}`, 429);
  }

  // 2. Check concurrent active jobs limit
  const activeCountRow = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM upload_jobs
     WHERE user_id = ? AND status IN ('staging', 'queued', 'fetching', 'uploading', 'cancel_requested')`
  )
    .bind(userId)
    .first<{ count: number }>();

  const currentActive = Number(activeCountRow?.count || 0);
  if (currentActive + additionalSlots > MAX_CONCURRENT_JOBS_PER_USER) {
    throw new JobError('CONCURRENT_LIMIT_EXCEEDED', `Concurrent active job limit reached (25 active jobs). Requested: ${additionalSlots}, Available: ${Math.max(0, MAX_CONCURRENT_JOBS_PER_USER - currentActive)}`, 429);
  }
}

export async function createRemoteJob(
  env: Env,
  userId: string,
  idempotencyKey: string,
  data: CreateRemoteJobRequest
): Promise<{ job: UploadJobView; isExisting: boolean }> {
  // Check if idempotency key already exists for user
  const existing = await findJobForIdempotencyKey(env, userId, idempotencyKey);

  if (existing) {
    return { job: existing.job, isExisting: true };
  }

  await checkRateLimits(env, userId);

  const redacted = redactUrl(data.url);
  const encrypted = await encryptSecret(data.url, env.TOKEN_ENCRYPTION_KEY, userId);
  const filename = data.filename || deriveFilenameFromUrl(data.url);
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO upload_jobs (
       id, user_id, source_kind, source_url_redacted, source_url_encrypted, source_url_iv,
       filename, file_size, mime_type, destination_folder_id, hls_duration_seconds, status,
       progress_bytes, attempt_count, version, created_at, updated_at
     )
     VALUES (?, ?, 'remote', ?, ?, ?, ?, 0, 'application/octet-stream', ?, ?, 'queued', 0, 1, 1, ?, ?)`
  )
    .bind(
      idempotencyKey,
      userId,
      redacted,
      encrypted.ciphertext,
      encrypted.iv,
      filename,
      data.folderId || null,
      data.hlsDurationSeconds || null,
      now,
      now
    )
    .run();

  // Create initial upload_attempts row
  await env.DB.prepare(
    `INSERT INTO upload_attempts (id, job_id, user_id, attempt_number, status, started_at)
     VALUES (?, ?, ?, 1, 'queued', ?)`
  )
    .bind(`${idempotencyKey}-1`, idempotencyKey, userId, now)
    .run();

  // Trigger DriveTransferWorkflow
  if (env.DRIVE_TRANSFER) {
    try {
      await env.DRIVE_TRANSFER.create({
        id: idempotencyKey,
        params: { jobId: idempotencyKey, userId },
      });
    } catch (_err) {
      // Workflow started asynchronously
    }
  }

  const createdRow = await env.DB.prepare('SELECT * FROM upload_jobs WHERE id = ?')
    .bind(idempotencyKey)
    .first<Record<string, unknown>>();

  return { job: normalizeJobRow(createdRow!), isExisting: false };
}

export async function createLocalJob(
  env: Env,
  userId: string,
  idempotencyKey: string,
  data: CreateLocalJobRequest,
  r2ObjectKey: string,
  r2UploadId?: string,
  /**
   * Set only for a browser-relayed remote source. It doubles as the marker that tells the UI a
   * `local` job came off a URL rather than a picked file — the token-bearing original never reaches
   * the worker, so this redacted form is all there is to record.
   */
  sourceUrlRedacted?: string
): Promise<{ job: UploadJobView; isExisting: boolean }> {
  const existing = await findJobForIdempotencyKey(env, userId, idempotencyKey);

  if (existing) {
    return { job: existing.job, isExisting: true };
  }

  await checkRateLimits(env, userId);
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO upload_jobs (
       id, user_id, source_kind, source_url_redacted, r2_object_key, r2_upload_id,
       filename, file_size, mime_type, destination_folder_id, status, progress_bytes,
       attempt_count, version, created_at, updated_at
     )
     VALUES (?, ?, 'local', ?, ?, ?, ?, ?, ?, ?, 'staging', 0, 1, 1, ?, ?)`
  )
    .bind(
      idempotencyKey,
      userId,
      sourceUrlRedacted || null,
      r2ObjectKey,
      r2UploadId || null,
      data.filename,
      data.fileSize,
      data.mimeType,
      data.folderId || null,
      now,
      now
    )
    .run();

  const createdRow = await env.DB.prepare('SELECT * FROM upload_jobs WHERE id = ?')
    .bind(idempotencyKey)
    .first<Record<string, unknown>>();

  return { job: normalizeJobRow(createdRow!), isExisting: false };
}

export async function getJob(
  env: Env,
  userId: string,
  jobId: string
): Promise<UploadJobView | null> {
  const row = await env.DB.prepare('SELECT * FROM upload_jobs WHERE id = ? AND user_id = ?')
    .bind(jobId, userId)
    .first<Record<string, unknown>>();

  return row ? normalizeJobRow(row) : null;
}

export async function listJobs(
  env: Env,
  userId: string,
  options?: {
    active?: boolean;
    status?: string;
    since?: string;
    cursor?: string;
    limit?: number;
  }
): Promise<{ jobs: UploadJobView[]; nextCursor: string | null; maxUpdatedAt: string | null }> {
  const limit = clampPageLimit(options?.limit);
  const conditions: string[] = ['user_id = ?'];
  const params: (string | number)[] = [userId];

  if (options?.active === true) {
    conditions.push("status IN ('staging', 'queued', 'fetching', 'uploading', 'cancel_requested')");
  } else if (options?.active === false) {
    conditions.push("status IN ('completed', 'failed', 'canceled')");
  }

  if (options?.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }

  if (options?.since) {
    conditions.push('updated_at > ?');
    params.push(options.since);
  }

  if (options?.cursor) {
    conditions.push('created_at < ?');
    params.push(options.cursor);
  }

  const query = `
    SELECT * FROM upload_jobs
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT ?
  `;
  params.push(limit + 1);

  const res = await env.DB.prepare(query).bind(...params).all<Record<string, unknown>>();
  const rows = res.results || [];

  let nextCursor: string | null = null;
  if (rows.length > limit) {
    const lastItem = rows[limit - 1];
    nextCursor = String(lastItem.created_at);
    rows.pop();
  }

  let maxUpdatedAt: string | null = null;
  for (const r of rows) {
    const uAt = String(r.updated_at);
    if (!maxUpdatedAt || uAt > maxUpdatedAt) {
      maxUpdatedAt = uAt;
    }
  }

  return {
    jobs: rows.map(normalizeJobRow),
    nextCursor,
    maxUpdatedAt,
  };
}

export async function requestCancel(
  env: Env,
  userId: string,
  jobId: string
): Promise<UploadJobView> {
  const row = await env.DB.prepare('SELECT * FROM upload_jobs WHERE id = ? AND user_id = ?')
    .bind(jobId, userId)
    .first<Record<string, unknown>>();

  if (!row) {
    throw new JobError('NOT_FOUND', 'Upload job not found', 404);
  }

  const currentStatus = String(row.status) as UploadJobStatus;
  if (isTerminalStatus(currentStatus)) {
    return normalizeJobRow(row);
  }

  const targetStatus: UploadJobStatus =
    currentStatus === 'staging' ? 'canceled' : 'cancel_requested';

  if (!canTransition(currentStatus, targetStatus)) {
    return normalizeJobRow(row);
  }

  const now = new Date().toISOString();
  const updateRes = await env.DB.prepare(
    `UPDATE upload_jobs
     SET status = ?, updated_at = ?, version = version + 1
     WHERE id = ? AND user_id = ? AND version = ?
     RETURNING *`
  )
    .bind(targetStatus, now, jobId, userId, Number(row.version))
    .first<Record<string, unknown>>();

  if (targetStatus === 'canceled') {
    await env.DB.prepare(
      `UPDATE upload_attempts
       SET status = 'canceled', finished_at = ?
       WHERE job_id = ? AND status != 'completed'`
    )
      .bind(now, jobId)
      .run();

    // A canceled staging job leaves a multipart upload half-written. R2 keeps those parts billable
    // until the upload is explicitly abandoned, and a browser relay hits this path routinely — the
    // source can refuse the fetch or the tab can close mid-stream.
    const uploadId = row.r2_upload_id ? String(row.r2_upload_id) : null;
    const objectKey = row.r2_object_key ? String(row.r2_object_key) : null;
    if (uploadId && objectKey) {
      await abortMultipartUpload(env, objectKey, uploadId);
    }
  }

  return normalizeJobRow(updateRes || row);
}

export async function retryJob(
  env: Env,
  userId: string,
  jobId: string
): Promise<UploadJobView> {
  const row = await env.DB.prepare('SELECT * FROM upload_jobs WHERE id = ? AND user_id = ?')
    .bind(jobId, userId)
    .first<Record<string, unknown>>();

  if (!row) {
    throw new JobError('NOT_FOUND', 'Upload job not found', 404);
  }

  const currentStatus = String(row.status) as UploadJobStatus;
  if (currentStatus !== 'failed' && currentStatus !== 'canceled') {
    throw new JobError('INVALID_JOB_STATE', 'Only failed or canceled jobs can be retried', 400);
  }

  await checkRateLimits(env, userId);

  const nextAttempt = Number(row.attempt_count || 1) + 1;
  const now = new Date().toISOString();

  const updateRes = await env.DB.prepare(
    `UPDATE upload_jobs
     SET status = 'queued', attempt_count = ?, error_code = NULL, error_message = NULL,
         progress_bytes = 0, updated_at = ?, version = version + 1
     WHERE id = ? AND user_id = ? AND version = ?
     RETURNING *`
  )
    .bind(nextAttempt, now, jobId, userId, Number(row.version))
    .first<Record<string, unknown>>();

  await env.DB.prepare(
    `INSERT INTO upload_attempts (id, job_id, user_id, attempt_number, status, started_at)
     VALUES (?, ?, ?, ?, 'queued', ?)`
  )
    .bind(`${jobId}-${nextAttempt}`, jobId, userId, nextAttempt, now)
    .run();

  if (env.DRIVE_TRANSFER) {
    try {
      await env.DRIVE_TRANSFER.create({
        id: `${jobId}-attempt-${nextAttempt}`,
        params: { jobId, userId, attemptNumber: nextAttempt },
      });
    } catch (_err) {
      // Async trigger
    }
  }

  return normalizeJobRow(updateRes || row);
}

export async function deleteJobHistory(
  env: Env,
  userId: string,
  jobId: string
): Promise<void> {
  const row = await env.DB.prepare('SELECT * FROM upload_jobs WHERE id = ? AND user_id = ?')
    .bind(jobId, userId)
    .first<Record<string, unknown>>();

  if (!row) {
    throw new JobError('NOT_FOUND', 'Upload job not found', 404);
  }

  const currentStatus = String(row.status) as UploadJobStatus;
  if (!isTerminalStatus(currentStatus)) {
    throw new JobError('ACTIVE_JOB_NOT_DELETABLE', 'Active jobs cannot be deleted from history; cancel first', 400);
  }

  const batchId = row.batch_id ? String(row.batch_id) : null;

  if (!batchId) {
    await env.DB.prepare('DELETE FROM upload_jobs WHERE id = ? AND user_id = ?')
      .bind(jobId, userId)
      .run();
    return;
  }

  // A batch is only ever a view over its surviving children, so removing one from history
  // has to update the parent row in the same transaction. Without this the batch keeps its
  // original item_count while every derived counter drops to zero, and the card reads
  // "Batch Transfer (5 files) / 0 completed / 0%" forever — a finished batch that looks
  // like it is about to start over, and that nothing can clear.
  //
  // Statement order carries the logic: the DELETE only matches once the last child is
  // gone, in which case the UPDATE then matches nothing. While children remain it is the
  // DELETE that no-ops and the UPDATE that trues up item_count to what is actually left.
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM upload_jobs WHERE id = ? AND user_id = ?').bind(jobId, userId),
    env.DB.prepare(
      `DELETE FROM upload_batches
       WHERE id = ? AND user_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM upload_jobs WHERE upload_jobs.batch_id = upload_batches.id
         )`
    ).bind(batchId, userId),
    env.DB.prepare(
      `UPDATE upload_batches
       SET item_count = (
             SELECT COUNT(*) FROM upload_jobs WHERE upload_jobs.batch_id = upload_batches.id
           ),
           updated_at = ?,
           version = version + 1
       WHERE id = ? AND user_id = ?`
    ).bind(now, batchId, userId),
  ]);
}

async function getBatchById(
  env: Env,
  batchId: string
): Promise<{ batchRow: Record<string, unknown>; jobs: UploadJobView[] } | null> {
  const batchRow = await env.DB.prepare(
    'SELECT * FROM upload_batches WHERE id = ?'
  ).bind(batchId).first<Record<string, unknown>>();
  if (!batchRow) return null;

  const result = await env.DB.prepare(
    'SELECT * FROM upload_jobs WHERE batch_id = ? ORDER BY rowid ASC'
  ).bind(batchId).all<Record<string, unknown>>();
  return {
    batchRow,
    jobs: (result.results || []).map(normalizeJobRow),
  };
}

export async function createBatch(
  env: Env,
  userId: string,
  idempotencyKey: string,
  data: CreateBatchRequest,
  destinationFolderName?: string | null
): Promise<{ batch: BatchView; jobs: UploadJobView[]; isExisting: boolean }> {
  // Check if batch idempotencyKey exists
  const existingData = await getBatchById(env, idempotencyKey);

  if (existingData) {
    if (String(existingData.batchRow.user_id) !== userId) {
      throw new JobError('CONFLICT', 'Idempotency key in use', 409);
    }
    const batch = computeBatchView(existingData.batchRow, existingData.jobs);
    return { batch, jobs: existingData.jobs, isExisting: true };
  }

  const items = data.items;
  if (!items || items.length === 0) {
    throw new JobError('INVALID_REQUEST', 'Batch must contain at least 1 item', 400);
  }
  if (items.length > MAX_BATCH_URLS) {
    throw new JobError('BATCH_SIZE_EXCEEDED', `Batch cannot exceed ${MAX_BATCH_URLS} items`, 400);
  }

  // Atomic rate limit check for the whole batch
  await checkRateLimits(env, userId, items.length);

  const now = new Date().toISOString();

  // Prepare all encrypted secrets and statements for D1 batch
  const preparedJobs: Array<{
    jobId: string;
    filename: string;
    redactedUrl: string;
    encryptedCiphertext: string;
    encryptedIv: string;
  }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const jobId = `${idempotencyKey}-${i + 1}`;
    const filename = item.filename || deriveFilenameFromUrl(item.url);
    const redacted = redactUrl(item.url);
    const encrypted = await encryptSecret(item.url, env.TOKEN_ENCRYPTION_KEY, userId);

    preparedJobs.push({
      jobId,
      filename,
      redactedUrl: redacted,
      encryptedCiphertext: encrypted.ciphertext,
      encryptedIv: encrypted.iv,
    });
  }

  const statements: D1PreparedStatement[] = [];

  // 1. Insert upload_batches row with atomic rate limit admission predicate
  statements.push(
    env.DB.prepare(
      `INSERT INTO upload_batches (
         id, user_id, destination_folder_id, destination_folder_name, item_count, version, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, ?, 1, ?, ?
       WHERE (
         SELECT COUNT(*) FROM upload_jobs
         WHERE user_id = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')
       ) + ? <= ?
       AND (
         SELECT COUNT(*) FROM upload_jobs
         WHERE user_id = ? AND status IN ('staging', 'queued', 'fetching', 'uploading', 'cancel_requested')
       ) + ? <= ?`
    ).bind(
      idempotencyKey,
      userId,
      data.folderId || null,
      destinationFolderName || null,
      items.length,
      now,
      now,
      userId,
      items.length,
      MAX_DAILY_JOBS_PER_USER,
      userId,
      items.length,
      MAX_CONCURRENT_JOBS_PER_USER
    )
  );

  // 2. Insert all child jobs and initial attempts guarded by batch existence
  for (const p of preparedJobs) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO upload_jobs (
           id, user_id, batch_id, source_kind, source_url_redacted, source_url_encrypted, source_url_iv,
           filename, file_size, mime_type, destination_folder_id, destination_folder_name,
           status, progress_bytes, attempt_count, version, created_at, updated_at
         )
         SELECT ?, ?, ?, 'remote', ?, ?, ?, ?, 0, 'application/octet-stream', ?, ?, 'queued', 0, 1, 1, ?, ?
         WHERE EXISTS (SELECT 1 FROM upload_batches WHERE id = ?)`
      ).bind(
        p.jobId,
        userId,
        idempotencyKey,
        p.redactedUrl,
        p.encryptedCiphertext,
        p.encryptedIv,
        p.filename,
        data.folderId || null,
        destinationFolderName || null,
        now,
        now,
        idempotencyKey
      )
    );

    statements.push(
      env.DB.prepare(
        `INSERT INTO upload_attempts (id, job_id, user_id, attempt_number, status, started_at)
         SELECT ?, ?, ?, 1, 'queued', ?
         WHERE EXISTS (SELECT 1 FROM upload_jobs WHERE id = ?)`
      ).bind(`${p.jobId}-1`, p.jobId, userId, now, p.jobId)
    );
  }

  // Execute D1 atomic batch
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const existing = await getBatchById(env, idempotencyKey);
    if (!existing) throw error;
    if (String(existing.batchRow.user_id) !== userId) {
      throw new JobError('CONFLICT', 'Idempotency key in use', 409);
    }
    return {
      batch: computeBatchView(existing.batchRow, existing.jobs),
      jobs: existing.jobs,
      isExisting: true,
    };
  }

  // Fetch created batch row to verify atomic admission succeeded
  const createdBatchRow = await env.DB.prepare('SELECT * FROM upload_batches WHERE id = ?')
    .bind(idempotencyKey)
    .first<Record<string, unknown>>();

  if (!createdBatchRow) {
    const dailyCountRow = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM upload_jobs
       WHERE user_id = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')`
    )
      .bind(userId)
      .first<{ count: number }>();

    const currentDaily = Number(dailyCountRow?.count || 0);
    if (currentDaily + items.length > MAX_DAILY_JOBS_PER_USER) {
      throw new JobError(
        'DAILY_LIMIT_EXCEEDED',
        'Daily upload job limit reached during atomic batch admission',
        429
      );
    }

    throw new JobError(
      'CONCURRENT_LIMIT_EXCEEDED',
      'Concurrent active job limit reached during atomic batch admission',
      429
    );
  }

  // Trigger individual Cloudflare Workflows for all child jobs in parallel
  if (env.DRIVE_TRANSFER) {
    for (const p of preparedJobs) {
      try {
        await env.DRIVE_TRANSFER.create({
          id: p.jobId,
          params: { jobId: p.jobId, userId },
        });
      } catch (dispatchErr) {
        const errMsg = (dispatchErr as Error).message || 'Failed to dispatch Drive transfer workflow';
        const nowFail = new Date().toISOString();
        try {
          await env.DB.prepare(
            `UPDATE upload_jobs
             SET status = 'failed', error_code = 'WORKFLOW_DISPATCH_FAILED', error_message = ?, updated_at = ?, version = version + 1
             WHERE id = ?`
          )
            .bind(errMsg, nowFail, p.jobId)
            .run();

          await env.DB.prepare(
            `UPDATE upload_attempts
             SET status = 'failed', error_code = 'WORKFLOW_DISPATCH_FAILED', error_message = ?, finished_at = ?
             WHERE job_id = ?`
          )
            .bind(errMsg, nowFail, p.jobId)
            .run();
        } catch {
          // Ignore secondary DB error
        }
      }
    }
  }

  const childJobsRes = await env.DB.prepare(
    'SELECT * FROM upload_jobs WHERE batch_id = ? AND user_id = ? ORDER BY rowid ASC'
  )
    .bind(idempotencyKey, userId)
    .all<Record<string, unknown>>();

  const jobs = (childJobsRes.results || []).map(normalizeJobRow);
  const batch = computeBatchView(createdBatchRow!, jobs);

  return { batch, jobs, isExisting: false };
}

export async function getBatch(
  env: Env,
  userId: string,
  batchId: string
): Promise<{ batch: BatchView; jobs: UploadJobView[] } | null> {
  const batchRow = await env.DB.prepare('SELECT * FROM upload_batches WHERE id = ? AND user_id = ?')
    .bind(batchId, userId)
    .first<Record<string, unknown>>();

  if (!batchRow) {
    return null;
  }

  const childJobsRes = await env.DB.prepare(
    'SELECT * FROM upload_jobs WHERE batch_id = ? AND user_id = ? ORDER BY rowid ASC'
  )
    .bind(batchId, userId)
    .all<Record<string, unknown>>();

  const jobs = (childJobsRes.results || []).map(normalizeJobRow);
  // An emptied batch row is garbage awaiting the cleanup sweep, not something the user can
  // act on — there is nothing to show, cancel or retry. Treating it as absent keeps this
  // consistent with listBatches and turns a silent no-op cancel into an honest 404.
  if (jobs.length === 0) {
    return null;
  }

  const batch = computeBatchView(batchRow, jobs);
  return { batch, jobs };
}

export async function listBatches(
  env: Env,
  userId: string,
  options?: { limit?: number; cursor?: string }
): Promise<{ batches: BatchView[]; nextCursor: string | null }> {
  const limit = clampPageLimit(options?.limit);
  const conditions = ['user_id = ?'];
  const params: (string | number)[] = [userId];

  if (options?.cursor) {
    conditions.push('created_at < ?');
    params.push(options.cursor);
  }

  const query = `
    SELECT * FROM upload_batches
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT ?
  `;
  params.push(limit + 1);

  const res = await env.DB.prepare(query).bind(...params).all<Record<string, unknown>>();
  const batchRows = res.results || [];

  let nextCursor: string | null = null;
  if (batchRows.length > limit) {
    const lastItem = batchRows[limit - 1];
    nextCursor = String(lastItem.created_at);
    batchRows.pop();
  }

  const batches: BatchView[] = [];
  for (const bRow of batchRows) {
    const childJobsRes = await env.DB.prepare(
      'SELECT * FROM upload_jobs WHERE batch_id = ? AND user_id = ? ORDER BY rowid ASC'
    )
      .bind(String(bRow.id), userId)
      .all<Record<string, unknown>>();

    const jobs = (childJobsRes.results || []).map(normalizeJobRow);
    // Skip batches whose children have all been deleted from history. The row survives
    // until the scheduled cleanup reclaims it, but a card for it would be a header over an
    // empty progress bar, so it is not part of the user's batch list.
    if (jobs.length === 0) continue;
    batches.push(computeBatchView(bRow, jobs));
  }

  return { batches, nextCursor };
}

export async function requestCancelBatch(
  env: Env,
  userId: string,
  batchId: string
): Promise<{ batch: BatchView; jobs: UploadJobView[] }> {
  const batchData = await getBatch(env, userId, batchId);
  if (!batchData) {
    throw new JobError('NOT_FOUND', 'Upload batch not found', 404);
  }

  const updatedJobs: UploadJobView[] = [];
  for (const job of batchData.jobs) {
    if (!isTerminalStatus(job.status)) {
      const canceled = await requestCancel(env, userId, job.id);
      updatedJobs.push(canceled);
    } else {
      updatedJobs.push(job);
    }
  }

  const updatedBatch = computeBatchView(
    await env.DB.prepare('SELECT * FROM upload_batches WHERE id = ?').bind(batchId).first<Record<string, unknown>>() || {},
    updatedJobs
  );

  return { batch: updatedBatch, jobs: updatedJobs };
}

export async function retryBatch(
  env: Env,
  userId: string,
  batchId: string
): Promise<{ batch: BatchView; jobs: UploadJobView[] }> {
  const batchData = await getBatch(env, userId, batchId);
  if (!batchData) {
    throw new JobError('NOT_FOUND', 'Upload batch not found', 404);
  }

  const retryableJobs = batchData.jobs.filter((j) => j.status === 'failed' || j.status === 'canceled');
  if (retryableJobs.length === 0) {
    return batchData;
  }

  const now = new Date().toISOString();
  const retryableIds = retryableJobs.map((j) => j.id);
  const retryableCount = retryableJobs.length;
  const idPlaceholders = retryableIds.map(() => '?').join(', ');
  const snapshotVersion = Number(batchData.batch.version || 1);
  const reservedVersion = snapshotVersion + 1;

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE upload_batches
       SET version = version + 1, updated_at = ?
       WHERE id = ? AND user_id = ? AND version = ?
         AND (
           SELECT COUNT(*) FROM upload_jobs
           WHERE batch_id = ? AND user_id = ?
             AND status IN ('failed', 'canceled')
             AND id IN (${idPlaceholders})
         ) = ?
         AND (
           SELECT COUNT(*) FROM upload_jobs
           WHERE user_id = ?
             AND status IN ('staging', 'queued', 'fetching', 'uploading', 'cancel_requested')
             AND id NOT IN (${idPlaceholders})
         ) + ? <= ?`
    ).bind(
      now,
      batchId,
      userId,
      snapshotVersion,
      batchId,
      userId,
      ...retryableIds,
      retryableCount,
      userId,
      ...retryableIds,
      retryableCount,
      MAX_CONCURRENT_JOBS_PER_USER
    ),
  ];

  for (const job of retryableJobs) {
    const nextAttempt = job.attemptCount + 1;
    statements.push(
      env.DB.prepare(
        `UPDATE upload_jobs
         SET status = 'queued',
             attempt_count = attempt_count + 1,
             error_code = NULL,
             error_message = NULL,
             progress_bytes = 0,
             updated_at = ?,
             version = version + 1
         WHERE id = ? AND user_id = ? AND version = ?
           AND status IN ('failed', 'canceled')
           AND EXISTS (
             SELECT 1 FROM upload_batches
             WHERE id = ? AND user_id = ? AND version = ?
           )`
      ).bind(now, job.id, userId, job.version, batchId, userId, reservedVersion),
      env.DB.prepare(
        `INSERT INTO upload_attempts
           (id, job_id, user_id, attempt_number, status, started_at)
         SELECT ?, id, user_id, attempt_count, 'queued', ?
         FROM upload_jobs
         WHERE id = ? AND user_id = ? AND status = 'queued' AND attempt_count = ?
         ON CONFLICT (id) DO NOTHING`
      ).bind(`${job.id}-${nextAttempt}`, now, job.id, userId, nextAttempt)
    );
  }

  await env.DB.batch(statements);

  // Re-read the batch to classify the outcome of the atomic admission
  const fresh = await getBatch(env, userId, batchId);
  if (!fresh) {
    throw new JobError('NOT_FOUND', 'Upload batch not found', 404);
  }

  const freshById = new Map(fresh.jobs.map((j) => [j.id, j]));
  const reservationAdvanced = Number(fresh.batch.version) === reservedVersion;

  const allSnapshotChildrenQueued = (expectedExactly: boolean): boolean =>
    retryableJobs.every((job) => {
      const child = freshById.get(job.id);
      if (!child || child.status !== 'queued') return false;
      return expectedExactly
        ? child.attemptCount === job.attemptCount + 1
        : child.attemptCount >= job.attemptCount + 1;
    });

  const anySnapshotChildChanged = retryableJobs.some((job) => {
    const child = freshById.get(job.id);
    return Boolean(child && child.status === 'queued' && child.attemptCount >= job.attemptCount + 1);
  });

  if (reservationAdvanced) {
    if (!allSnapshotChildrenQueued(true)) {
      throw new JobError(
        'RETRY_ATOMICITY_FAILED',
        'Batch retry could not be applied atomically',
        500
      );
    }
  } else if (allSnapshotChildrenQueued(false)) {
    // Another concurrent retry already queued the same snapshot children: successful no-op
    return fresh;
  } else if (anySnapshotChildChanged) {
    // Partial application despite the reservation failing indicates non-atomic guards
    throw new JobError(
      'RETRY_ATOMICITY_FAILED',
      'Batch retry could not be applied atomically',
      500
    );
  } else {
    // Capacity admission failed; no snapshot child changed
    throw new JobError(
      'CONCURRENT_LIMIT_EXCEEDED',
      'Concurrent active job limit reached for batch retry',
      429
    );
  }

  // Dispatch only the children changed by this invocation
  if (env.DRIVE_TRANSFER) {
    for (const job of retryableJobs) {
      const nextAttempt = job.attemptCount + 1;
      try {
        await env.DRIVE_TRANSFER.create({
          id: `${job.id}-attempt-${nextAttempt}`,
          params: { jobId: job.id, userId, attemptNumber: nextAttempt },
        });
      } catch (dispatchErr) {
        const errMsg = (dispatchErr as Error).message || 'Failed to dispatch Drive transfer workflow';
        const nowFail = new Date().toISOString();
        try {
          await env.DB.batch([
            env.DB.prepare(
              `UPDATE upload_jobs
               SET status = 'failed', error_code = 'WORKFLOW_DISPATCH_FAILED', error_message = ?, updated_at = ?, version = version + 1
               WHERE id = ? AND user_id = ? AND status = 'queued'`
            ).bind(errMsg, nowFail, job.id, userId),
            env.DB.prepare(
              `UPDATE upload_attempts
               SET status = 'failed', error_code = 'WORKFLOW_DISPATCH_FAILED', error_message = ?, finished_at = ?
               WHERE job_id = ? AND attempt_number = ? AND status = 'queued'`
            ).bind(errMsg, nowFail, job.id, nextAttempt),
          ]);
        } catch {
          // Ignore secondary DB error
        }
      }
    }
  }

  return fresh;
}
