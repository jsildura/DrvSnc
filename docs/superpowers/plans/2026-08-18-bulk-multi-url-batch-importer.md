# Bulk Multi-URL Batch Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated user paste 1–50 remote HTTPS URLs or drop a `.txt` file, select one Google Drive folder, and create an observable batch whose items transfer in parallel through the existing per-job Cloudflare Workflow pipeline.

**Architecture:** Add a `upload_batches` aggregate in D1 and a `batch_id` relationship on `upload_jobs`. A batch request validates and normalizes the complete input, performs one atomic admission check against the existing per-user daily and active-job limits, inserts all accepted remote jobs, then starts one `DriveTransferWorkflow` instance per item. Batch state is derived from child jobs, so retries, cancellation, partial failures, and existing job history remain compatible with the current job lifecycle. The web UI gets a dedicated batch importer, folder picker backed by `/api/v1/drive/folders`, and a batch progress panel backed by the existing two-second job polling.

**Tech Stack:** React 18, TypeScript, Zod, Hono, Cloudflare Workers, D1/SQLite, Cloudflare Workflows, Google Drive resumable uploads, Vitest, Testing Library, Playwright.

## Global Constraints

- Accept only HTTPS remote URLs that pass the existing `validateRemoteUrl` and `fetchRemoteWithPolicy` SSRF protections.
- Accept 1–50 non-empty URL lines per submission; reject the complete request when the normalized input has zero URLs or more than 50 URLs.
- De-duplicate exact normalized URLs while preserving first-seen order; report duplicate line numbers in the client before submission and do not create duplicate jobs.
- Accept `.txt` files only, decode as UTF-8 text, split on CRLF/LF, trim whitespace, ignore blank lines, and reject a file that is not UTF-8 or contains more than 50 URL lines after parsing.
- A batch has one destination folder. Omitted folder means Drive root; folder IDs are validated through the existing authenticated Drive adapter before job insertion.
- Batch admission is all-or-nothing: if the batch would exceed `MAX_DAILY_JOBS_PER_USER` or `MAX_CONCURRENT_JOBS_PER_USER`, create no child jobs.
- Runtime transfer outcomes are partial-success tolerant: one failed item does not cancel sibling items; the batch completes only after all child jobs are terminal.
- Do not store raw source URLs in API responses, logs, batch metadata, or audit metadata. Continue encrypting raw URLs at rest and redact URL query/hash data in display values.
- Preserve the existing single remote URL endpoint and local multipart upload behavior.
- Every mutating endpoint requires the existing session and CSRF middleware. Batch creation additionally requires an idempotency key; cancel and retry are state-idempotent and do not require a separate key.
- Do not claim parallelism by adding a second aggregate workflow; Cloudflare Workflows already run each child job independently. The API dispatches up to 50 child workflow instances after the batch is committed.
- Use the repository's existing polling model initially; do not add WebSockets or Durable Objects for v1.

## File Map

**Create:**
- `migrations/0002_batch_imports.sql` for the D1 batch table and indexes.
- `src/web/uploads/batchParser.ts` for browser-side text/file parsing and duplicate reporting.
- `src/web/uploads/BatchImporter.tsx` for paste/drop/import UI, folder selection, and submission state.
- `src/web/uploads/BatchProgress.tsx` for aggregate progress and batch actions.
- `test/unit/batchParser.test.ts` for parser behavior.
- `test/worker/batches.test.ts` for batch API, limits, isolation, and lifecycle behavior.
- `test/web/BatchImporter.test.tsx` for importer UI behavior.

**Modify:**
- `src/shared/contracts.ts` to add batch limits and Zod/API contracts.
- `src/shared/jobState.ts` only if a batch-specific aggregate status helper is needed; keep item statuses unchanged.
- `migrations/0001_initial.sql` only for test schema parity if the test harness does not apply migrations incrementally; production schema changes belong in `0002_batch_imports.sql`.
- `src/worker/services/jobRepository.ts` for shared admission checks, batch child creation, derived summaries, and batch cancellation/retry helpers.
- `src/worker/routes/jobs.ts` for `/batch`, `/batch/:id`, `/batch/:id/cancel`, and `/batch/:id/retry` routes.
- `src/web/api/jobs.ts` for typed batch API clients.
- `src/web/uploads/UploadForm.tsx` to expose the batch importer as a distinct remote-upload mode while preserving the existing single URL mode.
- `src/web/uploads/JobList.tsx` to group batch jobs under a batch summary and retain individual job detail/actions.
- `src/web/routes/UploaderPage.tsx` to load batch summaries and pass refresh data to the importer/progress components.
- `src/web/api/drive.ts` only if the folder-picker API needs a typed helper for pagination; prefer reusing `listDriveItems` or adding a small `listDriveFolders` wrapper.
- `src/web/routes/DrivePage.tsx` only if folder-selection UI is extracted into a reusable component; otherwise do not modify this large file.
- `src/worker/scheduled/cleanup.ts` to delete expired batch rows only after child job retention cleanup has completed, preserving audit/retention policy.
- `ARCHITECTURE.md` and `docs/cloudflare-operations.md` for batch data flow, limits, and operational metrics.

---

### Task 1: Lock Batch Contracts and Parser Rules

**Files:**
- Modify: `src/shared/contracts.ts`
- Create: `src/web/uploads/batchParser.ts`
- Create: `test/unit/batchParser.test.ts`

**Interfaces:**
- Produces `MAX_BATCH_URLS = 50`, `BatchItemInput`, `BatchImportInput`, `BatchView`, `BatchSummary`, and `CreateBatchRequest`/`CreateBatchResponse` types used by the worker and UI.
- Produces `parseBatchText(text: string): ParsedBatchText` and `parseBatchFile(file: File): Promise<ParsedBatchText>`.

- [ ] **Step 1: Write parser tests for valid input.** Cover LF and CRLF, surrounding whitespace, blank lines, trailing newline, one URL, and 50 URLs. Assert first-seen order and normalized URL values.
- [ ] **Step 2: Write parser tests for duplicate and invalid input.** Cover exact duplicates, duplicate URLs with different surrounding whitespace, malformed URLs, HTTP URLs, URLs rejected by the shared remote policy, zero usable URLs, and 51 usable URLs. Assert line numbers and stable error messages.
- [ ] **Step 3: Write file parser tests.** Mock UTF-8 `.txt` files, reject non-`.txt` extensions, reject empty files, and verify the same line/error behavior as pasted text.
- [ ] **Step 4: Add Zod contracts.** Define a bounded `CreateBatchRequestSchema` with `items` limited to 50, each item containing a validated HTTPS URL and optional filename, plus optional `folderId` and required client idempotency key at the HTTP-header layer. Define batch response contracts with counts, aggregate bytes, folder fields, and child job summaries.
- [ ] **Step 5: Implement parser normalization.** Split text into lines, trim, ignore blanks, validate through `validateRemoteUrl`, use `normalizedUrl` when returned, de-duplicate by normalized URL, and return accepted items plus line-level errors/duplicate references without ever persisting raw input.
- [ ] **Step 6: Run unit tests.** Run `npx vitest run test/unit/batchParser.test.ts`. Expected: all parser tests pass.
- [ ] **Step 7: Commit.** `git add src/shared/contracts.ts src/web/uploads/batchParser.ts test/unit/batchParser.test.ts && git commit -m "feat: define batch importer contracts and parser"`

### Task 2: Add D1 Batch Persistence

**Files:**
- Create: `migrations/0002_batch_imports.sql`
- Modify: `src/worker/services/jobRepository.ts`
- Modify: `src/shared/contracts.ts`
- Test: `test/worker/batches.test.ts`

**Interfaces:**
- Produces `createBatch`, `getBatch`, `listBatches`, `getBatchSummary`, and `getBatchJobs` repository functions.
- Adds `upload_jobs.batch_id` as a nullable foreign-key-compatible column and creates `upload_batches` with `id`, `user_id`, `destination_folder_id`, `destination_folder_name`, `item_count`, `created_at`, `updated_at`, and `version`. Do not persist aggregate status; derive it from child jobs so it cannot drift.
- Batch status is derived from children as `queued`, `running`, `completed`, `partial`, `failed`, or `canceled`; do not add a second item state machine.

- [ ] **Step 1: Write repository/schema tests.** Assert a batch row can own multiple jobs, users cannot read another user's batch, and deleting a batch is blocked or avoided while child jobs exist. Assert summary counts for queued, active, completed, failed, and canceled children.
- [ ] **Step 2: Add migration.** Create `upload_batches`; add `batch_id TEXT REFERENCES upload_batches(id) ON DELETE SET NULL` to `upload_jobs`; add indexes on `(user_id, created_at DESC)`, `(user_id, status)`, and `upload_jobs(batch_id)`.
- [ ] **Step 3: Implement row normalization.** Keep `UploadJobView` unchanged except for an optional `batchId` field; add `BatchView` containing `id`, folder data, item count, counts by terminal/active status, aggregate progress bytes, total known bytes, derived status, timestamps, and version.
- [ ] **Step 4: Implement derived summary queries.** Aggregate child jobs by status and sum `progress_bytes`/`file_size`. Treat unknown remote sizes as zero in byte totals and use item counts for percentage fallback. Derive `completed` when all items completed, `partial` when all terminal and at least one completed plus one failed/canceled, `failed` when all terminal and none completed but at least one failed, and `canceled` when all items are canceled.
- [ ] **Step 5: Add test fixtures and run worker tests.** Apply `0001` plus `0002` in the worker test setup and run `npx vitest run test/worker/batches.test.ts`. Expected: schema and repository tests pass before route work begins.
- [ ] **Step 6: Commit.** `git add migrations/0002_batch_imports.sql src/shared/contracts.ts src/worker/services/jobRepository.ts test/worker/batches.test.ts && git commit -m "feat: persist upload batches"`

### Task 3: Implement Atomic Batch Creation and Workflow Dispatch

**Files:**
- Modify: `src/worker/routes/jobs.ts`
- Modify: `src/worker/services/jobRepository.ts`
- Modify: `test/worker/batches.test.ts`

**Interfaces:**
- Adds `POST /api/v1/jobs/batch` accepting `{ items: [{ url, filename? }], folderId? }` and `Idempotency-Key`.
- Returns `{ batch, jobs, rejectedItems? }`; successful creation returns 201, replay with the same key returns the original batch with 200.
- Adds a repository operation that performs the limit check, batch insert, child inserts, encrypted URL storage, attempt rows, and workflow dispatch without exposing raw URLs.

- [ ] **Step 1: Write failing route tests.** Cover missing idempotency key, invalid JSON/schema, 0/51 items, invalid URL, duplicate normalized URLs, cross-user folder/job isolation, successful 2-item creation, and idempotent replay.
- [ ] **Step 2: Write admission-limit tests.** Seed 24 active jobs and submit 2 items; expect 429 and zero new batch/jobs. Seed 99 jobs in the last 24 hours and submit 2; expect 429 and zero inserts. Verify a request that exactly reaches 25 active or 100 daily jobs succeeds.
- [ ] **Step 3: Implement batch idempotency.** Use the request idempotency key as the batch ID, matching the current remote-job convention. If a batch with that ID belongs to the current user, return it and its children. If it belongs to another user, return a generic conflict without leaking ownership.
- [ ] **Step 4: Implement atomic insertion.** Validate all URLs and folder ID and encrypt all URLs before opening the write operation. Use one D1 `batch()` transaction whose first statement is an `INSERT ... SELECT ... WHERE` for `upload_batches`; its `WHERE` computes the current 24-hour and active counts and admits only when both counts plus the requested item count remain within their limits. Follow it with child and attempt inserts referencing the new batch ID, so a failed parent admission causes a foreign-key failure and rolls back the entire D1 batch. Map that failure to the matching 429 limit error after re-reading counts; never use a check-then-insert sequence that concurrent requests can oversubscribe.
- [ ] **Step 5: Dispatch one workflow per child.** Call `env.DRIVE_TRANSFER.create({ id: jobId, params: { jobId, userId } })` for each child after the database rows exist. A dispatch failure must not delete committed jobs; mark only that child `failed` with a stable `WORKFLOW_DISPATCH_FAILED` error or use the existing failed-job path, and continue dispatching siblings.
- [ ] **Step 6: Add folder validation.** If `folderId` is supplied, call the authenticated Drive adapter before insertion and reject inaccessible/non-folder IDs with a safe 404/403 error. Store the returned folder name in both batch and child rows.
- [ ] **Step 7: Run worker tests.** Run `npx vitest run test/worker/batches.test.ts test/worker/jobs.test.ts`. Expected: batch creation, limits, idempotency, isolation, and existing remote-job tests pass.
- [ ] **Step 8: Commit.** `git add src/worker/routes/jobs.ts src/worker/services/jobRepository.ts test/worker/batches.test.ts && git commit -m "feat: create remote upload batches"`

### Task 4: Add Batch Read, Cancel, Retry, and Lifecycle Semantics

**Files:**
- Modify: `src/worker/routes/jobs.ts`
- Modify: `src/worker/services/jobRepository.ts`
- Modify: `src/worker/workflows/DriveTransfer.ts`
- Modify: `src/worker/scheduled/cleanup.ts`
- Modify: `test/worker/batches.test.ts`

**Interfaces:**
- Adds `GET /api/v1/jobs/batch` for paginated batch summaries, `GET /api/v1/jobs/batch/:id`, `POST /api/v1/jobs/batch/:id/cancel`, and `POST /api/v1/jobs/batch/:id/retry`.
- Batch cancel requests cancellation for every nonterminal child and returns the refreshed `BatchView` plus child jobs.
- Batch retry requeues only failed/canceled children, increments each child's attempt count, inserts attempt rows, and starts one workflow per retried child.

- [ ] **Step 1: Write lifecycle tests.** Assert summary transitions from queued to running to completed, partial success, all-failed, and all-canceled. Assert one child failure does not cancel siblings.
- [ ] **Step 2: Write cancel/retry tests.** Assert batch cancel updates queued/staging jobs directly and active jobs to `cancel_requested`; assert retry affects only failed/canceled children and preserves completed children. Test cross-user 404 behavior.
- [ ] **Step 3: Implement batch reads.** Return bounded child job lists in creation order, with pagination if needed beyond 50, and compute the aggregate summary from current rows instead of relying solely on mutable counters.
- [ ] **Step 4: Implement batch actions.** Use optimistic `version` checks for child updates, avoid illegal transitions, update `upload_attempts`, and dispatch workflows only for newly retried children. A repeated cancel/retry request must be idempotent for already-terminal/queued state.
- [ ] **Step 5: Harden workflow failure updates.** Ensure exceptions from remote fetch, Drive auth, size/protocol errors, and dispatch failures update the child job and its attempt row to `failed` with redacted, user-safe error fields. Ensure finalization cannot overwrite a canceled or failed child.
- [ ] **Step 6: Update cleanup.** Retain batch rows while any child job remains within configured history retention; delete orphaned batch rows after child history deletion. Add no raw URL data to batch cleanup logs.
- [ ] **Step 7: Run worker/workflow tests.** Run `npx vitest run test/worker/batches.test.ts test/worker/driveTransfer.test.ts test/worker/cleanup.test.ts`. Expected: lifecycle and existing transfer behavior pass.
- [ ] **Step 8: Commit.** `git add src/worker/routes/jobs.ts src/worker/services/jobRepository.ts src/worker/workflows/DriveTransfer.ts src/worker/scheduled/cleanup.ts test/worker/batches.test.ts && git commit -m "feat: manage batch lifecycle and actions"`

### Task 5: Add Typed Web Batch API and Folder Picker

**Files:**
- Modify: `src/web/api/jobs.ts`
- Modify: `src/web/api/drive.ts`
- Create or modify: `src/web/components/FolderPicker.tsx` if extraction is needed
- Create: `test/web/FolderPicker.test.tsx` if a new component is created

**Interfaces:**
- Produces `createBatchUpload`, `listBatches`, `getBatch`, `cancelBatch`, and `retryBatch` client functions.
- Produces a folder picker that returns `{ id: string | undefined; name: string }`, where `undefined` means Drive root.

- [ ] **Step 1: Add API client tests or request assertions.** Verify method, path, JSON body, idempotency header, and typed response for create/get/cancel/retry.
- [ ] **Step 2: Implement typed API functions.** Generate a UUID idempotency key by default, URL-encode batch IDs, and preserve the existing `apiRequest` CSRF behavior.
- [ ] **Step 3: Implement folder listing helper.** Add `listDriveFolders({ parentId, pageToken, pageSize })` if the existing endpoint response is sufficient; otherwise use `listDriveItems` and filter `isFolder`. Keep root selection explicit and provide page-token navigation.
- [ ] **Step 4: Implement folder picker states.** Support loading, root, nested navigation/breadcrumbs, empty folders, API errors, keyboard selection, and selected-folder display. Do not allow the importer to submit while folder validation is pending.
- [ ] **Step 5: Run web tests.** Run `npx vitest run test/web/FolderPicker.test.tsx` or the affected existing web suite. Expected: client and picker tests pass.
- [ ] **Step 6: Commit.** `git add src/web/api/jobs.ts src/web/api/drive.ts src/web/components/FolderPicker.tsx test/web/FolderPicker.test.tsx && git commit -m "feat: add batch API clients and folder picker"`

### Task 6: Build the Batch Importer UI

**Files:**
- Create: `src/web/uploads/BatchImporter.tsx`
- Modify: `src/web/uploads/UploadForm.tsx`
- Modify: `src/web/routes/UploaderPage.tsx`
- Create: `test/web/BatchImporter.test.tsx`

**Interfaces:**
- `BatchImporter` accepts `onBatchCreated: (response: CreateBatchResponse) => void` and renders paste/drop input, parsed item preview, folder picker, submit state, and validation errors.
- Existing single remote URL mode remains available and behaviorally unchanged.

- [ ] **Step 1: Write UI tests for paste parsing.** Render the uploader, select the batch mode, paste three URLs, assert three preview rows, the selected count, and the root-folder default.
- [ ] **Step 2: Write UI tests for `.txt` drop.** Drop a `.txt` file with valid lines, assert preview rows; drop an unsupported file and assert a visible error without submission.
- [ ] **Step 3: Write UI tests for validation.** Assert duplicate lines are marked, invalid lines show line-specific errors, 51 URLs disable submission, and submit is disabled while no valid items remain.
- [ ] **Step 4: Implement batch mode shell.** Add a clearly labeled `Batch URLs` mode beside Local File and Remote URL. Keep the existing component's styling language and responsive layout; avoid adding a separate page or marketing panel.
- [ ] **Step 5: Implement paste and drop handlers.** Accept only text drops/files, parse through `batchParser`, show accepted/invalid/duplicate counts, and cap preview rendering to 50 accepted rows.
- [ ] **Step 6: Implement per-item preview.** Show filename derived by the server by default, allow optional filename editing only when needed, show redacted/normalized URL host/path, and allow removing an item before submit. Removing an item must recompute the payload and counts.
- [ ] **Step 7: Implement submit flow.** Require a folder selection state to be resolved, call `createBatchUpload`, clear the importer only after a successful response, surface API errors without losing the parsed list, and call `onBatchCreated` with the returned batch ID available to the parent if needed.
- [ ] **Step 8: Run UI tests.** Run `npx vitest run test/web/BatchImporter.test.tsx test/web/Uploads.test.tsx`. Expected: new batch interactions pass and existing upload tests remain green.
- [ ] **Step 9: Commit.** `git add src/web/uploads/BatchImporter.tsx src/web/uploads/UploadForm.tsx src/web/routes/UploaderPage.tsx test/web/BatchImporter.test.tsx && git commit -m "feat: add bulk URL importer"`

### Task 7: Add Live Batch Progress and Batch Actions

**Files:**
- Create: `src/web/uploads/BatchProgress.tsx`
- Modify: `src/web/uploads/JobList.tsx`
- Modify: `src/web/routes/UploaderPage.tsx`
- Modify: `src/web/api/jobs.ts`
- Modify: `test/web/Uploads.test.tsx`

**Interfaces:**
- `BatchProgress` accepts a `BatchView`, child jobs, and refresh callback; it renders item counts, aggregate progress, destination folder, elapsed/updated state, cancel, and retry controls.
- `listJobs` gains optional batch summary retrieval only if the existing response cannot efficiently provide it; prefer a single batch endpoint plus existing job list polling.

- [ ] **Step 1: Write progress tests.** Cover 0/20, 10/20, 20/20 items; known and unknown byte totals; completed/partial/failed/canceled states; and child errors.
- [ ] **Step 2: Write action tests.** Assert cancel calls the batch endpoint and refreshes; retry is shown only for terminal batches with retryable failed/canceled children; completed children are not retried.
- [ ] **Step 3: Implement aggregate progress.** Prefer item-count percentage when remote sizes are unknown; use byte percentage when total known bytes is greater than zero, bounded to 0–100. Display `completed`, `failed`, `canceled`, and `active` counts separately.
- [ ] **Step 4: Implement child disclosure.** Group child jobs under a compact batch row, preserve each job's individual status/error/Drive link, and keep per-item cancel/retry available for detailed recovery.
- [ ] **Step 5: Implement polling integration.** On each existing two-second refresh, fetch active batches and their children without causing duplicate intervals. Use ETag/conditional requests where already supported and avoid polling batch details after all batches are terminal unless the user expands history.
- [ ] **Step 6: Update page composition.** Render the importer above batch progress and individual history. Ensure a newly submitted batch appears immediately from the create response or after one refresh.
- [ ] **Step 7: Run web tests.** Run `npx vitest run test/web/Uploads.test.tsx test/web/BatchImporter.test.tsx`. Expected: aggregate progress/actions and old upload UI pass.
- [ ] **Step 8: Commit.** `git add src/web/uploads/BatchProgress.tsx src/web/uploads/JobList.tsx src/web/routes/UploaderPage.tsx src/web/api/jobs.ts test/web/Uploads.test.tsx && git commit -m "feat: show live batch progress"`

### Task 8: Add Integration, E2E, Security, and Operations Coverage

**Files:**
- Modify: `test/worker/batches.test.ts`
- Modify: `test/web/Uploads.test.tsx`
- Create or modify: `test/e2e/batch-import.spec.ts`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/cloudflare-operations.md`
- Modify: `docs/data-retention.md` if retention behavior changes

**Interfaces:**
- Produces a repeatable validation path for parser, API, workflow dispatch, batch progress, cancellation, partial failure, and production rollout.

- [ ] **Step 1: Add worker integration coverage.** Test authenticated batch creation, no raw URL leakage in batch/job views, encrypted URL storage, SSRF rejection, folder authorization, idempotency replay, user isolation, limit atomicity, child workflow dispatch count, and partial failure summary.
- [ ] **Step 2: Add UI integration coverage.** Mock batch creation and polling responses; verify the user can paste/drop 20 URLs, select a nested folder, submit once, see `20 queued`, then see mixed progress and item errors.
- [ ] **Step 3: Add Playwright coverage.** Against the local dev server, exercise the importer at desktop and mobile viewports: paste 20 links, drop a text file, select a folder, submit, observe progress, cancel, and expand a failed item. Stub Google/remote transfer responses at the boundary rather than using real credentials.
- [ ] **Step 4: Add security assertions.** Verify URL query strings/fragments are absent from rendered history, API responses, logs tested through spies, and batch metadata; verify each batch route requires the current session and CSRF for mutating actions.
- [ ] **Step 5: Update architecture/operations docs.** Document the D1 batch aggregate, one-workflow-per-child concurrency model, 50-item and 25-active/100-daily limits, expected partial-success semantics, metrics (`batch_created`, `batch_completed`, `batch_partial`, `batch_failed`, `batch_canceled`, child dispatch failures), and alert thresholds.
- [ ] **Step 6: Run full verification.** Run `npm run type-check`, `npm run lint`, `npm test`, and `npm run test:e2e`. Expected: all commands exit 0. Run `npm run build` as the final artifact check.
- [ ] **Step 7: Commit.** `git add test ARCHITECTURE.md docs/cloudflare-operations.md docs/data-retention.md && git commit -m "test: verify bulk batch importer end to end"`

## Rollout and Acceptance Checklist

- [ ] Apply `migrations/0002_batch_imports.sql` locally, staging, and production through the repository's Wrangler migration commands before enabling the UI.
- [ ] Confirm the production `DRIVE_TRANSFER` binding supports at least 50 independent workflow instances per user submission and that provider/API quotas are monitored.
- [ ] Confirm a 50-item batch is rejected atomically when the user has fewer than 50 available active slots or daily slots.
- [ ] Confirm a 20-item batch creates 20 child jobs and 20 workflow instances, not one serial workflow.
- [ ] Confirm a failed URL does not prevent successful siblings from reaching Google Drive.
- [ ] Confirm cancellation stops queued items immediately and active items at their next cancellation checkpoint.
- [ ] Confirm batch retry does not duplicate completed Drive files or completed child jobs.
- [ ] Confirm browser refresh/reopen reconstructs active batch progress from D1.
- [ ] Confirm `.txt` parsing works on Windows CRLF files and does not upload the text file itself.
- [ ] Confirm remote URLs remain encrypted at rest and redacted in every user-visible/API batch response.
- [ ] Confirm existing single-URL remote upload, local multipart upload, job history, per-job cancel/retry, and folder browsing remain unchanged.

## Self-Review

- **Spec coverage:** Paste input, `.txt` drag/drop, 10–50 target use case, bounded 1–50 validation, selected Drive folder, parallel cloud transfers, live batch progress, cancellation, retries, partial failures, limits, security, persistence, and rollout are covered above.
- **No placeholders:** The plan names files, functions, routes, schemas, test commands, expected outcomes, and exact failure semantics; it does not defer implementation to unspecified follow-up work.
- **Type consistency:** `CreateBatchRequest` feeds `POST /api/v1/jobs/batch`; `CreateBatchResponse` feeds `BatchImporter.onBatchCreated`; `BatchView`/child jobs feed list/detail batch routes; parser output is converted to `items`; folder picker returns the `folderId` consumed by batch creation; retry/cancel API names match worker routes.
- **Known scope boundary:** This plan intentionally does not change the extension's legacy multi-account uploader. The requested cloud batch importer belongs to the authenticated web upload flow and reuses its durable job/workflow architecture.
