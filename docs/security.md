# Security Architecture & Controls — Google Drive Uploader

## 1. Security Principles

Google Drive Uploader is built with a zero-trust, defense-in-depth architecture:

1. **Zero Browser Tokens:** Browser JavaScript never receives, stores, or handles Google OAuth refresh tokens or raw Google access tokens.
2. **Server-Side Token Encryption:** Refresh tokens in Cloudflare D1 are encrypted with **AES-256-GCM** authenticated envelope encryption using 256-bit keys stored in Cloudflare Secrets.
3. **Strict Session Isolation:** Authentication uses opaque, high-entropy 256-bit session tokens stored in `HttpOnly; Secure; SameSite=Lax` cookies. Database stores only SHA-256 hashes of session tokens.
4. **Origin & CSRF Defense:** Double-submit CSRF tokens (`X-CSRF-Token` header validated against signed cookie) and strict Origin/Sec-Fetch-Site verification on all mutation endpoints.
5. **SSRF Hardening:** Remote URL transfers enforce strict HTTPS, block private IP ranges (RFC 1918, RFC 3927 link-local, loopback, CGNAT, multicast, IPv4-mapped IPv6, metadata servers `169.254.169.254`), block internal hostnames, and follow maximum 5 redirects with per-hop IP re-evaluation.

---

## 2. Cryptographic Specifications

- **Token Encryption Algorithm:** `AES-256-GCM` with unique 96-bit Initialization Vectors (IV) per row and authenticated Additional Data (AAD) bound to the `user_id`.
- **Session Tokens:** 256-bit cryptographically secure random bytes (`crypto.getRandomValues`) hashed with `SHA-256`.
- **OAuth PKCE:** RFC 7636 `code_challenge_method=S256` with high-entropy verifiers stored transiently in D1 and consumed strictly one-time.

---

## 3. Rate Limiting & Abuse Protection

- **Authentication Rate Limiting:** 20 requests per minute per IP address on `/api/v1/auth/google/*`.
- **Job Creation Limits:** Maximum 100 job creations per 24 hours per user.
- **Concurrent Transfer Limits:** Maximum 25 active concurrent jobs per user.
- **Payload Limits:** Maximum 5 GiB per upload job.

---

## 4. HTTP Security Headers

- `Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.googleusercontent.com; font-src 'self' data:; connect-src 'self' https://*.r2.cloudflarestorage.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate` (on API endpoints)
