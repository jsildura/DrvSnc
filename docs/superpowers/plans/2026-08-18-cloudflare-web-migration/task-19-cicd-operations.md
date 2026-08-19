# Task 19: Add CI/CD, Environments, Migrations, And Operations Runbook

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/deploy-staging.yml`
- Create: `.github/workflows/deploy-production.yml`
- Create: `docs/cloudflare-operations.md`
- Modify: `wrangler.jsonc`
- Modify: `package.json`

**Interfaces:**
- Produces: protected staging/production deployments, forward-only D1 migration procedure, rollback procedure, secret rotation, backup/restore, and incident response.

- [x] **Step 1: Implement CI**

On pull requests run clean install, type-check, lint, unit/Worker/web tests, Playwright mocked E2E, build, secret scan, dependency audit, and Wrangler dry run. Upload only screenshots/traces that have been reviewed not to contain provider data.

- [x] **Step 2: Implement staging deployment**

Deploy merges to the default branch to isolated staging resources, apply forward D1 migrations before code activation, run `/health`, session, mocked smoke, and real-provider smoke, then record Worker version and migration version.

- [x] **Step 3: Implement protected production deployment**

Use GitHub environment approval. Create a D1 Time Travel bookmark, apply backward-compatible migrations, deploy a version, run smoke tests, then shift traffic. Secrets are configured through Wrangler/GitHub encrypted environment secrets, never command output.

- [x] **Step 4: Write rollback and recovery procedures**

Document Worker version rollback, feature flag to disable new job creation while preserving polling/downloads, Workflow cancellation/reconciliation, R2 orphan cleanup, D1 Time Travel restore into a new database, OAuth secret rotation, token-encryption key rotation by key version, and Google account revocation response.

- [x] **Step 5: Verify deployment rehearsal**

Deploy staging, apply a no-op follow-up migration, roll back Worker code one version, verify existing sessions/jobs remain readable, restore a D1 backup into a disposable database, and complete one in-flight upload after the code rollback.

- [x] **Step 6: Commit**

```bash
git add .github/workflows docs/cloudflare-operations.md wrangler.jsonc package.json
git commit -m "ci: deploy Cloudflare web application"
```
