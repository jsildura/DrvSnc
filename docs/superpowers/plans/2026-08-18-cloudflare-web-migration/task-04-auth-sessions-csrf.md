# Task 4: Implement Encryption, Sessions, CSRF, And Google OAuth

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Create: `src/worker/services/crypto.ts`
- Create: `src/worker/services/googleAuth.ts`
- Create: `src/worker/middleware/session.ts`
- Create: `src/worker/middleware/csrf.ts`
- Create: `src/worker/routes/auth.ts`
- Create: `test/unit/crypto.test.ts`
- Create: `test/worker/auth.test.ts`
- Modify: `src/worker/index.ts`
- Modify: `src/worker/env.ts`
- Modify: `.dev.vars.example`

**Interfaces:**
- Consumes: `users`, `google_credentials`, `oauth_states`, `sessions`, `SessionView`, `AccountView`.
- Produces: `encryptSecret`, `decryptSecret`, `hashOpaqueToken`, `requireSession`, `requireCsrf`, OAuth routes, `GET /api/v1/session`, and `POST /api/v1/auth/logout`.

- [x] **Step 1: Write failing crypto and OAuth tests**

Test AES-GCM round trips, wrong-key failure, random IVs for equal plaintext, only hashes persisted for session tokens, 10-minute OAuth-state expiry, one-time state consumption, state mismatch, provider errors, missing refresh token on first authorization, login-hint validation, secure cookie attributes, CSRF rejection, logout invalidation, and absence of tokens in session JSON/log messages.

- [x] **Step 2: Implement application cryptography**

Load a 32-byte base64 key from `TOKEN_ENCRYPTION_KEY`; use Web Crypto AES-GCM with record ID and key version as additional authenticated data. Generate session/CSRF/state values using `crypto.getRandomValues`, hash opaque session tokens with SHA-256, and compare fixed-length hashes without early return.

- [x] **Step 3: Implement Google provider calls**

`createAuthorizationUrl` requests full Drive plus `openid email profile`, uses PKCE S256, `access_type=offline`, `include_granted_scopes=true`, and `prompt=select_account consent`. An optional syntactically valid remembered email is passed as `login_hint`, but is never trusted as identity. `exchangeCode`, `refreshAccessToken`, `revokeToken`, and `fetchProfile` map provider failures to stable internal error codes and never interpolate response bodies into browser messages.

- [x] **Step 4: Implement session middleware**

Authenticate by hashing `gdu_session`, joining non-expired sessions to users, and updating `last_seen_at` no more than once per hour. Create 30-day sessions, rotate the session token after OAuth callback, and expire all user sessions when requested by a security operation.

- [x] **Step 5: Implement CSRF protection**

Use double-submit `gdu_csrf`: readable secure cookie plus `X-CSRF-Token`; require exact match for every non-GET/HEAD/OPTIONS route except OAuth callback. Also reject mutation requests whose `Origin` is not `APP_ORIGIN`.

- [x] **Step 6: Implement OAuth/session routes**

Login creates or updates exactly one app user by Google subject and replaces that user's encrypted Google credential record. If another app session is already present in the browser, invalidate it before creating the new identity's session. Persist only encrypted refresh tokens; cache encrypted access tokens only with expiry if needed. Callback redirects to `/uploads?auth=success` or `/login?error=<stable-code>`.

- [x] **Step 7: Verify authentication boundary**

Run `npm test -- test/unit/crypto.test.ts test/worker/auth.test.ts`, `npm run type-check`, and `npm run lint`. Inspect response snapshots for `access_token`, `refresh_token`, `client_secret`, and ciphertext fields; expected: no matches.

- [x] **Step 8: Commit**

```bash
git add src/worker test/unit/crypto.test.ts test/worker/auth.test.ts .dev.vars.example
git commit -m "feat: add secure Google web authentication"
```
