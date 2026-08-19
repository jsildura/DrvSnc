import { Hono } from 'hono';
import { Env } from '../env';
import { requireSession, AuthenticatedSession } from '../middleware/session';
import { requireCsrf } from '../middleware/csrf';
import {
  AccountView,
  CreateRemoteJobSchema,
  CreateLocalJobSchema,
  CompleteLocalJobSchema,
  CreateBatchRequestSchema,
} from '../../shared/contracts';
import {
  createRemoteJob,
  createLocalJob,
  createBatch,
  getBatch,
  listBatches,
  requestCancelBatch,
  retryBatch,
  getJob,
  listJobs,
  requestCancel,
  retryJob,
  deleteJobHistory,
} from '../services/jobRepository';
import {
  calculatePartLayout,
  generateR2Key,
  initiateMultipartUpload,
  signPartUploadUrl,
  completeMultipartUpload,
} from '../services/r2Multipart';

import { validateRemoteUrl, redactSourceUrl } from '../services/remoteUrlPolicy';
import { getFolder } from '../services/driveClient';

interface ErrorLike {
  code?: string;
  message?: string;
  retriable?: boolean;
  status?: number;
}

const jobRoutes = new Hono<{
  Bindings: Env;
  Variables: {
    user?: AccountView;
    session?: AuthenticatedSession;
    requestId: string;
  };
}>();

jobRoutes.use('*', requireSession);

// POST /remote
jobRoutes.post('/remote', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const idempotencyKey = c.req.header('Idempotency-Key') || c.req.header('idempotency-key');

  if (!idempotencyKey) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Idempotency-Key header is required for creating upload jobs',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid JSON request body',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  const parsed = CreateRemoteJobSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: parsed.error.issues[0]?.message || 'Invalid remote upload parameters',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  const urlCheck = validateRemoteUrl(parsed.data.url);
  if (!urlCheck.valid) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: urlCheck.error || 'Remote URL violates security policy',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  // Validate destination folder if provided
  if (parsed.data.folderId) {
    try {
      await getFolder(c.env, user.id, parsed.data.folderId);
    } catch (err) {
      const e = err as ErrorLike;
      return c.json(
        {
          error: {
            code: e.code || 'INVALID_DESTINATION_FOLDER',
            message: e.message || 'Destination folder not found or permission denied',
            retriable: Boolean(e.retriable),
            requestId: c.get('requestId') || 'req-id',
          },
        },
        (e.status as 400 | 404 | 500) || 400
      );
    }
  }

  try {
    const { job, isExisting } = await createRemoteJob(
      c.env,
      user.id,
      idempotencyKey,
      {
        ...parsed.data,
        url: urlCheck.normalizedUrl!,
      }
    );
    return c.json(job, isExisting ? 200 : 201);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'JOB_CREATION_FAILED',
          message: e.message || 'Failed to create upload job',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 429 | 500) || 500
    );
  }
});

// POST /local
jobRoutes.post('/local', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const idempotencyKey = c.req.header('Idempotency-Key') || c.req.header('idempotency-key');

  if (!idempotencyKey) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Idempotency-Key header is required for creating local upload jobs',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid JSON request body',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  const parsed = CreateLocalJobSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: parsed.error.issues[0]?.message || 'Invalid local upload parameters',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  try {
    const { partSize, partCount } = calculatePartLayout(parsed.data.fileSize);
    const r2Key = generateR2Key(user.id, idempotencyKey, parsed.data.filename);
    const { uploadId } = await initiateMultipartUpload(c.env, r2Key, parsed.data.mimeType);

    const { job, isExisting } = await createLocalJob(
      c.env,
      user.id,
      idempotencyKey,
      parsed.data,
      r2Key,
      uploadId
    );

    return c.json(
      {
        job,
        partSize,
        partCount,
        uploadId,
      },
      isExisting ? 200 : 201
    );
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'LOCAL_JOB_CREATION_FAILED',
          message: e.message || 'Failed to create local upload job',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 429 | 500) || 500
    );
  }
});

// GET /:id/parts
jobRoutes.get('/:id/parts', async (c) => {
  const user = c.get('user')!;
  const jobId = c.req.param('id');
  const fromPart = Math.max(parseInt(c.req.query('from') || '1', 10), 1);
  const count = Math.min(Math.max(parseInt(c.req.query('count') || '10', 10), 1), 20);

  const row = await c.env.DB.prepare(
    'SELECT * FROM upload_jobs WHERE id = ? AND user_id = ?'
  )
    .bind(jobId, user.id)
    .first<{
      status: string;
      r2_object_key: string | null;
      r2_upload_id: string | null;
      file_size: number;
    }>();

  if (!row || row.status !== 'staging') {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Staging job not found or not in staging status',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      404
    );
  }

  const { partCount } = calculatePartLayout(row.file_size);
  const endPart = Math.min(fromPart + count - 1, partCount);
  const parts: { partNumber: number; url: string }[] = [];

  for (let p = fromPart; p <= endPart; p++) {
    const url = await signPartUploadUrl(
      c.env,
      row.r2_object_key || `staging/${user.id}/${jobId}`,
      row.r2_upload_id || 'mock-upload',
      p
    );
    parts.push({ partNumber: p, url });
  }

  return c.json({ parts });
});

// POST /:id/complete
jobRoutes.post('/:id/complete', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const jobId = c.req.param('id');

  const row = await c.env.DB.prepare(
    'SELECT * FROM upload_jobs WHERE id = ? AND user_id = ?'
  )
    .bind(jobId, user.id)
    .first<{
      status: string;
      r2_object_key: string | null;
      r2_upload_id: string | null;
      file_size: number;
      version: number;
    }>();

  if (!row || row.status !== 'staging') {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Staging job not found or not in staging status',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      404
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid JSON request body',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  const parsed = CompleteLocalJobSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid multipart completion parameters',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  try {
    await completeMultipartUpload(
      c.env,
      row.r2_object_key || `staging/${user.id}/${jobId}`,
      row.r2_upload_id || 'mock-upload',
      parsed.data.parts
    );

    const now = new Date().toISOString();
    const updated = await c.env.DB.prepare(
      `UPDATE upload_jobs
       SET status = 'queued', updated_at = ?, version = version + 1
       WHERE id = ? AND user_id = ? AND version = ?
       RETURNING *`
    )
      .bind(now, jobId, user.id, Number(row.version))
      .first<Record<string, unknown>>();

    // Another concurrent completion won the version race: do not create a
    // second attempt row (its id would collide) or dispatch a duplicate transfer.
    if (!updated) {
      return c.json(
        {
          error: {
            code: 'JOB_STATE_CONFLICT',
            message: 'Upload job changed state before completion could be recorded',
            retriable: false,
            requestId: c.get('requestId') || 'req-id',
          },
        },
        409
      );
    }

    // Create initial upload_attempts row
    await c.env.DB.prepare(
      `INSERT INTO upload_attempts (id, job_id, user_id, attempt_number, status, started_at)
       VALUES (?, ?, ?, 1, 'queued', ?)
       ON CONFLICT (id) DO NOTHING`
    )
      .bind(`${jobId}-1`, jobId, user.id, now)
      .run();

    // Trigger DriveTransferWorkflow
    if (c.env.DRIVE_TRANSFER) {
      try {
        await c.env.DRIVE_TRANSFER.create({
          id: jobId,
          params: { jobId, userId: user.id },
        });
      } catch (_err) {
        // Async trigger
      }
    }

    const job = await getJob(c.env, user.id, jobId);
    return c.json(job || updated);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'COMPLETION_FAILED',
          message: e.message || 'Failed to complete multipart upload',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 500) || 500
    );
  }
});

// GET /
jobRoutes.get('/', async (c) => {
  const user = c.get('user')!;
  const activeParam = c.req.query('active');
  const active = activeParam !== undefined ? activeParam === 'true' : undefined;
  const status = c.req.query('status');
  const since = c.req.query('since');
  const cursor = c.req.query('cursor');
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined;

  try {
    const result = await listJobs(c.env, user.id, {
      active,
      status,
      since,
      cursor,
      limit,
    });

    const etag = `W/"${result.maxUpdatedAt || '0'}-${result.jobs.length}"`;
    const ifNoneMatch = c.req.header('If-None-Match') || c.req.header('if-none-match');

    if (ifNoneMatch && ifNoneMatch === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }

    c.header('ETag', etag);
    return c.json({
      jobs: result.jobs,
      nextCursor: result.nextCursor,
    });
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'JOB_QUERY_FAILED',
          message: e.message || 'Failed to query jobs',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 500) || 500
    );
  }
});

// ==========================================
// BATCH UPLOAD ROUTES
// ==========================================

// POST /batch
jobRoutes.post('/batch', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const idempotencyKey = c.req.header('Idempotency-Key') || c.req.header('idempotency-key');

  if (!idempotencyKey) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Idempotency-Key header is required for creating upload batches',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid JSON request body',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  const parsed = CreateBatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: parsed.error.issues[0]?.message || 'Invalid batch upload parameters',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  // Validate destination folder if provided
  let destinationFolderName: string | null = null;
  if (parsed.data.folderId) {
    try {
      const folderItem = await getFolder(c.env, user.id, parsed.data.folderId);
      destinationFolderName = folderItem.name;
    } catch (err) {
      const e = err as ErrorLike;
      return c.json(
        {
          error: {
            code: e.code || 'INVALID_DESTINATION_FOLDER',
            message: e.message || 'Destination folder not found or permission denied',
            retriable: Boolean(e.retriable),
            requestId: c.get('requestId') || 'req-id',
          },
        },
        (e.status as 400 | 404 | 500) || 400
      );
    }
  }

  // Validate every URL with SSRF policy, normalize, and reject duplicates
  const seenNormalizedUrls = new Set<string>();
  const normalizedItems: typeof parsed.data.items = [];

  for (let i = 0; i < parsed.data.items.length; i++) {
    const item = parsed.data.items[i];
    const urlCheck = validateRemoteUrl(item.url);
    if (!urlCheck.valid) {
      return c.json(
        {
          error: {
            code: 'INVALID_REMOTE_URL',
            message: `Item ${i + 1} (${redactSourceUrl(item.url)}): ${urlCheck.error || 'Invalid remote URL'}`,
            retriable: false,
            requestId: c.get('requestId') || 'req-id',
          },
        },
        400
      );
    }

    const normalized = urlCheck.normalizedUrl!;
    if (seenNormalizedUrls.has(normalized)) {
      return c.json(
        {
          error: {
            code: 'DUPLICATE_BATCH_URL',
            message: `Item ${i + 1} is a duplicate URL (${redactSourceUrl(item.url)})`,
            retriable: false,
            requestId: c.get('requestId') || 'req-id',
          },
        },
        400
      );
    }

    seenNormalizedUrls.add(normalized);
    normalizedItems.push({
      ...item,
      url: normalized,
    });
  }

  try {
    const result = await createBatch(
      c.env,
      user.id,
      idempotencyKey,
      {
        ...parsed.data,
        items: normalizedItems,
      },
      destinationFolderName
    );

    return c.json(
      {
        batch: result.batch,
        jobs: result.jobs,
      },
      result.isExisting ? 200 : 201
    );
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'BATCH_CREATION_FAILED',
          message: e.message || 'Failed to create upload batch',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 403 | 404 | 409 | 429 | 500) || 500
    );
  }
});

// GET /batch
jobRoutes.get('/batch', async (c) => {
  const user = c.get('user')!;
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined;
  const cursor = c.req.query('cursor');

  try {
    const res = await listBatches(c.env, user.id, { limit, cursor });
    return c.json(res);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'BATCH_QUERY_FAILED',
          message: e.message || 'Failed to query batches',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 500) || 500
    );
  }
});

// GET /batch/:id
jobRoutes.get('/batch/:id', async (c) => {
  const user = c.get('user')!;
  const batchId = c.req.param('id');

  try {
    const batchData = await getBatch(c.env, user.id, batchId);
    if (!batchData) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Upload batch not found',
            retriable: false,
            requestId: c.get('requestId') || 'req-id',
          },
        },
        404
      );
    }
    return c.json(batchData);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'BATCH_QUERY_FAILED',
          message: e.message || 'Failed to query batch',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 500) || 500
    );
  }
});

// POST /batch/:id/cancel
jobRoutes.post('/batch/:id/cancel', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const batchId = c.req.param('id');

  try {
    const res = await requestCancelBatch(c.env, user.id, batchId);
    return c.json(res);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'CANCEL_FAILED',
          message: e.message || 'Failed to cancel batch',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 404 | 500) || 500
    );
  }
});

// POST /batch/:id/retry
jobRoutes.post('/batch/:id/retry', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const batchId = c.req.param('id');

  try {
    const res = await retryBatch(c.env, user.id, batchId);
    return c.json(res);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'RETRY_FAILED',
          message: e.message || 'Failed to retry batch',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 404 | 429 | 500) || 500
    );
  }
});

// GET /:id
jobRoutes.get('/:id', async (c) => {
  const user = c.get('user')!;
  const jobId = c.req.param('id');

  try {
    const job = await getJob(c.env, user.id, jobId);
    if (!job) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Upload job not found',
            retriable: false,
            requestId: c.get('requestId') || 'req-id',
          },
        },
        404
      );
    }
    return c.json(job);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'JOB_QUERY_FAILED',
          message: e.message || 'Failed to query job',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 500) || 500
    );
  }
});

// POST /:id/cancel
jobRoutes.post('/:id/cancel', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const jobId = c.req.param('id');

  try {
    const job = await requestCancel(c.env, user.id, jobId);
    return c.json(job);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'CANCEL_FAILED',
          message: e.message || 'Failed to cancel job',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 404 | 500) || 500
    );
  }
});

// POST /:id/retry
jobRoutes.post('/:id/retry', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const jobId = c.req.param('id');

  try {
    const job = await retryJob(c.env, user.id, jobId);
    return c.json(job);
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'RETRY_FAILED',
          message: e.message || 'Failed to retry job',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 404 | 429 | 500) || 500
    );
  }
});

// DELETE /:id
jobRoutes.delete('/:id', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const jobId = c.req.param('id');

  try {
    await deleteJobHistory(c.env, user.id, jobId);
    return c.json({ success: true });
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'DELETE_FAILED',
          message: e.message || 'Failed to delete job history',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 404 | 500) || 500
    );
  }
});

export { jobRoutes };
