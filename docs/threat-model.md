# Threat Model & Risk Mitigations — Google Drive Uploader

## 1. Threat Matrix

| Threat Category | Potential Impact | Mitigations Implemented |
| :--- | :--- | :--- |
| **Token Theft / Leakage** | Unauthorized Google Drive access | Google tokens stored encrypted with AES-GCM at rest; raw tokens never sent to browser; keys isolated in Cloudflare Secrets. |
| **Cross-Site Request Forgery (CSRF)** | Unauthorized file upload or account deletion | SameSite=Lax cookies, Origin header verification, Double-Submit signed CSRF tokens on all mutating POST/PUT/DELETE requests. |
| **Server-Side Request Forgery (SSRF)** | Access to internal metadata or network endpoints | Strict HTTPS validation, blocklist for RFC 1918, RFC 3927 link-local, loopback, AWS/GCP metadata (`169.254.169.254`), and strict 5-hop redirect validation. |
| **Insecure Direct Object Reference (IDOR)** | Accessing other users' files or jobs | All D1 queries filter strictly on authenticated `session.user_id`. Cross-tenant access returns 404/403. |
| **Denial of Service / Quota Exhaustion** | Storage/API abuse | Rate limiting on authentication endpoints (20 req/min/IP), 100 jobs/day limit, 25 concurrent jobs limit, 5 GiB file size limit. |
| **XSS & Injection** | Malicious script execution | Strict Content-Security-Policy (CSP) with `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, and HTML entity sanitization. |
| **Stale / Orphan Cloud Resources** | Storage cost & data accumulation | Daily scheduled cron cleans expired sessions, abandoned R2 objects older than 7 days, and redacts 90-day-old job histories. |
