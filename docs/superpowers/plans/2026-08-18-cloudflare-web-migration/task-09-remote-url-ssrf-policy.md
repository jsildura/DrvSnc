# Task 9: Enforce Remote URL And SSRF Policy

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Create: `src/worker/services/remoteUrlPolicy.ts`
- Create: `test/unit/remoteUrlPolicy.test.ts`
- Modify: `src/worker/routes/jobs.ts`

**Interfaces:**
- Produces: `validateRemoteUrl(rawUrl)`, `fetchRemoteWithPolicy(url, init)`, and `redactSourceUrl(url)` used at creation and every redirect.

- [x] **Step 1: Write adversarial failing tests**

Cover `http`, `file`, `ftp`, credentials, fragments, Unicode/punycode hosts, decimal/hex/octal IPs, IPv4-in-IPv6, localhost aliases, private/link-local/loopback/multicast/reserved ranges, `169.254.169.254`, `metadata.google.internal`, DNS answers containing any blocked IP, rebinding between validation/fetch, redirects to blocked hosts, more than five redirects, malformed Location headers, ports other than 443, and query redaction.

- [x] **Step 2: Implement canonical validation**

Parse with `URL`; require `https:`, port empty/443, no username/password, hostname length limits, and normalized ASCII host. Resolve A/AAAA records using Cloudflare DNS over HTTPS or a verified platform resolver and reject the whole host if any answer is disallowed.

- [x] **Step 3: Implement manual redirect fetching**

Use `redirect: 'manual'`, revalidate each target, cap at five redirects, and do not forward cookies, authorization, referrer, or user-provided headers. Probe with a ranged GET when HEAD is unsupported. Enforce declared and streamed byte limits and abort on mismatch/overflow.

- [x] **Step 4: Verify policy**

Run `npm test -- test/unit/remoteUrlPolicy.test.ts`. Run staging probes against public HTTPS fixtures plus controlled endpoints redirecting to loopback/private addresses; expected: public fixtures allowed and blocked fixtures rejected before body streaming.

- [x] **Step 5: Commit**

```bash
git add src/worker/services/remoteUrlPolicy.ts src/worker/routes/jobs.ts test/unit/remoteUrlPolicy.test.ts
git commit -m "feat: secure remote upload sources"
```
