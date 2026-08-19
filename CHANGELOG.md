# Changelog — Google Drive Uploader

## [2.0.0] - 2026-08-18 (Cloudflare Web Platform Migration)

### Architecture & Backend
- **Migrated to Cloudflare Web Platform**: Replaced client-side browser extension and fragmented custom personal backends (GitHub Actions, Apps Script, Cloud Run) with a unified, cloud-native architecture on Cloudflare Workers, D1, R2, and Workflows.
- **AES-256-GCM Token Encryption**: Refresh tokens are encrypted with authenticated envelope encryption at rest in Cloudflare D1 and never exposed to browser JavaScript.
- **Cloudflare Workflows Transfer Engine**: Background transfers for large files and remote URLs with resumable uploads, exponential backoff, and idempotent retry.
- **SSRF Hardening**: Implemented IP address blocklisting and multi-hop redirect verification for remote URL downloads.
- **Multi-Tenant Session & Origin Protection**: Opaque session tokens in `HttpOnly; Secure; SameSite=Lax` cookies, double-submit CSRF headers, and strict Origin verification.

### Frontend Web Client
- **Modern React 18 SPA**: Responsive web application supporting desktop, tablet, and mobile browsers with light/dark theme switching.
- **R2 Multipart Chunked Uploads**: 3-concurrency worker upload queue for local files with progress tracking.
- **Google Drive Explorer**: Full Drive file browser with folder navigation, search, share, rename, move, preview, and download.
- **Settings & Privacy Controls**: Unified preferences, filename patterns, and self-service account deletion with automated Google OAuth revocation.
