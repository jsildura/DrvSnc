# Task 1: Lock Scope, Rotate Credentials, And Establish Baselines

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Create: `docs/cloudflare-architecture.md`
- Create: `docs/security-incident-2026-08-oauth-secret.md`
- Modify: `.gitignore`

**Interfaces:**
- Produces: approved scope, data-flow diagrams, OAuth rotation record, baseline fixture list, and Cloudflare account prerequisites used by every later task.

- [x] **Step 1: Write the architecture decision record**

Document the included/excluded scope above, one-origin deployment, D1/R2/Workflow ownership, clean-start migration decision, full Drive scope requirement, 5 GiB initial limit, polling decision, and companion-extension deferral. Include sequence diagrams for login, local upload, remote upload, Drive download, cancellation, and retry.

- [x] **Step 2: Inventory behavior fixtures**

Record dedicated Google test accounts and Drive fixtures without credentials: an empty folder, nested folders, shared folder, Shared-with-me item, trashed item, Google Doc/Sheet/Slide, 1 MiB binary, 8 MiB binary, 100 MiB binary, and files owned by both test accounts. Record expected extension behavior for each in `docs/cloudflare-architecture.md`.

- [x] **Step 3: Rotate the exposed OAuth secret**

Disable/delete the existing Google OAuth credential whose secret is present in `src/lib/auth.ts`, create separate web OAuth clients for local/staging/production, and enter only the new client IDs and callback URLs in the incident record. Put secrets in Wrangler secret storage; never place secret values in the repository or incident document.

- [x] **Step 4: Extend secret ignores**

Add `.dev.vars`, `.dev.vars.*`, `.wrangler/`, `*.pem`, and generated local D1/R2 state to `.gitignore`. Keep `.dev.vars.example` trackable.

- [x] **Step 5: Verify the baseline**

Run `npm ci`, `npm run type-check`, `npm run lint`, and `npm run build`. Record command, exit code, and any pre-existing failures in the architecture document rather than fixing unrelated extension behavior in this task.

- [x] **Step 6: Commit**

```bash
git add .gitignore docs/cloudflare-architecture.md docs/security-incident-2026-08-oauth-secret.md
git commit -m "docs: define Cloudflare migration architecture"
```

**Acceptance:** Product scope is signed off; the exposed OAuth secret is revoked; no new secret appears in `git grep -nE '(GOCSPX-|refresh_token|github_pat_)'`; baseline behavior and known failures are recorded.
