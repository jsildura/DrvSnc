# Task 16: Add Retention, Abuse Controls, Auditing, And Observability

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Create: `src/worker/scheduled/cleanup.ts`
- Create: `src/worker/middleware/rateLimit.ts`
- Create: `src/worker/services/audit.ts`
- Create: `test/worker/cleanup.test.ts`
- Create: `test/worker/rateLimit.test.ts`
- Modify: `src/worker/index.ts`
- Modify: `wrangler.jsonc`

**Interfaces:**
- Produces: per-user/IP mutation rate limits, audit events, daily cleanup, correlation IDs, and platform metrics/log fields.

- [x] **Step 1: Write failing retention and abuse tests**

Cover 100 job creations/day/user, 25 active jobs/user, burst auth limits by IP, retry/cancel exceptions, seven-day abandoned R2 cleanup, 30-day session expiry, 90-day job-detail redaction, orphan multipart abort, stale Workflow reconciliation, and audit redaction.

- [x] **Step 2: Implement rate limits**

Use Cloudflare Rate Limiting bindings where available, backed by D1 counters for product quotas that require exact per-user accounting. Fail closed for auth/job mutations and return `429` with `Retry-After`; do not rate-limit static assets or active-job polling with the mutation policy.

- [x] **Step 3: Implement scheduled cleanup**

Daily cron expires sessions/OAuth states, aborts stale multipart uploads, deletes temporary R2 objects, marks unrecoverable jobs failed, reconciles Workflow status, and redacts old source paths/errors while retaining aggregate audit data. Process bounded pages and persist a cleanup cursor.

- [x] **Step 4: Add structured observability**

Generate `requestId` for each API request and include only route template, status, latency, user hash, job hash, bytes, provider status class, Workflow step, retry count, and error code. Add alerts for OAuth failure rate, stuck jobs, cleanup failures, Drive 401/403/429 spikes, Workflow failure rate, and R2 orphan growth.

- [x] **Step 5: Verify controls**

Run retention/rate tests and a staging abuse script. Inspect logs with seeded secret/query values and assert they do not appear. Trigger a synthetic failed Workflow and verify the alert path.

- [x] **Step 6: Commit**

```bash
git add src/worker/scheduled src/worker/middleware/rateLimit.ts src/worker/services/audit.ts src/worker/index.ts wrangler.jsonc test/worker/cleanup.test.ts test/worker/rateLimit.test.ts
git commit -m "feat: add hosted service safeguards"
```
