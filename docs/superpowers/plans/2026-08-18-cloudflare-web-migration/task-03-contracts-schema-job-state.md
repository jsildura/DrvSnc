# Task 3: Define Contracts, D1 Schema, And Job State Rules

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Create: `src/shared/contracts.ts`
- Create: `src/shared/jobState.ts`
- Create: `migrations/0001_initial.sql`
- Create: `test/unit/contracts.test.ts`
- Create: `test/unit/jobState.test.ts`
- Create: `test/worker/schema.test.ts`

**Interfaces:**
- Produces: `SessionView`, `AccountView`, `PreferencesView`, `UploadJobView`, `ApiError`, Zod request schemas, `canTransition(from, to)`, and the D1 tables consumed by all repositories/routes.

- [x] **Step 1: Write failing schema and state tests**

Assert that browser DTOs reject token-like fields; remote job input rejects non-HTTPS URLs and overlong filenames; local job input requires `size` between 1 and 5 GiB; job transitions match the state table above; every user-owned table has `user_id`; foreign keys are enabled; and indexes support account/job/history queries.

- [x] **Step 2: Run tests and confirm failure**

Run `npm test -- test/unit/contracts.test.ts test/unit/jobState.test.ts test/worker/schema.test.ts`. Expected: missing modules/migration failures.

- [x] **Step 3: Define safe contracts**

Use strict Zod objects. `AccountView` contains only `id`, `email`, `name`, `picture`, `createdAt`, `lastUsedAt`, and `revokedAt`. `UploadJobView` contains IDs, source kind, redacted URL, filename, MIME type, destination, status, byte counters, attempt count, safe error code/message, Drive result, timestamps, and version. It contains no source secret, R2 key, Workflow ID, resumable URL, or OAuth data.

- [x] **Step 4: Create the initial schema**

Create tables `users`, `google_credentials`, `oauth_states`, `sessions`, `preferences`, `upload_jobs`, `upload_attempts`, and `audit_events`. Make Google subject unique in `users` and enforce exactly one `google_credentials` row per user with `user_id` as its primary/foreign key. Store encrypted values as `ciphertext`, `iv`, and `key_version`; store one default folder ID/name in preferences. Add uniqueness on hashed session token and Workflow instance ID. Add ownership indexes `(user_id, id)` and history index `(user_id, created_at DESC)`.

- [x] **Step 5: Implement transition validation**

Export `canTransition`, `assertTransition`, and `isTerminalStatus`; reject all unspecified transitions and terminal regressions.

- [x] **Step 6: Verify contracts and migration**

Run `npm run db:migrate:local`, all three tests, `npm run type-check`, and `npm run lint`. Expected: valid migration and passing tests.

- [x] **Step 7: Commit**

```bash
git add src/shared migrations test/unit test/worker/schema.test.ts
git commit -m "feat: define web contracts and durable state"
```
