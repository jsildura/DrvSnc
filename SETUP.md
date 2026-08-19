# Setup Guide — Google Drive Uploader

## 1. Google Cloud OAuth Configuration

1. Visit [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a GCP project.
3. Enable the **Google Drive API** under **APIs & Services > Library**.
4. Configure the **OAuth Consent Screen**:
   - User Type: External (or Internal for workspace testing).
   - Scopes: Add `https://www.googleapis.com/auth/drive`.
5. Create **OAuth 2.0 Client IDs**:
   - Application Type: **Web application**.
   - Authorized JavaScript Origins:
     - `http://localhost:8787` (Local development)
     - `https://staging.streamflix.app` (Staging)
     - `https://uploader.streamflix.app` (Production)
   - Authorized Redirect URIs:
     - `http://localhost:8787/api/v1/auth/google/callback`
     - `https://staging.streamflix.app/api/v1/auth/google/callback`
     - `https://uploader.streamflix.app/api/v1/auth/google/callback`

---

## 2. Local Environment Setup

1. Copy `.dev.vars.example` to `.dev.vars` if desired, or use default local development vars configured in `wrangler.jsonc`.
2. Apply local D1 schema:
   ```bash
   npm run db:migrate:local
   ```
3. Run test verification:
   ```bash
   npm test
   ```
4. Start development server:
   ```bash
   npm run dev
   ```
