# Cloudflare Operations, Deployment & Runbook — Google Drive Uploader

## 1. Cloudflare Infrastructure Architecture

```
Internet / Client Browser
          │
          ▼
Cloudflare Edge Worker (Reverse Proxy + Static Assets + Hono API)
   ├── D1 Database (`gdu-db-prod`): Multi-tenant metadata, sessions, encrypted tokens
   ├── R2 Storage (`gdu-uploads-prod`): Ephemeral multipart chunk staging
   └── Workflows Engine (`DriveTransferWorkflow`): Durable, background Drive streams
```

---

## 2. Secrets & Configuration Management

Secrets are managed strictly through Cloudflare Workers Secrets and GitHub Actions Encrypted Environment Secrets:

```bash
# Set production secrets via Wrangler CLI
wrangler secret put TOKEN_ENCRYPTION_KEY --env production
wrangler secret put SESSION_SECRET --env production
wrangler secret put GOOGLE_CLIENT_ID --env production
wrangler secret put GOOGLE_CLIENT_SECRET --env production
```

### Encryption Key Rotation Procedure:
1. Generate a new 256-bit hexadecimal key.
2. Deploy Worker with dual-key support (decrypts with old or new key; writes new records with new key).
3. Run background migration script to re-encrypt all existing credentials with the new key.
4. Remove the old key and update `TOKEN_ENCRYPTION_KEY`.

---

## 3. Database Migration Runbook

Database migrations are located in `./migrations/*.sql` and applied sequentially:

```bash
# Staging Migration
npx wrangler d1 migrations apply DB --remote --env staging

# Production Migration
npx wrangler d1 migrations apply DB --remote --env production
```

---

## 4. Rollback & Recovery Runbook

### A. Worker Code Rollback
If a regression occurs in production code:
```bash
wrangler rollback --env production
```

### B. D1 Point-In-Time Restore (Time Travel)
Cloudflare D1 automatically retains Time Travel bookmarks for 30 days:
```bash
# Retrieve bookmark for 1 hour ago
wrangler d1 time-travel restore gdu-db-prod --timestamp="2026-08-18T12:00:00Z"
```

### C. Workflow Recovery & In-Flight Cleanup
- Stale or hung Workflows are monitored via daily scheduled cleanup.
- Staged R2 objects older than 7 days are automatically purged.
- If Google API experiences a temporary outage, Workflows use exponential backoff up to 5 attempts before marking status `failed`. Users can click **Retry** in the Web UI.

---

## 5. Incident Response & Alerts

| Alert Trigger | Immediate Action |
| :--- | :--- |
| **OAuth 401 Spikes** | Check Google Cloud Console API quotas, Client Secret validity, and consent screen status. |
| **Drive 429 Rate Limit Spikes** | Review user job volume; tune retry exponential backoff factor. |
| **D1 High Latency / Lock Errors** | Verify indexes on `upload_jobs(user_id, status)` and `sessions(token_hash)`. |
| **R2 Storage Spikes** | Trigger manual `handleScheduledCleanup()` invocation to purge orphan multipart objects. |
