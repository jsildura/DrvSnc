# Task 10: Implement The Durable Drive Transfer Workflow

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Create: `src/worker/workflows/DriveTransfer.ts`
- Create: `test/worker/driveTransfer.test.ts`
- Modify: `src/worker/index.ts`
- Modify: `src/worker/env.ts`
- Modify: `wrangler.jsonc`

**Interfaces:**
- Consumes: `{ jobId, userId, attempt }`, job repository, Drive client, URL policy, and R2.
- Produces: durable local/remote transfer, provider-resume state, measured progress, cleanup, retry, cancellation, and terminal job result.

- [x] **Step 1: Write failing workflow tests**

Cover local and remote sources; known/unknown length; redirect policy; 8 MiB chunk boundaries; Google 308 offset reconciliation; transient source/Google errors; expired access token; Workflow replay; cancellation between chunks; completion racing cancellation; R2 cleanup; checksum/size mismatch; and terminal error mapping.

- [x] **Step 2: Implement durable preparation steps**

Load the job by `(userId, jobId, attempt)`, reject stale/terminal attempts, transition to `fetching` or `uploading`, resolve source metadata, refresh the Google token, and start a resumable session. Persist the resumable session URL encrypted in `upload_attempts` with expiry/offset.

- [x] **Step 3: Implement bounded chunk transfer**

Read at most 8 MiB from the remote response or R2 range into memory, upload with exact `Content-Range`, persist confirmed offset, then release buffers before the next chunk. For unknown source lengths, stage the remote object in R2 first so Google receives a known total; enforce the 5 GiB cap while staging.

- [x] **Step 4: Implement retry and offset recovery**

Retry 408/429/5xx and network errors with bounded exponential backoff and jitter. Before retrying a chunk, query Google's resumable session offset and resume from Google's confirmed byte. Do not retry policy violations, 4xx source errors other than 408/429, revoked OAuth, Drive permission errors, or quota exhaustion.

- [x] **Step 5: Implement cancellation and cleanup**

Check `cancel_requested` before each source read and Drive write. Abort source reads, terminate the Workflow, mark canceled, and delete/abort R2 staging. Completion wins only if Drive has already returned a file ID; record an audit event when completion races cancellation.

- [x] **Step 6: Verify replay and resource bounds**

Run workflow tests, then staging transfers for 1 MiB, 8 MiB, 100 MiB, and the agreed maximum benchmark fixture. Interrupt/redeploy during the 100 MiB transfer and verify it resumes without duplicate Drive files. Confirm peak Worker memory under 96 MiB and D1 progress writes within the throttling rule.

- [x] **Step 7: Create a fallback gate**

If the maximum-size staging test cannot reliably complete across runtime updates/source stalls, keep Cloudflare as UI/API/control plane but implement a separately planned container transfer worker before launch. Do not silently lower the documented limit or retain GitHub Actions as an undocumented fallback.

- [x] **Step 8: Commit**

```bash
git add src/worker/workflows/DriveTransfer.ts src/worker/index.ts src/worker/env.ts wrangler.jsonc test/worker/driveTransfer.test.ts
git commit -m "feat: execute durable Drive transfers"
```
