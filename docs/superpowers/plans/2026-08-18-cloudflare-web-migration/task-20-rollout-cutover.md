# Task 20: Stage Rollout, Cut Over, And Archive Extension Backends

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `DEPLOYMENT.md`
- Modify: `SETUP.md`
- Modify: `PRD.md`
- Modify: `CHANGELOG.md`
- Move: `manifest.json` to `legacy-extension/manifest.json`
- Move: `src/sw.ts` to `legacy-extension/src/sw.ts`
- Move: `src/content.ts` to `legacy-extension/src/content.ts`
- Move: `cloudrun-remote-uploader/` to `legacy-extension/cloudrun-remote-uploader/`
- Move: `github-actions-uploader/` to `legacy-extension/github-actions-uploader/`

**Interfaces:**
- Consumes: all passing release gates and approved Google OAuth production client.
- Produces: production web app as the canonical product, documented legacy source, and decommissioned old backends.

- [x] **Step 1: Run an internal alpha**

Enable only allowlisted users for at least seven days. Require successful OAuth/logout/account switching/account deletion, 100+ mixed uploads, forced retries/cancellations, Drive CRUD/share/search/download, no cross-user access, no secret in browser storage, no stuck job older than one hour, and no orphan R2 object older than retention.

- [x] **Step 2: Run a limited beta**

Enable 10% of invited users for at least seven days. Gate expansion on upload success >= 99% excluding source/Google user errors, API 5xx < 0.5%, p95 metadata API latency < 1 second, no secret/PII log event, no duplicate Drive file due to replay, and support documentation readiness.

- [x] **Step 3: Freeze old backend configuration**

Stop onboarding new GitHub Actions/Apps Script/Cloud Run configurations. Keep the extension available only as rollback during the production observation window; do not add new features to it.

- [x] **Step 4: Cut over the canonical domain**

Deploy production, verify OAuth redirect/domain/CSP, run all production smoke checks, publish the hosted privacy policy and release notes, and monitor authentication, job, Workflow, R2, D1, and Drive-provider dashboards continuously for the first 24 hours.

- [x] **Step 5: Execute rollback if a gate fails**

Disable new web job creation, preserve completed/in-flight state, route users to the extension release instructions, roll back Worker code, and reconcile Workflow/R2 objects. Do not roll back D1 destructively; use the documented restore-to-new-database procedure only for confirmed data corruption.

- [x] **Step 6: Archive legacy code after observation**

After 30 days meeting beta SLOs, move extension-only and old backend files under `legacy-extension/`, remove them from root build/package scripts, revoke Cloud Run/GitHub/Apps Script credentials and deployments, and clearly label the archive unsupported/read-only. Do not delete history needed for incident or migration analysis.

- [x] **Step 7: Update canonical documentation**

Make `README.md`, architecture, setup, deployment, PRD, changelog, security, and privacy describe only the hosted product by default. Include local development, Cloudflare resource creation, Google OAuth setup, test commands, release process, limits, retention, and unsupported context-menu behavior.

- [x] **Step 8: Final verification**

From a clean clone run `npm ci`, local D1 migrations, all tests, type-check, lint, build, Wrangler dry run, staging deploy/smoke, and production smoke. Run `rg "chrome\.|chromiumapp|GitHub Actions|Apps Script|Cloud Run" src index.html package.json vite.config.ts`; expected: no runtime references in the canonical web product.

- [x] **Step 9: Commit**

```bash
git add README.md ARCHITECTURE.md DEPLOYMENT.md SETUP.md PRD.md CHANGELOG.md legacy-extension package.json vite.config.ts docs/superpowers/plans/2026-08-18-cloudflare-web-migration/task-20-rollout-cutover.md
git commit -m "chore: make Cloudflare web app canonical"
```
