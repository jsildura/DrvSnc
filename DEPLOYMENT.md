# Deployment Guide — Google Drive Uploader

## 1. Prerequisites

1. Cloudflare Account with Workers, D1, R2, and Workflows enabled.
2. Google Cloud Platform Project with Google Drive API enabled and OAuth 2.0 Client ID created.

---

## 2. Cloudflare Resources Provisioning

```bash
# 1. Create D1 Databases
wrangler d1 create gdu-db-staging
wrangler d1 create gdu-db-prod

# 2. Create R2 Staging Buckets
wrangler r2 bucket create gdu-uploads-staging
wrangler r2 bucket create gdu-uploads-prod

# 3. Apply CORS Policy to R2 Buckets
wrangler r2 bucket cors set gdu-uploads-staging --cors-file r2-cors.json
wrangler r2 bucket cors set gdu-uploads-prod --cors-file r2-cors.json
```

---

## 3. Configure Secrets

```bash
# Set Production Secrets
wrangler secret put TOKEN_ENCRYPTION_KEY --env production
wrangler secret put SESSION_SECRET --env production
wrangler secret put GOOGLE_CLIENT_ID --env production
wrangler secret put GOOGLE_CLIENT_SECRET --env production
```

---

## 4. Run Migrations & Deploy

```bash
# Staging Deployment
npm run db:migrate:staging
npm run deploy:staging

# Production Deployment
npm run build
wrangler d1 migrations apply DB --remote --env production
npm run deploy:production
```
