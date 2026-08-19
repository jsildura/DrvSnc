# Task 7: Implement Durable Job Repository And Job APIs

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Create: `src/worker/services/jobRepository.ts`
- Create: `src/worker/routes/jobs.ts`
- Create: `test/worker/jobs.test.ts`
- Modify: `src/worker/index.ts`

**Interfaces:**
- Consumes: `UploadJobView`, state rules, authenticated user credential, Workflow bindings.
- Produces: `createRemoteJob`, `createLocalJob`, `getJob`, `listJobs`, `requestCancel`, `retryJob`, `updateProgress`, `completeJob`, `failJob`, and job/history routes.

- [x] **Step 1: Write failing lifecycle tests**

Cover idempotency key reuse, user ownership, active/history pagination, optimistic versions, invalid state transitions, daily and concurrency limits, cancellation of each non-terminal status, retry only from failed, duplicate Workflow completion, source URL redaction, and safe error persistence.

- [x] **Step 2: Implement repository transitions**

Wrap each transition in a D1 batch/conditional update using `WHERE user_id = ? AND id = ? AND version = ? AND status IN (...)`. Insert an `upload_attempts` row per Workflow start. Persist progress only when status changes, at least 1 MiB advances, or five seconds elapsed to cap write volume.

- [x] **Step 3: Implement job routes**

Require `Idempotency-Key` for job creation. Remote creation validates URL policy before inserting; local creation inserts `staging`. Cancel sets `cancel_requested` and terminates/signals the bound Workflow. Retry increments attempts and creates a new Workflow ID. History deletion removes terminal metadata only and never touches Drive files.

- [x] **Step 4: Add cache-aware polling**

Return an ETag derived from maximum `updated_at` and result count. Honor `If-None-Match` with 304. Support `active=true`, cursor pagination, and `since` timestamps while always filtering by user.

- [x] **Step 5: Verify durable job behavior**

Run `npm test -- test/worker/jobs.test.ts`, type-check, and lint. Add a concurrency test issuing duplicate cancel/complete calls and assert one valid terminal outcome with no status regression.

- [x] **Step 6: Commit**

```bash
git add src/worker/services/jobRepository.ts src/worker/routes/jobs.ts src/worker/index.ts test/worker/jobs.test.ts
git commit -m "feat: add durable upload job API"
```
