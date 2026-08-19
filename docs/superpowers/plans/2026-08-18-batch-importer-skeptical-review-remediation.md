# Batch Importer Skeptical Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the remaining batch-importer workflow, idempotency, retry, and folder-pagination defects so failed/canceled jobs cannot be restarted accidentally, unsupported remote responses fail truthfully, concurrent requests remain deterministic, retries are atomic, and every Drive folder is selectable.

**Architecture:** Keep the existing one-workflow-per-job model and D1 aggregate schema. Tighten the shared job state machine, make workflow terminal writes conditional and transactionally consistent, reject unknown remote sizes before creating a resumable Drive session, and move batch retry admission plus child updates into one guarded D1 batch. Preserve the current API contracts; repeated create/retry requests return the current batch representation rather than introducing new response types.

**Tech Stack:** React 18, TypeScript, Hono, Cloudflare Workers Workflows, D1/SQLite, Google Drive API, Vitest, Cloudflare Workers Vitest pool, Testing Library.

## Global Constraints

- Treat `failed`, `completed`, and `canceled` as terminal job statuses. A retry is the only operation allowed to move `failed` or `canceled` back to `queued`.
- Never mark a remote job completed unless bytes were transferred and Google returned a real file ID.
- For this remediation, reject remote sources whose positive finite size cannot be established. Do not invent an unbounded buffering or streaming path inside the existing fixed-size resumable uploader.
- Job and current-attempt terminal state must agree after completion, cancellation, and failure.
- Batch creation remains all-or-nothing and idempotent under simultaneous requests using the same `Idempotency-Key`.
- Batch retry remains all-or-nothing for the retryable children selected at admission time. A repeated retry while those children are already queued/running is a successful no-op.
- Do not expose raw source URLs, Drive tokens, resumable session URLs, or provider error bodies in API responses or logs.
- Do not modify unrelated extension upload behavior or add schema migrations for these fixes.
- Every task begins with a regression test that fails for the reviewed defect and ends with focused verification.

## File Map

**Modify:**
- `src/shared/jobState.ts` to classify `failed` as terminal while retaining explicit retry transitions.
- `src/worker/workflows/DriveTransfer.ts` to reject unknown sizes, guard startup/finalization, and update jobs plus attempts consistently.
- `src/worker/services/jobRepository.ts` to recover concurrent idempotency collisions and atomically retry batch children.
- `src/worker/routes/jobs.ts` only if repository return metadata is needed to choose the create response status.
- `src/web/components/FolderPicker.tsx` to retain and consume Drive folder page tokens.
- `test/unit/jobState.test.ts` for terminal-state semantics.
- `test/worker/driveTransfer.test.ts` for failed-job, unknown-size, cancellation-race, completion, and failure assertions.
- `test/worker/batches.test.ts` for simultaneous idempotency and atomic/idempotent retry behavior.
- `test/web/BatchUploads.test.tsx` for folder pagination behavior.
- `vitest.config.ts` only if test isolation must be tightened to make uncaught background workflow errors fail deterministically.

**No new production files or migrations are required.**

---

### Task 1: Make Failed Jobs Terminal

**Files:**
- Modify: `src/shared/jobState.ts:25`
- Test: `test/unit/jobState.test.ts:52-63`
- Test: `test/worker/driveTransfer.test.ts`

**Interfaces:**
- Consumes: existing `UploadJobStatus`, `canTransition`, and `runDriveTransfer(env, payload, step)`.
- Produces: `isTerminalStatus('failed') === true`; explicit `canTransition('failed', 'queued') === true` remains unchanged for repository-controlled retry.

- [ ] **Step 1: Change the state-machine test to require failed to be terminal.**

Replace the terminal-state assertions with:

```ts
it('identifies completed, failed, and canceled as terminal', () => {
  expect(isTerminalStatus('completed')).toBe(true);
  expect(isTerminalStatus('failed')).toBe(true);
  expect(isTerminalStatus('canceled')).toBe(true);

  expect(isTerminalStatus('staging')).toBe(false);
  expect(isTerminalStatus('queued')).toBe(false);
  expect(isTerminalStatus('fetching')).toBe(false);
  expect(isTerminalStatus('uploading')).toBe(false);
  expect(isTerminalStatus('cancel_requested')).toBe(false);
});
```

- [ ] **Step 2: Add a workflow regression test proving a delayed invocation cannot restart a failed job.**

Add this test to `test/worker/driveTransfer.test.ts`; insert an attempt row so both job and attempt can be asserted:

```ts
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
```

- [ ] **Step 3: Run the focused tests and confirm the new assertions fail.**

Run:

```powershell
npx.cmd vitest run test/unit/jobState.test.ts test/worker/driveTransfer.test.ts
```

Expected: the state test reports `isTerminalStatus('failed')` as false, and the workflow test observes provider activity or a changed failed row.

- [ ] **Step 4: Add `failed` to the terminal set without removing the explicit retry transition.**

Change only the terminal set in `src/shared/jobState.ts`:

```ts
const TERMINAL_STATUSES = new Set<UploadJobStatus>([
  'completed',
  'failed',
  'canceled',
]);
```

Keep this transition in `ALLOWED_TRANSITIONS`:

```ts
failed: ['queued'],
```

The distinction is intentional: terminal means workflows and cancellation stop processing the job; `retryJob` may still explicitly invoke the legal retry transition.

- [ ] **Step 5: Run the focused tests and confirm they pass.**

Run:

```powershell
npx.cmd vitest run test/unit/jobState.test.ts test/worker/driveTransfer.test.ts
```

Expected: all tests pass and the delayed invocation performs no fetch.

- [ ] **Step 6: Commit the terminal-state fix.**

```powershell
git add src/shared/jobState.ts test/unit/jobState.test.ts test/worker/driveTransfer.test.ts
git commit -m "fix: keep failed jobs terminal"
```

---

### Task 2: Reject Unknown Remote Sizes Truthfully

**Files:**
- Modify: `src/worker/workflows/DriveTransfer.ts:67-117`
- Test: `test/worker/driveTransfer.test.ts`

**Interfaces:**
- Consumes: `fetchRemoteWithPolicy`, encrypted remote URL fields, and the existing workflow failure catch.
- Produces: stable `REMOTE_SIZE_UNKNOWN` failures when no positive finite `Content-Length` can be established; no Drive resumable session and no fabricated Drive file ID.

- [ ] **Step 1: Add an attempt row to the existing successful transfer fixture.**

Immediately after inserting `job-wf-remote-1`, insert:

```ts
await env.DB.prepare(
  `INSERT INTO upload_attempts
     (id, job_id, user_id, attempt_number, status)
   VALUES (?, ?, ?, 1, 'queued')`
)
  .bind(`${jobId}-1`, jobId, userId)
  .run();
```

Extend the success assertion to require the attempt to be completed:

```ts
const attempt = await env.DB.prepare(
  'SELECT status, bytes_transferred FROM upload_attempts WHERE job_id = ?'
).bind(jobId).first<{ status: string; bytes_transferred: number }>();

expect(attempt).toEqual({ status: 'completed', bytes_transferred: 1024 });
```

- [ ] **Step 2: Add a regression test for a server that rejects HEAD.**

```ts
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
    if (url.includes('googleapis.com/upload/drive/v3/files')) {
      driveSessionRequests.push(url);
    }
    return originalFetch(input, init);
  });

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
  globalThis.fetch = originalFetch;
});
```

Use `try/finally` around the test body in the final test code so `globalThis.fetch` is restored even when an assertion fails.

- [ ] **Step 3: Add a second regression test for invalid Content-Length values.**

Create one parameterized test with the exact cases `[null, '0', '-1', 'not-a-number']`. For each case, use a unique job ID such as `job-wf-invalid-size-${index}`, insert a zero-size queued remote job plus `${jobId}-1` queued attempt, and mock the source `HEAD` response as follows:

```ts
const headHeaders = contentLength === null
  ? undefined
  : { 'Content-Length': contentLength };

if (url === sourceUrl && init?.method === 'HEAD') {
  return new Response(null, { status: 200, headers: headHeaders });
}
```

Run `runDriveTransfer` with the inline step runner and assert for each case that the promise rejects with `code === 'REMOTE_SIZE_UNKNOWN'`, the job has `status === 'failed'`, the attempt has `status === 'failed'`, and no URL containing `upload/drive/v3/files` was requested. The concrete acceptance condition is:

```ts
expect(Number.isFinite(Number(contentLength)) && Number(contentLength) > 0).toBe(false);
```

- [ ] **Step 4: Run the focused workflow test and confirm the unknown-size case fails.**

Run:

```powershell
npx.cmd vitest run test/worker/driveTransfer.test.ts
```

Expected: the current code resolves successfully and stores `drive-file-uploaded`, so the rejection/file-ID assertions fail.

- [ ] **Step 5: Introduce a stable coded workflow error.**

Add near the top of `DriveTransfer.ts`:

```ts
class TransferError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'TransferError';
  }
}
```

After the remote HEAD probe and before `startResumableUpload`, validate the discovered size:

```ts
if (job.source_kind === 'remote' && (!Number.isFinite(totalSize) || totalSize <= 0)) {
  throw new TransferError(
    'REMOTE_SIZE_UNKNOWN',
    'The remote server did not provide a valid file size'
  );
}
```

Do not include `sourceUrl`, response headers, or provider response bodies in the message.

- [ ] **Step 6: Remove the fabricated successful completion fallback.**

Inside finalization, require the upload response to have supplied an ID:

```ts
if (!completedGoogleFile?.id) {
  throw new TransferError(
    'DRIVE_UPLOAD_INCOMPLETE',
    'Google Drive did not confirm the uploaded file'
  );
}

const driveFileId = completedGoogleFile.id;
const driveFileLink =
  completedGoogleFile.webViewLink ||
  `https://drive.google.com/file/d/${driveFileId}/view`;
```

- [ ] **Step 7: Run workflow tests and confirm both known- and unknown-size outcomes.**

Run:

```powershell
npx.cmd vitest run test/worker/driveTransfer.test.ts
```

Expected: known-size transfer completes with the real Google file ID; unknown/invalid sizes fail before Drive session creation.

- [ ] **Step 8: Commit the unknown-size fix.**

```powershell
git add src/worker/workflows/DriveTransfer.ts test/worker/driveTransfer.test.ts
git commit -m "fix: reject remote uploads with unknown size"
```

---

### Task 3: Keep Job and Attempt Terminal States Consistent

**Files:**
- Modify: `src/worker/workflows/DriveTransfer.ts:54-60, 143-160, 222-250, 251-276`
- Test: `test/worker/driveTransfer.test.ts`

**Interfaces:**
- Consumes: `payload.attemptNumber`, `env.DB.batch`, and terminal-state semantics from Task 1.
- Produces: terminal updates scoped to the current attempt; completion happens only when the job is still `uploading`; cancellation changes both job and attempt to `canceled`; failure changes both to `failed` unless the job has already reached another terminal state.

- [ ] **Step 1: Add attempt consistency to the existing pre-transfer cancellation test.**

Seed a queued attempt for `job-wf-cancel-1` and replace the final assertion with:

```ts
const job = await env.DB.prepare(
  'SELECT status FROM upload_jobs WHERE id = ?'
).bind(jobId).first<{ status: string }>();
const attempt = await env.DB.prepare(
  'SELECT status, finished_at FROM upload_attempts WHERE job_id = ? AND attempt_number = 1'
).bind(jobId).first<{ status: string; finished_at: string | null }>();

expect(job?.status).toBe('canceled');
expect(attempt?.status).toBe('canceled');
expect(attempt?.finished_at).not.toBeNull();
```

- [ ] **Step 2: Add a cancellation-during-finalization regression test.**

Use a custom `StepRunner` that changes the job to `cancel_requested` immediately before running `finalize-transfer`:

```ts
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
```

Mock a normal known-size transfer. After `runDriveTransfer`, require:

```ts
expect(job.status).toBe('canceled');
expect(job.drive_file_id).toBeNull();
expect(attempt.status).toBe('canceled');
expect(attempt.finished_at).not.toBeNull();
```

- [ ] **Step 3: Run the workflow test and confirm attempt consistency fails.**

Run:

```powershell
npx.cmd vitest run test/worker/driveTransfer.test.ts
```

Expected: the current cancellation branch leaves the attempt queued, and the finalization race can mark the attempt completed while the job remains `cancel_requested`.

- [ ] **Step 4: Scope every attempt update to the active attempt number.**

At the start of `runDriveTransfer`, derive:

```ts
const attemptNumber = payload.attemptNumber ?? 1;
```

Every attempt update in this workflow must include:

```sql
WHERE job_id = ? AND attempt_number = ?
```

This prevents a delayed workflow from rewriting earlier or later attempt history.

- [ ] **Step 5: Add one local helper for consistent cancellation.**

Inside `runDriveTransfer`, add a closure rather than a new module-level abstraction:

```ts
const markCanceled = async (): Promise<void> => {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE upload_jobs
       SET status = 'canceled', updated_at = ?, version = version + 1
       WHERE id = ? AND user_id = ?
         AND status IN ('staging', 'queued', 'fetching', 'uploading', 'cancel_requested')`
    ).bind(now, jobId, userId),
    env.DB.prepare(
      `UPDATE upload_attempts
       SET status = 'canceled', finished_at = ?
       WHERE job_id = ? AND attempt_number = ?
         AND status NOT IN ('completed', 'failed', 'canceled')`
    ).bind(now, jobId, attemptNumber),
  ]);
};
```

Call `markCanceled()` in both cancellation checkpoints.

- [ ] **Step 6: Make finalization one conditional D1 batch and re-read the outcome.**

Before finalization updates, issue one D1 batch:

```ts
await env.DB.batch([
  env.DB.prepare(
    `UPDATE upload_jobs
     SET status = 'completed', drive_file_id = ?, drive_file_link = ?,
         progress_bytes = file_size, updated_at = ?, version = version + 1
     WHERE id = ? AND user_id = ? AND status = 'uploading'`
  ).bind(driveFileId, driveFileLink, now, jobId, userId),
  env.DB.prepare(
    `UPDATE upload_attempts
     SET status = 'completed', bytes_transferred = ?, finished_at = ?
     WHERE job_id = ? AND attempt_number = ?
       AND status NOT IN ('completed', 'failed', 'canceled')
       AND EXISTS (
         SELECT 1 FROM upload_jobs
         WHERE id = ? AND user_id = ? AND status = 'completed'
       )`
  ).bind(totalSize, now, jobId, attemptNumber, jobId, userId),
]);
```

Then re-read the job status. If it is `cancel_requested`, call `markCanceled()` and return. If it is `canceled`, return. If it is not `completed`, throw `TransferError('JOB_STATE_CONFLICT', 'Upload job changed state during finalization')` so the outer catch applies the safe failure path where legal.

- [ ] **Step 7: Make failure updates current-attempt-aware and terminal-safe.**

Replace broad attempt updates with one D1 batch. The job update must use:

```sql
WHERE id = ? AND user_id = ?
  AND status NOT IN ('completed', 'failed', 'canceled')
```

The attempt update must include `attempt_number = ?` and an `EXISTS` clause requiring the job to be `failed`. If the job is `cancel_requested`, call `markCanceled()` instead of marking it failed.

- [ ] **Step 8: Run workflow and state tests.**

Run:

```powershell
npx.cmd vitest run test/unit/jobState.test.ts test/worker/driveTransfer.test.ts
```

Expected: all tests pass; job and current attempt agree in completed, canceled, failed, delayed, and finalization-race cases.

- [ ] **Step 9: Commit terminal-write consistency.**

```powershell
git add src/worker/workflows/DriveTransfer.ts test/worker/driveTransfer.test.ts
git commit -m "fix: synchronize transfer job and attempt states"
```

---

### Task 4: Recover Concurrent Batch Creation Idempotently

**Files:**
- Modify: `src/worker/services/jobRepository.ts:481-675`
- Test: `test/worker/batches.test.ts`

**Interfaces:**
- Consumes: `createBatch(env, userId, idempotencyKey, data, destinationFolderName)` and `getBatch`.
- Produces: simultaneous same-user calls with the same key return one stored batch and identical children; cross-user key collisions remain generic `409 CONFLICT`; capacity rejection remains `429` with no rows.

- [ ] **Step 1: Add a repository-level simultaneous creation test.**

Import `createBatch` directly and use a user with no workflow dispatch binding side effects. Construct an environment view with `DRIVE_TRANSFER` omitted at runtime:

```ts
import { createBatch } from '../../src/worker/services/jobRepository';
import { Env } from '../../src/worker/env';

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
```

- [ ] **Step 2: Run the batch test and confirm one concurrent call rejects.**

Run:

```powershell
npx.cmd vitest run test/worker/batches.test.ts
```

Expected: one promise is rejected by a D1 uniqueness constraint or both calls expose inconsistent `isExisting` results.

- [ ] **Step 3: Add a same-user batch reload helper local to the repository.**

Extract the repeated parent/child read into:

```ts
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
```

Use this helper for initial idempotency lookup and collision recovery. Always verify `String(batchRow.user_id) === userId` before returning data.

- [ ] **Step 4: Recover only a verified primary-key collision.**

Wrap `env.DB.batch(statements)` in `try/catch`. On error, re-read `idempotencyKey`:

```ts
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
```

Do not turn arbitrary D1 failures into successful replays: recovery is valid only when the exact batch ID now exists and belongs to the requesting user.

- [ ] **Step 5: Preserve 429 classification when the guarded insert affects no rows.**

After a successful `DB.batch`, keep the existing parent reread. If no batch exists, re-read daily and active counts and throw `DAILY_LIMIT_EXCEEDED` when daily capacity is exhausted, otherwise `CONCURRENT_LIMIT_EXCEEDED`. This preserves the public error code rather than reporting every guarded rejection as concurrent overflow.

- [ ] **Step 6: Run batch tests repeatedly to exercise scheduling variance.**

Run:

```powershell
1..10 | ForEach-Object { npx.cmd vitest run test/worker/batches.test.ts; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```

Expected: all ten runs pass with one batch row and two child rows for the concurrent key.

- [ ] **Step 7: Commit idempotency recovery.**

```powershell
git add src/worker/services/jobRepository.ts test/worker/batches.test.ts
git commit -m "fix: recover concurrent batch idempotency"
```

---

### Task 5: Make Batch Retry Atomic and State-Idempotent

**Files:**
- Modify: `src/worker/services/jobRepository.ts:777-810`
- Test: `test/worker/batches.test.ts`

**Interfaces:**
- Consumes: `getBatch`, `computeBatchView`, D1 `batch()`, and `env.DRIVE_TRANSFER.create`.
- Produces: `retryBatch` atomically requeues the snapshot of failed/canceled children, creates exactly one new attempt per changed child, returns a successful no-op when there are no retryable children, and dispatches only children changed by this invocation.

- [ ] **Step 1: Add a repeated-retry idempotency test.**

Create a dedicated two-child batch with one failed and one completed child. Disable real workflow dispatch through a repository-level environment view. Call `retryBatch` twice and assert both calls succeed:

```ts
const first = await retryBatch(noDispatchEnv, userIdA, batchId);
const second = await retryBatch(noDispatchEnv, userIdA, batchId);

expect(first.jobs.find((job) => job.id === failedJobId)?.status).toBe('queued');
expect(second.jobs.find((job) => job.id === failedJobId)?.status).toBe('queued');
expect(second.jobs.find((job) => job.id === completedJobId)?.status).toBe('completed');

const attempts = await env.DB.prepare(
  'SELECT attempt_number FROM upload_attempts WHERE job_id = ? ORDER BY attempt_number'
).bind(failedJobId).all<{ attempt_number: number }>();
expect(attempts.results.map((row) => row.attempt_number)).toEqual([1, 2]);
```

- [ ] **Step 2: Add an all-or-nothing retry admission test.**

Seed two failed children, then fill the user to 24 active jobs. Retrying two children would exceed the 25-active limit. Assert:

```ts
await expect(retryBatch(noDispatchEnv, userIdA, batchId)).rejects.toMatchObject({
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
```

Also assert no attempt-number-2 rows exist.

- [ ] **Step 3: Add a concurrent retry test.**

Call `retryBatch` twice through `Promise.allSettled` against one failed child. Both calls must fulfill, the child must end queued with `attempt_count = 2`, and attempt numbers must be exactly `[1, 2]`, never `[1, 2, 3]`.

- [ ] **Step 4: Run batch tests and confirm the new cases fail.**

Run:

```powershell
npx.cmd vitest run test/worker/batches.test.ts
```

Expected: repeated retry throws `INVALID_JOB_STATE`; concurrent/limited retries can expose duplicate or partial behavior.

- [ ] **Step 5: Return the current batch as a successful no-op when no child is retryable.**

Replace the current `INVALID_JOB_STATE` branch with:

```ts
if (retryableJobs.length === 0) {
  return batchData;
}
```

- [ ] **Step 6: Reserve retry admission once, then update children inside one D1 batch.**

Do not repeat the active-count predicate on every child update. Earlier statements in the same D1 transaction would make later statements observe the newly queued children and could reject a valid retry or create partial behavior. Use the batch row's optimistic `version` as the retry reservation:

1. First statement: increment `upload_batches.version` only when the batch still has the snapshot retryable children and the user's active capacity excluding those children plus the retry count remains within the limit.

```sql
UPDATE upload_batches
SET version = version + 1, updated_at = ?
WHERE id = ? AND user_id = ? AND version = ?
  AND (
    SELECT COUNT(*) FROM upload_jobs
    WHERE batch_id = ? AND user_id = ?
      AND status IN ('failed', 'canceled')
  AND id IN (<one bound placeholder for each snapshot child ID>)
  ) = ?
  AND (
    SELECT COUNT(*) FROM upload_jobs
    WHERE user_id = ?
      AND status IN ('staging', 'queued', 'fetching', 'uploading', 'cancel_requested')
      AND id NOT IN (<one bound placeholder for each snapshot child ID>)
  ) + <bound retryable-child count> <= <bound MAX_CONCURRENT_JOBS_PER_USER>
```

The `<...>` notation above describes SQL placeholders that must be generated, not literal SQL text to paste. Build the two placeholder lists with `retryableJobs.map(() => '?').join(', ')`; append the corresponding child IDs to the `.bind(...)` argument list in the same order. Never interpolate child IDs into SQL. The first predicate makes a concurrent retry/cancel request fail admission before any child changes. The second predicate excludes the failed/canceled children that are about to be requeued from the current active count, then adds the complete retry count exactly once.

2. For each snapshot child, prepare one job update that requires the reserved batch version and the child's snapshot version/status:

```sql
UPDATE upload_jobs
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
  )
```

Bind the reserved batch version (`snapshot batch version + 1`) so the child cannot update unless the first admission statement succeeded. The attempt insert must select from the child only when it now has the expected incremented attempt number and queued status:

```sql
INSERT INTO upload_attempts
  (id, job_id, user_id, attempt_number, status, started_at)
SELECT ?, id, user_id, attempt_count, 'queued', ?
FROM upload_jobs
WHERE id = ? AND user_id = ? AND status = 'queued' AND attempt_count = ?
```

Use deterministic attempt IDs `${job.id}-${nextAttempt}`. D1 `batch()` must contain the reservation statement, all child updates, and all attempt inserts. If the reservation statement matches zero rows, the remaining guarded statements also match zero rows and no child or attempt changes are committed. After the batch, reread the batch version and children; if the reservation did not advance, classify the result as a state-idempotent no-op when another request already queued the snapshot children, otherwise return the matching 429 capacity error.

- [ ] **Step 7: Verify all snapshot children changed or classify the operation as a no-op/conflict.**

After `DB.batch`, re-read the batch. Compare each snapshot child:

- Changed child: now `queued`, `attemptCount === oldAttemptCount + 1`, and has the matching attempt row.
- Concurrently retried child: already `queued` with at least the expected attempt count; treat as an idempotent no-op and do not dispatch it from this invocation.
- Unchanged failed/canceled child: capacity admission failed; throw the correct 429 after confirming no snapshot child changed. If any snapshot child changed while another did not, throw `JobError('RETRY_ATOMICITY_FAILED', 'Batch retry could not be applied atomically', 500)` and add a regression test because this indicates the SQL guards are not truly atomic.

Cloudflare D1 `batch()` executes as one transaction, so the intended implementation should never produce the partial branch.

- [ ] **Step 8: Dispatch only jobs changed by this invocation.**

Collect changed job IDs from the post-batch comparison. For each, call:

```ts
await env.DRIVE_TRANSFER.create({
  id: `${job.id}-attempt-${job.attemptCount}`,
  params: {
    jobId: job.id,
    userId,
    attemptNumber: job.attemptCount,
  },
});
```

On dispatch failure, mark only that job and its exact attempt as failed with `WORKFLOW_DISPATCH_FAILED`, using a D1 batch and status/version guards. Continue dispatching siblings.

- [ ] **Step 9: Run retry tests repeatedly.**

Run:

```powershell
1..10 | ForEach-Object { npx.cmd vitest run test/worker/batches.test.ts; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```

Expected: repeated and simultaneous retries create exactly one additional attempt; capacity rejection changes no child.

- [ ] **Step 10: Commit atomic retry behavior.**

```powershell
git add src/worker/services/jobRepository.ts test/worker/batches.test.ts
git commit -m "fix: make batch retry atomic and idempotent"
```

---

### Task 6: Add Folder Picker Pagination

**Files:**
- Modify: `src/web/components/FolderPicker.tsx:24-45, 137-182`
- Test: `test/web/BatchUploads.test.tsx:18-140`

**Interfaces:**
- Consumes: `listDriveFolders({ parentId, pageToken, pageSize })` returning `DrivePage.nextPageToken`.
- Produces: first-page replacement, next-page append, visible load-more control, and pagination reset when navigating to another parent.

- [ ] **Step 1: Add a web test for loading the second folder page.**

```tsx
it('loads additional folder pages without losing the first page', async () => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const parsed = new URL(url, 'https://uploader.local');
    const pageToken = parsed.searchParams.get('pageToken');

    if (pageToken === 'page-2') {
      return new Response(JSON.stringify({
        items: [{
          id: 'folder-51',
          name: 'Folder 51',
          isFolder: true,
          mimeType: 'application/vnd.google-apps.folder',
          shared: false,
          trashed: false,
        }],
        nextPageToken: null,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      items: [{
        id: 'folder-1',
        name: 'Folder 1',
        isFolder: true,
        mimeType: 'application/vnd.google-apps.folder',
        shared: false,
        trashed: false,
      }],
      nextPageToken: 'page-2',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  render(
    <FolderPicker
      selectedFolderName="My Drive (Root)"
      onSelect={vi.fn()}
    />
  );

  fireEvent.click(screen.getByText(/Destination:/i).closest('button')!);
  await screen.findByText('Folder 1');
  fireEvent.click(screen.getByRole('button', { name: /load more folders/i }));
  await screen.findByText('Folder 51');

  expect(screen.getByText('Folder 1')).toBeDefined();
  expect(globalThis.fetch).toHaveBeenCalledWith(
    expect.stringContaining('pageToken=page-2'),
    expect.anything()
  );
});
```

Adapt the final fetch assertion to the actual `apiRequest` call signature if it supplies only one argument; the load-more URL must contain `pageToken=page-2`.

- [ ] **Step 2: Add a navigation-reset test.**

Open a subfolder after page one, and assert its request has `parentId=<folder-id>` but no previous `pageToken`. Navigate back through the root breadcrumb and assert the root starts from page one again.

- [ ] **Step 3: Run the web test and confirm the load-more control is missing.**

Run:

```powershell
npx.cmd vitest run test/web/BatchUploads.test.tsx
```

Expected: `getByRole('button', { name: /load more folders/i })` fails.

- [ ] **Step 4: Track and reset the next page token.**

Add state:

```ts
const [nextPageToken, setNextPageToken] = useState<string | null>(null);
```

Change `loadFolders` to accept an optional token:

```ts
const loadFolders = useCallback(async (parentId?: string, pageToken?: string) => {
  try {
    setIsLoading(true);
    setError(null);
    const res = await listDriveFolders({ parentId, pageToken, pageSize: 50 });
    setFolders((current) => pageToken ? [...current, ...res.items] : res.items);
    setNextPageToken(res.nextPageToken || null);
  } catch (err) {
    setError((err as Error).message || 'Failed to load folders');
  } finally {
    setIsLoading(false);
  }
}, []);
```

Before changing `currentParentId` in both subfolder and breadcrumb handlers, clear pagination state:

```ts
setFolders([]);
setNextPageToken(null);
```

- [ ] **Step 5: Render an accessible load-more command.**

After the folder list, render:

```tsx
{nextPageToken && (
  <button
    type="button"
    disabled={isLoading}
    onClick={() => loadFolders(currentParentId, nextPageToken)}
    className="w-full py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 disabled:opacity-50"
  >
    {isLoading ? 'Loading folders...' : 'Load more folders'}
  </button>
)}
```

Do not auto-select or close the picker when appending a page.

- [ ] **Step 6: Run the focused web test.**

Run:

```powershell
npx.cmd vitest run test/web/BatchUploads.test.tsx
```

Expected: first and second page entries coexist; navigation resets pagination.

- [ ] **Step 7: Commit folder pagination.**

```powershell
git add src/web/components/FolderPicker.tsx test/web/BatchUploads.test.tsx
git commit -m "fix: paginate Drive folder picker"
```

---

### Task 7: Eliminate Background Workflow Noise and Run Full Verification

**Files:**
- Modify: `test/worker/batches.test.ts` if workflow dispatch is not isolated in every repository/API test.
- Modify: `test/worker/jobs.test.ts` if remote-job API tests still launch unstubbed workflows.
- Modify: `vitest.config.ts` only if the Workers pool requires an explicit option to fail on unhandled errors after fixtures are isolated.
- Test: all batch, job, workflow, parser, and web suites.

**Interfaces:**
- Consumes: all changes from Tasks 1-6.
- Produces: a full test run with zero failed assertions and no uncaught workflow/OAuth/Drive exceptions in output.

- [ ] **Step 1: Run the full suite and capture whether uncaught errors remain.**

Run:

```powershell
npm.cmd test 2>&1 | Tee-Object -FilePath "$env:TEMP\gdu-batch-remediation-tests.log"
```

Then run:

```powershell
rg -n "uncaught exception|Uncaught \(in promise\)|hung and would never generate" "$env:TEMP\gdu-batch-remediation-tests.log"
```

Expected before isolation: the grep may find background workflow errors from API tests. Expected final state: `rg` exits 1 because no matching lines exist.

- [ ] **Step 2: Prevent API/repository tests from starting real workflow instances.**

For tests whose assertion is about database/API behavior rather than workflow execution, use a typed test environment with a stub binding:

```ts
const workflowCreate = vi.fn(async () => ({ id: 'test-workflow-instance' }));
const testEnv = {
  ...env,
  DRIVE_TRANSFER: { create: workflowCreate },
} as unknown as Env;
```

Repository-level tests pass `testEnv` directly. Route-level tests cannot replace `c.env` per request; mock all token/Drive workflow boundaries those routes trigger, or move dispatch-specific assertions to repository-level tests where the binding is controllable. Do not silence `console.error` and do not configure Vitest to ignore unhandled errors.

- [ ] **Step 3: Add dispatch-count assertions where workflow dispatch is part of behavior.**

For new batch creation with two children:

```ts
expect(workflowCreate).toHaveBeenCalledTimes(2);
expect(workflowCreate).toHaveBeenNthCalledWith(1, {
  id: `${batchId}-1`,
  params: { jobId: `${batchId}-1`, userId: userIdA },
});
```

For idempotent replay, record the call count before replay and assert it does not increase.

- [ ] **Step 4: Run focused regression suites.**

Run:

```powershell
npx.cmd vitest run test/unit/jobState.test.ts test/unit/batchParser.test.ts test/worker/driveTransfer.test.ts test/worker/batches.test.ts test/worker/jobs.test.ts test/web/BatchUploads.test.tsx
```

Expected: all focused tests pass with no uncaught background exceptions.

- [ ] **Step 5: Run type checking and linting.**

Run:

```powershell
npm.cmd run type-check
npm.cmd run lint
```

Expected: both commands exit 0 with zero errors and zero warnings.

- [ ] **Step 6: Run the complete unit/integration suite and reject noisy success.**

Run:

```powershell
npm.cmd test 2>&1 | Tee-Object -FilePath "$env:TEMP\gdu-batch-remediation-tests.log"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
rg -n "uncaught exception|Uncaught \(in promise\)|hung and would never generate" "$env:TEMP\gdu-batch-remediation-tests.log"
if ($LASTEXITCODE -eq 0) { throw 'Uncaught background errors remain in the test run' }
```

Expected: all test files pass and the final `rg` finds no uncaught background errors.

- [ ] **Step 7: Run the production build.**

Run:

```powershell
npm.cmd run build
```

Expected: TypeScript and Vite exit 0. Record the existing bundle-size warning separately; it is not introduced by this remediation.

- [ ] **Step 8: Review the final diff against all six findings.**

Run:

```powershell
git diff --check
git diff -- src/shared/jobState.ts src/worker/workflows/DriveTransfer.ts src/worker/services/jobRepository.ts src/web/components/FolderPicker.tsx test/unit/jobState.test.ts test/worker/driveTransfer.test.ts test/worker/batches.test.ts test/web/BatchUploads.test.tsx vitest.config.ts
```

Confirm explicitly:

- Failed jobs are terminal to workflows but remain explicitly retryable.
- Unknown/invalid remote sizes cannot create fake completed jobs.
- Job and exact attempt terminal statuses agree.
- Same-key concurrent creation returns one batch.
- Batch retry is atomic and repeated calls are successful no-ops.
- Folder pages beyond the first 50 can be loaded.
- Tests produce no uncaught workflow exceptions.

- [ ] **Step 9: Commit final test isolation changes.**

```powershell
git add test/worker/batches.test.ts test/worker/jobs.test.ts vitest.config.ts
git commit -m "test: isolate background upload workflows"
```

Stage only files actually changed in this task; omit unchanged paths from `git add`.

## Acceptance Checklist

- [ ] Calling `runDriveTransfer` for a `failed`, `completed`, or `canceled` job makes no network requests and leaves the row unchanged.
- [ ] `canTransition('failed', 'queued')` remains true and retry APIs still work.
- [ ] A remote source with missing, zero, negative, malformed, or non-finite size ends as `failed` with `REMOTE_SIZE_UNKNOWN`.
- [ ] Unknown-size failure creates no Drive resumable session and stores no Drive file ID/link.
- [ ] Successful completion stores a real Google Drive file ID returned by the upload response.
- [ ] Completion, cancellation, and failure update the job and exact current attempt consistently.
- [ ] Cancellation during finalization cannot leave a completed attempt under a canceled job.
- [ ] Two simultaneous same-user create calls with one idempotency key both return the same stored batch and children.
- [ ] Cross-user idempotency-key collision remains a generic 409 without ownership leakage.
- [ ] A retry that would exceed capacity changes zero child jobs and inserts zero attempts.
- [ ] Repeating or concurrently issuing batch retry creates at most one new attempt per retryable child.
- [ ] Retried completed children remain untouched and cannot duplicate Drive files.
- [ ] Folder picker appends subsequent pages and resets tokens when parent navigation changes.
- [ ] Full tests, type-check, lint, and build exit 0.
- [ ] Full test output contains no uncaught workflow, OAuth, Drive, or hung-request exceptions.

## Self-Review

- **Finding coverage:** Task 1 fixes delayed workflows restarting failed jobs. Task 2 fixes false completion for unknown-size remotes. Task 3 fixes job/attempt divergence during cancellation and finalization. Task 4 fixes simultaneous creation idempotency. Task 5 fixes atomic and state-idempotent retry. Task 6 fixes folder pagination. Task 7 closes the misleading green-test gap caused by uncaught background workflows.
- **Scope control:** The plan deliberately fails unsupported unknown-size remotes instead of adding a new streaming architecture. It adds no migrations and does not alter API DTO shapes.
- **State consistency:** `failed` is terminal for autonomous workflow processing while the existing explicit `failed -> queued` retry transition remains legal. Every workflow attempt update is scoped by `job_id` and `attempt_number`.
- **Security:** New errors use stable codes and generic messages. No test or implementation logs source URLs, tokens, resumable URLs, or provider response bodies.
- **No placeholders:** Every task identifies files, exact behavior, regression assertions, implementation shape, commands, expected outcomes, and commit boundaries.
