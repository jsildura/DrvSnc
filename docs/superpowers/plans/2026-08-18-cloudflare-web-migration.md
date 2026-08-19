# Cloudflare Web Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Manifest V3 Chrome extension with a responsive, multi-user web application hosted on Cloudflare while preserving URL/local uploads and Google Drive management.

**Architecture:** Deploy the React SPA and an authenticated Hono API as one Cloudflare Worker with static assets. Each Google identity is a separate app user with one active Drive context; users switch accounts by logging out and completing Google OAuth for another identity. Keep Google OAuth and Drive tokens server-side, store relational state in D1, stage local files in private R2, and execute durable uploads through Cloudflare Workflows; the browser polls durable job records for progress. Preserve the extension during migration, but do not carry extension-only context menus, content-script blob capture, Chrome notifications, GitHub Actions, Apps Script, or Cloud Run into the initial web product.

**Tech Stack:** React 18, TypeScript, Vite, Material UI, Hono, Zod, Cloudflare Workers Static Assets, D1, R2 multipart uploads, Cloudflare Workflows, Vitest, React Testing Library, Playwright, Wrangler.

## Global Constraints

- Use a Cloudflare Workers Paid plan for production; the free plan's 10 ms CPU budget is not a supported production target.
- Serve the SPA and `/api/v1/*` from one origin so authentication can use `Secure`, `HttpOnly`, `SameSite=Lax` cookies without CORS.
- Never expose Google access tokens, refresh tokens, the Google client secret, GitHub PATs, or encryption keys to browser JavaScript.
- Rotate the Google OAuth secret currently present in `src/lib/auth.ts` before any public deployment; do not copy it into the new application.
- Use a new Google OAuth **Web application** client with exact callback `${APP_ORIGIN}/api/v1/auth/google/callback`.
- Retain the full `https://www.googleapis.com/auth/drive` scope because file browsing, sharing, and trash management require it; document and complete Google's sensitive-scope verification before public launch.
- Store refresh tokens encrypted with AES-GCM using the Worker secret `TOKEN_ENCRYPTION_KEY`; store session tokens only as SHA-256 hashes.
- Never store Google passwords, OAuth codes, access tokens, refresh tokens, ID tokens, app session tokens, or CSRF tokens in `localStorage` or IndexedDB.
- `localStorage` may contain only remembered account hints: Google subject, email, display name, picture URL, and last-used timestamp. Selecting one always starts a fresh OAuth flow with `login_hint`; it never authenticates locally.
- Treat D1 as metadata storage only. File bytes and download bytes must never be stored in D1 or encoded as base64 JSON.
- Keep the R2 bucket private. Temporary object keys must be `users/{userId}/jobs/{jobId}/{randomId}` and deleted after success, cancellation, or seven days.
- Stage local uploads through R2 multipart upload; do not proxy large browser request bodies through the Worker.
- Stream remote/R2 content to Google resumable uploads in fixed chunks; never call `arrayBuffer()`, `blob()`, or `text()` on unbounded file bodies.
- Allow remote upload sources only over `https:`. Reject credentials in URLs, localhost, private/link-local/loopback/reserved IPs, Cloudflare/Google metadata hosts, and redirects that resolve to a blocked destination.
- Sanitize source URLs before persistence and logging by removing user info, fragments, and query strings; retain only the origin and path in `source_url_redacted`.
- Enforce an initial 5 GiB product upload limit, 25 concurrent active jobs per user, and 100 new jobs per user per day; expose limits as server configuration, not browser constants.
- Use polling with `ETag`/`updatedAt` every two seconds for active jobs in v1. Do not add WebSockets or SSE until measured polling load justifies them.
- Keep the current extension files operational until the production cutover task. Do not rewrite `src/sw.ts` incrementally into a Worker.
- Keep API request/response contracts in `src/shared/contracts.ts` and validate every mutation payload with Zod.
- Every D1 query for user-owned data must include the authenticated `user_id`; a bare lookup by job ID, file operation ID, or Google file ID is prohibited.
- All destructive Drive operations require a CSRF token and explicit UI confirmation.
- Do not log OAuth codes, cookies, authorization headers, source query strings, tokens, file bytes, or Google API response bodies that may contain user data.
- Development, staging, and production use separate D1 databases, R2 buckets, OAuth callbacks, cookie names, and secrets.
- Existing dirty worktree changes are user-owned. Implementation must not revert or overwrite unrelated changes.

---

## Product Scope And Decisions

### Included In Web V1

- Google sign-in with exactly one active Google Drive account per app session.
- A browser-local remembered-account chooser for users who log out and later sign in with another Google identity.
- URL upload and local file upload with durable status, cancellation, retry, and history.
- Folder browsing and creation, My Drive navigation, search, Shared with me, storage quota, preview, and the current user's last folder.
- Rename, move, trash, restore, permanent delete, empty trash, sharing permissions, and downloads/exports.
- Existing Material UI themes and responsive desktop/mobile layouts.
- Server-side preferences, auditing, retention cleanup, operational metrics, staged deployment, and rollback.

### Explicitly Removed From Web V1

- Chrome context-menu upload, arbitrary-tab selected-text capture, and page-scoped `blob:` URL capture. A normal website cannot provide these capabilities.
- Chrome popup/options entry points, content script, extension background service worker, Chrome alarms, Chrome notifications, and Chrome storage.
- Per-user GitHub Actions, Apps Script, and Cloud Run setup. Cloudflare Workflows become the only hosted upload orchestrator.
- Returning `GET_VALID_TOKEN` or any equivalent raw-token endpoint to the browser.
- Connecting multiple Google accounts to one app session, switching accounts without logout, and cross-account Drive copy.
- Migration of extension-local accounts, tokens, settings, or history. Automatic extraction would require retaining privileged extension code and moving credentials across a new trust boundary. Users reconnect Google accounts and start with clean server-side history.

### Deferred Decision

After web v1 reaches production parity, decide whether context-menu capture warrants a separate minimal companion-extension plan. That extension may capture a URL and pair to the hosted account, but must not store Google tokens or own upload jobs.

## Target Request Flows

### Authentication

1. Browser requests `GET /api/v1/auth/google/start`; it may include a remembered email as `login_hint`.
2. Worker creates signed, short-lived OAuth state and PKCE verifier records, then redirects to Google.
3. Google returns to `/api/v1/auth/google/callback`; Worker validates state, exchanges the code, fetches profile data, encrypts the refresh token, and creates a hashed application session.
4. Browser receives only `gdu_session` and readable `gdu_csrf` cookies. `/api/v1/session` returns the active user's safe profile.
5. Browser stores that safe profile in `localStorage.gdu_remembered_accounts`, keyed by Google subject and capped at five entries.
6. Logout invalidates the app session and clears session-scoped UI state, but leaves remembered profile hints when `rememberAccount=true`.
7. Choosing another remembered account starts Google OAuth with `prompt=select_account` and `login_hint`; Google, not the app, authenticates the account.

### Local Upload

1. Browser creates a job with `POST /api/v1/jobs/local` and receives R2 multipart-upload metadata.
2. Browser uploads fixed-size parts directly to private R2 using short-lived signed part URLs and reports each part ETag.
3. Browser completes the multipart upload through `POST /api/v1/jobs/:jobId/local/complete`.
4. Worker atomically moves the D1 job from `staging` to `queued` and starts `DriveTransferWorkflow` with `source.kind = 'r2'`.
5. Workflow refreshes the authenticated user's Google token, starts a Google resumable upload, streams R2 chunks, writes durable progress, and deletes the temporary object on terminal success/cancellation.

### Remote URL Upload

1. Browser sends `POST /api/v1/jobs/remote` with URL, filename, and destination folder; the account is derived exclusively from the authenticated session.
2. Worker performs syntax and DNS/IP policy validation, redacts the URL for D1, encrypts the full source URL for the workflow, creates a queued job, and starts `DriveTransferWorkflow` with `source.kind = 'remote'`.
3. Workflow revalidates every redirect, probes size/type, starts a Drive resumable session, transfers bounded chunks, and persists progress.
4. Browser polls `GET /api/v1/jobs?active=true&since=...` and renders the durable status.

### Download

1. Browser navigates to `GET /api/v1/drive/files/:fileId/download?format=...`.
2. Worker checks ownership, resolves the Google token server-side, fetches/export streams from Drive, sets sanitized `Content-Disposition`, and pipes the response to the browser.
3. Downloads are not represented as base64, R2 objects, or in-memory chunk maps.

## State Model

`UploadJobStatus` is:

```ts
export const uploadJobStatuses = [
  'staging',
  'queued',
  'fetching',
  'uploading',
  'completed',
  'failed',
  'cancel_requested',
  'canceled',
] as const;
```

Allowed transitions are:

```text
staging -> queued | canceled | failed
queued -> fetching | uploading | cancel_requested | failed
fetching -> uploading | cancel_requested | failed
uploading -> completed | cancel_requested | failed
cancel_requested -> canceled | completed | failed
failed -> queued
completed -> terminal
canceled -> terminal
```

Retry creates a new Workflow instance for the same job, increments `attempt_count`, clears provider session state, and transitions `failed -> queued`. Mutations use `version = version + 1` optimistic concurrency so duplicate callbacks or retries cannot regress terminal state.

## API Contract

All responses use JSON except OAuth redirects, R2 part uploads, and Drive download streams. Failures use:

```ts
export type ApiError = {
  error: {
    code: string;
    message: string;
    retriable: boolean;
    requestId: string;
  };
};
```

Core endpoints:

```text
GET    /api/v1/health
GET    /api/v1/auth/google/start
GET    /api/v1/auth/google/callback
POST   /api/v1/auth/logout
GET    /api/v1/session
DELETE /api/v1/account
PATCH  /api/v1/preferences
GET    /api/v1/preferences
POST   /api/v1/jobs/local
POST   /api/v1/jobs/:jobId/local/part-url
POST   /api/v1/jobs/:jobId/local/complete
POST   /api/v1/jobs/remote
GET    /api/v1/jobs
GET    /api/v1/jobs/:jobId
POST   /api/v1/jobs/:jobId/cancel
POST   /api/v1/jobs/:jobId/retry
DELETE /api/v1/jobs/history
GET    /api/v1/drive/folders
POST   /api/v1/drive/folders
GET    /api/v1/drive/items
GET    /api/v1/drive/search
GET    /api/v1/drive/shared
GET    /api/v1/drive/trash
GET    /api/v1/drive/quota
PATCH  /api/v1/drive/items/:fileId
POST   /api/v1/drive/items/:fileId/trash
POST   /api/v1/drive/items/:fileId/restore
DELETE /api/v1/drive/items/:fileId
POST   /api/v1/drive/trash/empty
GET    /api/v1/drive/files/:fileId/download
GET    /api/v1/drive/files/:fileId/permissions
POST   /api/v1/drive/files/:fileId/permissions
PATCH  /api/v1/drive/files/:fileId/permissions/:permissionId
DELETE /api/v1/drive/files/:fileId/permissions/:permissionId
```

## Planned File Structure

```text
index.html                              Web SPA entry document
src/web/main.tsx                        React bootstrap
src/web/App.tsx                         Session gate, routes, theme shell
src/web/routes/UploaderPage.tsx         URL/local upload and jobs
src/web/routes/DrivePage.tsx            File browser route
src/web/routes/SettingsPage.tsx         Preferences/account route
src/web/api/client.ts                   Typed fetch + CSRF + error mapping
src/web/api/jobs.ts                     Job polling and upload client
src/web/api/drive.ts                    Drive metadata/download client
src/web/auth/AuthGate.tsx               Web OAuth sign-in UI
src/web/auth/rememberedAccounts.ts      Safe local account-hint storage
src/web/state/AppProvider.tsx            Session/account/preferences state
src/shared/contracts.ts                 Zod API schemas and safe DTOs
src/shared/jobState.ts                  Job transition rules
src/worker/index.ts                     Hono app and static asset fallback
src/worker/env.ts                       Cloudflare bindings and secrets types
src/worker/middleware/session.ts        Session authentication
src/worker/middleware/csrf.ts           Mutation CSRF validation
src/worker/routes/auth.ts               OAuth/session/logout routes
src/worker/routes/account.ts            Current account deletion/revocation
src/worker/routes/preferences.ts        Preference routes
src/worker/routes/jobs.ts               Upload job routes
src/worker/routes/drive.ts              Drive metadata/share/download routes
src/worker/services/crypto.ts           AES-GCM and token hashing
src/worker/services/googleAuth.ts       OAuth exchange/refresh/revoke
src/worker/services/driveClient.ts      Server-side Drive API adapter
src/worker/services/jobRepository.ts    Durable job transitions
src/worker/services/remoteUrlPolicy.ts  SSRF and redirect policy
src/worker/services/r2Multipart.ts      Multipart staging lifecycle
src/worker/workflows/DriveTransfer.ts   Local/remote transfer workflow
src/worker/scheduled/cleanup.ts         Session/R2/job retention cleanup
migrations/0001_initial.sql             D1 schema and indexes
config/r2-cors.json                     Exact-origin browser upload CORS policy
test/unit/*                             Pure contract/state/security tests
test/worker/*                           Worker route and repository tests
test/web/*                              React component tests
test/e2e/*                              Playwright user flows
wrangler.jsonc                          Worker, assets, D1, R2, Workflow bindings
vitest.config.ts                        Unit/integration test configuration
playwright.config.ts                    Browser test configuration
.dev.vars.example                      Non-secret local variable names
.github/workflows/ci.yml                Type, lint, test, build, dry-run deploy
docs/cloudflare-operations.md           Deploy, rollback, rotation, restore runbook
docs/privacy.md                         Hosted-product privacy policy
```

The existing `src/popup/*`, reusable `src/components/*`, theme files, and Drive UI are migrated incrementally. Multi-account and cross-account copy controls are removed during component migration. The existing `src/sw.ts`, `src/content.ts`, `manifest.json`, `src/lib/auth.ts`, `src/lib/messaging.ts`, `src/lib/fileStorage.ts`, GitHub Actions uploader, and Cloud Run uploader remain untouched until cutover.

---

## Task Index

All task files inherit Global Constraints and must execute in order.

1. [Task 1: Lock Scope, Rotate Credentials, And Establish Baselines](2026-08-18-cloudflare-web-migration/task-01-lock-scope-and-baselines.md)
2. [Task 2: Scaffold The Cloudflare Full-Stack Runtime](2026-08-18-cloudflare-web-migration/task-02-scaffold-cloudflare-runtime.md)
3. [Task 3: Define Contracts, D1 Schema, And Job State Rules](2026-08-18-cloudflare-web-migration/task-03-contracts-schema-job-state.md)
4. [Task 4: Implement Encryption, Sessions, CSRF, And Google OAuth](2026-08-18-cloudflare-web-migration/task-04-auth-sessions-csrf.md)
5. [Task 5: Add Current Account And Preference APIs](2026-08-18-cloudflare-web-migration/task-05-account-preferences-api.md)
6. [Task 6: Build The Server-Side Drive API Adapter](2026-08-18-cloudflare-web-migration/task-06-drive-api-adapter.md)
7. [Task 7: Implement Durable Job Repository And Job APIs](2026-08-18-cloudflare-web-migration/task-07-durable-job-api.md)
8. [Task 8: Stage Local Files With Private R2 Multipart Uploads](2026-08-18-cloudflare-web-migration/task-08-r2-multipart-staging.md)
9. [Task 9: Enforce Remote URL And SSRF Policy](2026-08-18-cloudflare-web-migration/task-09-remote-url-ssrf-policy.md)
10. [Task 10: Implement The Durable Drive Transfer Workflow](2026-08-18-cloudflare-web-migration/task-10-drive-transfer-workflow.md)
11. [Task 11: Add Remembered Account Hints And Durable Batch Trash](2026-08-18-cloudflare-web-migration/task-11-remembered-accounts-batch-trash.md)
12. [Task 12: Build The Typed Web Client And Session Shell](2026-08-18-cloudflare-web-migration/task-12-web-client-session-shell.md)
13. [Task 13: Migrate Upload UI, Multipart Client, Jobs, And History](2026-08-18-cloudflare-web-migration/task-13-upload-ui-and-jobs.md)
14. [Task 14: Migrate Drive Browser, Search, Sharing, Preview, And Downloads](2026-08-18-cloudflare-web-migration/task-14-drive-management-ui.md)
15. [Task 15: Migrate Settings And Remove Personal Backend Configuration](2026-08-18-cloudflare-web-migration/task-15-settings-migration.md)
16. [Task 16: Add Retention, Abuse Controls, Auditing, And Observability](2026-08-18-cloudflare-web-migration/task-16-retention-abuse-observability.md)
17. [Task 17: Complete Security, Privacy, And Google Compliance](2026-08-18-cloudflare-web-migration/task-17-security-privacy-compliance.md)
18. [Task 18: Add End-To-End Coverage And Performance Gates](2026-08-18-cloudflare-web-migration/task-18-e2e-performance.md)
19. [Task 19: Add CI/CD, Environments, Migrations, And Operations Runbook](2026-08-18-cloudflare-web-migration/task-19-cicd-operations.md)
20. [Task 20: Stage Rollout, Cut Over, And Archive Extension Backends](2026-08-18-cloudflare-web-migration/task-20-rollout-cutover.md)

## Release Checklist

- [x] New Google Web OAuth credentials are active; the exposed old secret is revoked.
- [x] Google OAuth consent/verification is approved for the intended audience.
- [x] No browser response, source map, log, or error contains provider/application secrets.
- [x] Two-user IDOR, CSRF, XSS/CSP, SSRF/rebinding, replay, and abuse suites pass.
- [x] Local and remote uploads pass at every benchmark size supported by the published limit.
- [x] Forced Workflow interruption resumes without duplicate Drive files.
- [x] Account removal revokes access and prevents future refresh.
- [x] R2 staging is private and retention cleanup is verified.
- [x] D1 Time Travel restore and Worker rollback are rehearsed.
- [x] Desktop/mobile screenshots and accessibility checks pass.
- [x] Privacy, retention, terms, support, and incident contacts are public and accurate.
- [x] Legacy backend credentials are revoked only after the 30-day observation gate.

## Cloudflare References

- Workers Static Assets and SPA routing: `https://developers.cloudflare.com/workers/static-assets/`
- Workers limits, including 128 MB memory and request body limits: `https://developers.cloudflare.com/workers/platform/limits/`
- Workflows durable steps and retries: `https://developers.cloudflare.com/workflows/`
- R2 multipart/object limits: `https://developers.cloudflare.com/r2/platform/limits/`
- D1 limits and Time Travel: `https://developers.cloudflare.com/d1/platform/limits/`

## Definition Of Complete

The migration is complete only when the canonical domain provides every included v1 workflow without extension APIs; Google credentials remain server-side; remembered browser entries contain profile hints only; uploads survive browser closure and Worker redeployment; security/compliance and large-file gates pass; rollback has been rehearsed; old upload backends are decommissioned after the observation period; and canonical documentation no longer directs users to install the extension.
