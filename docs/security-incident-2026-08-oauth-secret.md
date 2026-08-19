# Security Incident Record: Google OAuth Secret Exposure (2026-08)

- **Incident ID:** SEC-2026-08-OAUTH-SECRET
- **Date Reported:** 2026-08-18
- **Status:** Resolved / Rotated
- **Severity:** High
- **Target Subsystem:** Google OAuth Authentication

---

## 1. Summary

A hardcoded Google OAuth client secret (`GOCSPX-...`) was identified in client-side source files (`src/lib/auth.ts` and `src/components/GitHubQuickSetup.tsx`) within the repository. Because Chrome extensions and client-side single-page applications execute in untrusted user environments, embedding client secrets in client bundle code exposes them to extraction and misuse.

## 2. Root Cause Analysis

The legacy Chrome Manifest V3 extension architecture previously performed OAuth token refresh flows directly from extension contexts. To support refresh token grant exchanges without a hosted backend, the client secret was bundled into client-side code.

## 3. Remediation & Credential Rotation

1. **Revocation:** The exposed Google OAuth 2.0 credential set containing the exposed secret has been marked for revocation and decommissioned in Google Cloud Console.
2. **Architecture Transition:** All OAuth token exchange, refresh token storage, and Google Drive API communications are migrated to the server-side Cloudflare Worker runtime. Browser JavaScript never receives or handles Google client secrets, access tokens, or refresh tokens.
3. **Environment Separation:** Separate Google OAuth 2.0 **Web Application** client credentials are created for each environment:
   - **Local Development:**
     - Client ID: `dev-web-uploader.apps.googleusercontent.com`
     - Authorized Redirect URI: `http://localhost:8787/api/v1/auth/google/callback`
   - **Staging:**
     - Client ID: `staging-web-uploader.apps.googleusercontent.com`
     - Authorized Redirect URI: `https://staging-uploader.streamflix.app/api/v1/auth/google/callback`
   - **Production:**
     - Client ID: `prod-web-uploader.apps.googleusercontent.com`
     - Authorized Redirect URI: `https://uploader.streamflix.app/api/v1/auth/google/callback`

## 4. Secret Storage & Policy

- **Cloudflare Secret Storage:** OAuth client secrets (`GOOGLE_CLIENT_SECRET`), token encryption keys (`TOKEN_ENCRYPTION_KEY`), and session secrets are stored strictly via Cloudflare Wrangler secret management:
  ```bash
  npx wrangler secret put GOOGLE_CLIENT_SECRET
  npx wrangler secret put TOKEN_ENCRYPTION_KEY
  ```
- **Local Development:** Secrets are managed via `.dev.vars` (enforced as untracked in `.gitignore`). Only `.dev.vars.example` is committed, containing non-secret template variable names.
- **Repository Policy:** No plaintext secret values (e.g. `GOCSPX-*`, GitHub Personal Access Tokens, AES keys, or refresh tokens) may be committed to version control, PR descriptions, or documentation.
