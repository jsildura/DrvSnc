# Task 11: Add Remembered Account Hints And Durable Batch Trash

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Create: `src/web/auth/rememberedAccounts.ts`
- Create: `test/unit/rememberedAccounts.test.ts`
- Create: `test/worker/batchTrash.test.ts`
- Modify: `src/worker/index.ts`

**Interfaces:**
- Consumes: safe `SessionView` profile and authenticated trash routes.
- Produces: `RememberedAccount`, `listRememberedAccounts`, `rememberAccount`, `forgetRememberedAccount`, `clearRememberedAccounts`, and durable empty-trash progress.

- [x] **Step 1: Define and test remembered-account storage**

Define `RememberedAccount` as `{ sub, email, name?, picture?, lastUsedAt }`. Test malformed JSON recovery, strict field filtering, deduplication by `sub`, newest-first ordering, five-entry eviction, explicit forget/clear, safe picture URL validation, and rejection/removal of objects containing token, credential, session, or arbitrary extra fields.

- [x] **Step 2: Implement safe local profile hints**

Store one versioned JSON array under `localStorage.gdu_remembered_accounts`. Populate it only from a successful server `SessionView`, never from OAuth URL parameters or ID-token parsing. Selecting an entry creates `/api/v1/auth/google/start?login_hint=<encoded-email>`; forgetting it changes browser UI only and does not revoke server credentials.

- [x] **Step 3: Specify logout behavior**

`POST /api/v1/auth/logout` always invalidates the HttpOnly server session and clears the CSRF cookie. The UI clears user-specific caches and multipart-resume metadata; with `rememberAccount=true` it retains the safe account hint, and with `rememberAccount=false` it removes that hint. The remembered-account list must never imply that the user is authenticated.

- [x] **Step 4: Make empty trash durable**

Change `POST /drive/trash/empty` to create a durable batch job that pages through items, permanently deletes with bounded concurrency, records per-item failures, and reports aggregate progress. Never run an unbounded trash loop in one HTTP request.

- [x] **Step 5: Verify account switching and batch trash**

Sign in as test account A, log out while remembering it, sign in as B, and verify A's jobs/preferences/Drive data are inaccessible. Choose A's remembered hint and verify Google OAuth is still required. Inspect localStorage and IndexedDB for password/token/session fields. Run empty trash against disposable fixtures and verify every result is auditable.

- [x] **Step 6: Commit**

```bash
git add src/web/auth/rememberedAccounts.ts src/worker/index.ts test/unit/rememberedAccounts.test.ts test/worker/batchTrash.test.ts
git commit -m "feat: remember safe account login hints"
```
