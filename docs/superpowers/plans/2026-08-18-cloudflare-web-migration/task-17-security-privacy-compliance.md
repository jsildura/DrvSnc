# Task 17: Complete Security, Privacy, And Google Compliance

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Create: `docs/privacy.md`
- Create: `docs/security.md`
- Create: `docs/data-retention.md`
- Create: `docs/threat-model.md`
- Create: `test/security/headers.test.ts`
- Modify: `src/worker/index.ts`

**Interfaces:**
- Produces: public hosted privacy terms, security model, retention policy, CSP/security headers, and Google verification evidence.

- [x] **Step 1: Write failing security-header tests**

Assert HSTS in production, `frame-ancestors 'none'`, strict `object-src`, constrained `connect-src`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy`, no cache for authenticated JSON, and immutable caching for hashed assets. Permit only the exact Google iframe origins needed after preview testing.

- [x] **Step 2: Replace the extension privacy policy**

State accurately that Cloudflare processes account metadata, encrypted Google refresh tokens, job metadata, redacted source URLs, and temporary file objects; document purposes, subprocessors, regions/transfer implications, retention, deletion/revocation, incident contact, and Google Limited Use compliance. Remove all claims of no backend/no data collection/local-only storage.

- [x] **Step 3: Complete the threat model**

Document assets/trust boundaries and mitigations for token theft, CSRF, XSS, session fixation, SSRF/DNS rebinding, IDOR, malicious file names/MIME types, upload bombs, open redirects, replay/idempotency, Workflow duplication, R2 object exposure, Drive over-permission, log leakage, insider access, dependency compromise, and account deletion.

- [x] **Step 4: Prepare Google verification**

Verify domain ownership; configure OAuth consent screen, authorized domains, homepage, privacy and terms URLs; record scope justification and a demo video covering each full-Drive capability. Keep the app in internal/test mode until approval if the audience is external.

- [x] **Step 5: Run security verification**

Run header tests, dependency audit, secret scanning, SSRF suite, IDOR suite using two users, CSRF suite, and manual browser CSP checks. Expected: no high/critical dependency finding without a documented mitigation and owner.

- [x] **Step 6: Commit**

```bash
git add docs/privacy.md docs/security.md docs/data-retention.md docs/threat-model.md src/worker/index.ts test/security/headers.test.ts
git commit -m "docs: define hosted security and privacy controls"
```
