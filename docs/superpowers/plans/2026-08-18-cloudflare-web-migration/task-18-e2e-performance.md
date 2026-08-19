# Task 18: Add End-To-End Coverage And Performance Gates

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Create: `playwright.config.ts`
- Create: `test/e2e/auth.spec.ts`
- Create: `test/e2e/uploads.spec.ts`
- Create: `test/e2e/drive.spec.ts`
- Create: `test/e2e/settings.spec.ts`
- Create: `test/e2e/accessibility.spec.ts`
- Create: `test/performance/transfer-benchmark.md`

**Interfaces:**
- Produces: release-blocking browser suite and measured service limits.

- [x] **Step 1: Implement deterministic local E2E fixtures**

Mock Google OAuth/Drive at the Worker service boundary for CI while exercising real Hono routes, D1, R2, and Workflow test bindings. Seed two separate app users, each with one Google identity, so ownership tests are meaningful.

- [x] **Step 2: Cover primary journeys**

Test login, remembered-account logout, logout-and-forget, sign-in as another Google identity, URL upload, local multipart upload, refresh/recovery, cancel/retry, history, folder/create/search/shared/trash, rename/move/share/download, settings, account deletion, and expired/revoked sessions.

- [x] **Step 3: Add real-provider staging smoke tests**

Run a separate non-PR job/manual release gate against dedicated Google fixtures for OAuth, remembered-account selection, logout/login as a different identity, list, small local upload, remote upload, download/export, permission add/remove, cleanup, and token revocation. Restore fixtures even on failure.

- [x] **Step 4: Add viewport and accessibility gates**

Run Chromium at 360x800, 768x1024, and 1440x900. Assert no horizontal overflow/overlap, keyboard reachability, visible focus, dialog focus trap, labels, progress announcements, and acceptable automated accessibility results.

- [x] **Step 5: Benchmark transfers**

Measure 1 MiB, 8 MiB, 100 MiB, 1 GiB, and 5 GiB or the largest practical fixture over local and remote paths. Record duration, memory, CPU, D1 writes, Workflow retries, R2 storage duration, Drive duplicates, and cost estimate. Production acceptance requires zero duplicate files, resumability after one forced interruption, and memory below 96 MiB.

- [x] **Step 6: Verify full suite**

Run `npm test`, `npm run test:e2e`, `npm run type-check`, `npm run lint`, `npm run build`, and `npx wrangler deploy --dry-run`. Expected: all release gates pass.

- [x] **Step 7: Commit**

```bash
git add playwright.config.ts test/e2e test/performance
git commit -m "test: cover Cloudflare web workflows"
```
