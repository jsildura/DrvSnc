import { Hono } from 'hono';
import { Env } from '../env';
import { requireSession, AuthenticatedSession } from '../middleware/session';
import { requireCsrf } from '../middleware/csrf';
import {
  AccountView,
  CreateRemoteJobSchema,
  CreateLocalJobSchema,
  CreateRelayJobSchema,
  CompleteLocalJobSchema,
  CreateBatchRequestSchema,
  MAX_UPLOAD_SIZE_BYTES,
  isValidIdempotencyKey,
} from '../../shared/contracts';
import {
  createRemoteJob,
  createLocalJob,
  findJobForIdempotencyKey,
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
  MAX_PARTS,
  calculatePartLayout,
  generateR2Key,
  stagingFallbackKey,
  initiateMultipartUpload,
  signPartUploadUrl,
  completeMultipartUpload,
  abortMultipartUpload,
  deleteR2Object,
} from '../services/r2Multipart';
import { deriveRemoteFilename, guessMimeFromFilename } from '../services/remoteFilename';

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

/**
 * Read a bounded integer from the query string.
 *
 * `parseInt` answers NaN for anything unparseable, and NaN survives `Math.max`/`Math.min` untouched —
 * so `?from=abc` used to produce a loop that never ran and an empty, unexplained part list.
 */
function clampQueryInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

jobRoutes.use('*', requireSession);

// POST /remote
jobRoutes.post('/remote', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const idempotencyKey = c.req.header('Idempotency-Key') || c.req.header('idempotency-key');

  // Validated, not merely required: this value becomes the job id, part of the R2 staging key and the
  // Workflow instance id, so its shape is a boundary concern rather than a formality.
  if (!isValidIdempotencyKey(idempotencyKey)) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message:
            'Idempotency-Key header is required for creating upload jobs and must be 8-128 characters of A-Z, a-z, 0-9, hyphen or underscore',
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

  if (!isValidIdempotencyKey(idempotencyKey)) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message:
            'Idempotency-Key header is required for creating local upload jobs and must be 8-128 characters of A-Z, a-z, 0-9, hyphen or underscore',
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

    // Resolve the key before opening anything in R2. A retried create otherwise starts a second
    // multipart upload that no row references, and R2 bills abandoned parts until a lifecycle rule
    // reaps them. This is also where a key another account already owns turns into a 409 rather than
    // a UNIQUE violation from the insert below.
    const existing = await findJobForIdempotencyKey(c.env, user.id, idempotencyKey);
    if (existing) {
      return c.json(
        { job: existing.job, partSize, partCount, uploadId: existing.r2UploadId },
        200
      );
    }

    const r2Key = generateR2Key(user.id, idempotencyKey, parsed.data.filename);
    const { uploadId } = await initiateMultipartUpload(c.env, r2Key, parsed.data.mimeType);

    const created = await createLocalJob(
      c.env,
      user.id,
      idempotencyKey,
      parsed.data,
      r2Key,
      uploadId
    ).catch(async (err) => {
      // The upload exists but the job does not — a rate limit, or a key claimed in the gap since the
      // lookup above. Release the staged parts instead of leaving them billable and unreferenced.
      await abortMultipartUpload(c.env, r2Key, uploadId);
      throw err;
    });

    return c.json(
      {
        job: created.job,
        partSize,
        partCount,
        uploadId,
      },
      201
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
      (e.status as 400 | 409 | 429 | 500) || 500
    );
  }
});

// POST /relay
//
// A remote source the browser fetches for itself. Everything after the fetch is the local-upload
// path — the tab stages bytes into R2 with presigned part PUTs and the same workflow moves them to
// Drive — so this stores a `local` job and differs from `/local` only in recording where the bytes
// came from. The token-bearing URL stays in the tab; only its redacted form is persisted.
jobRoutes.post('/relay', requireCsrf, async (c) => {
  const user = c.get('user')!;
  const idempotencyKey = c.req.header('Idempotency-Key') || c.req.header('idempotency-key');

  if (!isValidIdempotencyKey(idempotencyKey)) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message:
            'Idempotency-Key header is required for creating relay upload jobs and must be 8-128 characters of A-Z, a-z, 0-9, hyphen or underscore',
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

  const parsed = CreateRelayJobSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: parsed.error.issues[0]?.message || 'Invalid relay upload parameters',
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
          message: urlCheck.error || 'Relay URL violates security policy',
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

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
    const normalizedUrl = urlCheck.normalizedUrl!;
    const filename = parsed.data.filename || deriveRemoteFilename(normalizedUrl);
    // A delivery endpoint that answers `application/octet-stream` would make Drive treat a playable
    // MP4 as a download-only blob, so the extension gets the final say.
    const mimeType =
      guessMimeFromFilename(filename) || parsed.data.mimeType || 'application/octet-stream';

    const { partSize, partCount } = calculatePartLayout(parsed.data.fileSize);

    // As in `/local`: resolve the key first so a retry reuses the multipart upload already recorded
    // rather than opening a second, unreferenced one, and a key owned by another account answers 409.
    const existing = await findJobForIdempotencyKey(c.env, user.id, idempotencyKey);
    if (existing) {
      return c.json(
        { job: existing.job, partSize, partCount, uploadId: existing.r2UploadId },
        200
      );
    }

    const r2Key = generateR2Key(user.id, idempotencyKey, filename);
    const { uploadId } = await initiateMultipartUpload(c.env, r2Key, mimeType);

    const created = await createLocalJob(
      c.env,
      user.id,
      idempotencyKey,
      {
        filename,
        fileSize: parsed.data.fileSize,
        mimeType,
        folderId: parsed.data.folderId,
      },
      r2Key,
      uploadId,
      redactSourceUrl(normalizedUrl)
    ).catch(async (err) => {
      await abortMultipartUpload(c.env, r2Key, uploadId);
      throw err;
    });

    return c.json(
      {
        job: created.job,
        partSize,
        partCount,
        uploadId,
      },
      201
    );
  } catch (err) {
    const e = err as ErrorLike;
    return c.json(
      {
        error: {
          code: e.code || 'RELAY_JOB_CREATION_FAILED',
          message: e.message || 'Failed to create relay upload job',
          retriable: Boolean(e.retriable),
          requestId: c.get('requestId') || 'req-id',
        },
      },
      (e.status as 400 | 409 | 429 | 500) || 500
    );
  }
});

// GET /:id/parts
jobRoutes.get('/:id/parts', async (c) => {
  const user = c.get('user')!;
  const jobId = c.req.param('id');
  const fromPart = clampQueryInt(c.req.query('from'), 1, 1, MAX_PARTS);
  const count = clampQueryInt(c.req.query('count'), 10, 1, 20);

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

  // A relayed stream has no declared length, so there is no part count to cap against — the client
  // discovers the end of the source by reaching it. Sign whatever range it asks for, up to R2's own
  // ceiling.
  const { partCount } = calculatePartLayout(row.file_size);
  const lastSignablePart = row.file_size > 0 ? partCount : MAX_PARTS;
  const endPart = Math.min(fromPart + count - 1, lastSignablePart);
  const parts: { partNumber: number; url: string }[] = [];

  for (let p = fromPart; p <= endPart; p++) {
    const url = await signPartUploadUrl(
      c.env,
      row.r2_object_key || stagingFallbackKey(user.id, jobId),
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

  const stagingKey = row.r2_object_key || stagingFallbackKey(user.id, jobId);
  const stagingUploadId = row.r2_upload_id || 'mock-upload';

  // A relay streams a source of unknown length, so the client's own byte count is the only size
  // check available before the parts are assembled. Refuse over-cap uploads here rather than
  // stitching together an object that can never be transferred.
  if (parsed.data.totalBytes && parsed.data.totalBytes > MAX_UPLOAD_SIZE_BYTES) {
    await abortMultipartUpload(c.env, stagingKey, stagingUploadId);
    return c.json(
      {
        error: {
          code: 'FILE_TOO_LARGE',
          message: `Staged upload of ${parsed.data.totalBytes} bytes exceeds the ${MAX_UPLOAD_SIZE_BYTES}-byte maximum`,
          retriable: false,
          requestId: c.get('requestId') || 'req-id',
        },
      },
      400
    );
  }

  try {
    const assembled = await completeMultipartUpload(
      c.env,
      stagingKey,
      stagingUploadId,
      parsed.data.parts
    );

    // Drive's resumable session needs an exact total, and the workflow reads it from `file_size`.
    // Only R2's own report of the assembled object is trustworthy, so it wins outright —
    // `completeMultipartUpload` also returns an *inferred* size from a mock binding, which is why the
    // `confirmed` flag and not the size itself decides.
    //
    // Failing that, the count of bytes the client actually staged beats the size on the row. For a
    // picked file they agree. For a relay they need not: `file_size` there is only what the remote
    // host claimed in `Content-Length` before the transfer began, and a claim that disagrees with the
    // bytes in R2 makes Drive reject the very first chunk.
    const declaredSize = Number(row.file_size) || 0;
    const stagedSize = parsed.data.totalBytes || 0;
    const finalSize = assembled?.confirmed ? assembled.size : stagedSize || declaredSize;

    if (finalSize > MAX_UPLOAD_SIZE_BYTES) {
      await deleteR2Object(c.env, stagingKey);
      return c.json(
        {
          error: {
            code: 'FILE_TOO_LARGE',
            message: `Staged object of ${finalSize} bytes exceeds the ${MAX_UPLOAD_SIZE_BYTES}-byte maximum`,
            retriable: false,
            requestId: c.get('requestId') || 'req-id',
          },
        },
        400
      );
    }

    if (finalSize <= 0) {
      return c.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Staged upload size could not be determined; report totalBytes on completion',
            retriable: false,
            requestId: c.get('requestId') || 'req-id',
          },
        },
        400
      );
    }

    const now = new Date().toISOString();
    const updated = await c.env.DB.prepare(
      `UPDATE upload_jobs
       SET status = 'queued', file_size = ?, updated_at = ?, version = version + 1
       WHERE id = ? AND user_id = ? AND version = ?
       RETURNING *`
    )
      .bind(finalSize, now, jobId, user.id, Number(row.version))
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

  if (!isValidIdempotencyKey(idempotencyKey)) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message:
            'Idempotency-Key header is required for creating upload batches and must be 8-128 characters of A-Z, a-z, 0-9, hyphen or underscore',
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
