# System Architecture — Google Drive Uploader

## 1. High-Level Topology

```
┌──────────────────────────────────────────────────────────┐
│                      Client Browser                      │
│   (React 18 SPA + Vite + TailwindCSS + Web Client API)    │
└────────────────────────────┬─────────────────────────────┘
                             │ HTTPS / REST (Opaque Session Cookie + CSRF Header)
                             ▼
┌──────────────────────────────────────────────────────────┐
│             Cloudflare Worker (Hono Gateway)             │
│   - Security Headers (CSP, HSTS, X-Frame-Options)        │
│   - CSRF & Origin Validation                             │
│   - AES-256-GCM Token Encryption Engine                 │
│   - SSRF & IP Range Validation Engine                    │
└──────┬─────────────────────┬──────────────────────┬──────┘
       │                     │                      │
       ▼                     ▼                      ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│  Cloudflare  │      │  Cloudflare  │      │  Cloudflare  │
│      D1      │      │      R2      │      │  Workflows   │
│  (Database)  │      │  (Staging)   │      │  (Transfer)  │
└──────────────┘      └──────────────┘      └──────┬───────┘
                                                   │
                                                   ▼
                                            ┌──────────────┐
                                            │ Google Drive │
                                            │   REST API   │
                                            └──────────────┘
```

---

## 2. Component Directory

| Directory / File | Description |
| :--- | :--- |
| `src/worker/index.ts` | Worker entrypoint, routes mounting, security headers, and scheduled handlers. |
| `src/worker/routes/` | REST endpoint handlers (`auth.ts`, `account.ts`, `drive.ts`, `jobs.ts`, `preferences.ts`). |
| `src/worker/services/` | Backend services (`crypto.ts`, `driveClient.ts`, `googleAuth.ts`, `jobRepository.ts`, `remoteUrlPolicy.ts`, `audit.ts`). |
| `src/worker/workflows/`| Cloudflare Workflows transfer engine (`DriveTransfer.ts`). |
| `src/web/` | React SPA client application, state provider, routes, and UI components. |
| `migrations/` | D1 SQL migration scripts. |
| `docs/` | Security, privacy, threat model, operations, and retention policies. |
