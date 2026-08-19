# Privacy Policy — Google Drive Uploader

*Last Updated: August 18, 2026*

## 1. Overview & Service Architecture

Google Drive Uploader ("the Application", "we", "our") is a cloud-native web application designed to facilitate direct, large-file and remote URL transfers into the user's personal Google Drive account.

This Privacy Policy explains how we collect, process, protect, retain, and delete user data when you authenticate with Google and use the Application.

---

## 2. Information We Process

### A. Google Account Metadata
When you authenticate via Google OAuth 2.0, we process:
- **Google Subject Identifier (`sub`)**: Unique identifier provided by Google.
- **Email Address**: Used to identify your account and for account notifications.
- **Display Name & Profile Picture URL**: Used purely for in-app profile display.

### B. Google OAuth Refresh Tokens
- Refresh tokens are received exclusively on our secure backend during authorization code exchange.
- Tokens are encrypted immediately using **AES-256-GCM** authenticated envelope encryption before storage in Cloudflare D1.
- Encryption keys (`TOKEN_ENCRYPTION_KEY`) are managed strictly via Cloudflare Workers Secrets and never stored in the database.
- Raw access tokens and refresh tokens are **never** exposed to browser JavaScript.

### C. Upload Job Metadata & Temporary Staging
- **Job Records**: Filename, file size, MIME type, transfer progress, transfer status, timestamp, and target Drive folder.
- **Remote URLs**: Remote download URLs are encrypted at rest using AES-256-GCM and redacted from logs.
- **Temporary Upload Staging**: Local file uploads are temporarily staged in private Cloudflare R2 object storage during multipart chunking and automatically deleted upon completion or expiration (maximum 7 days).

---

## 3. Subprocessors & Infrastructure

We use industry-leading cloud infrastructure to run the Application:

| Subprocessor | Purpose | Region | Security Standard |
| :--- | :--- | :--- | :--- |
| **Cloudflare, Inc.** | Workers (Compute), D1 (Database), R2 (Upload Staging), Workflows (Background transfers) | Global Edge / Encrypted | ISO 27001, SOC 2 Type II |
| **Google LLC** | OAuth 2.0 Authentication & Google Drive API storage | Global | ISO 27001, SOC 2 Type II |

---

## 4. Google API Limited Use Disclosure

Google Drive Uploader's use and transfer of information received from Google APIs to any other app will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements:

1. We only request Google Drive permissions necessary to transfer, organize, and manage files requested by the user (`https://www.googleapis.com/auth/drive`).
2. We do not use Google user data for advertising, marketing, or profiling.
3. We do not transfer Google user data to third parties, except as strictly necessary to deliver the file transfer functionality or comply with applicable law.
4. Human employees cannot read your private Drive files.

---

## 5. Data Retention & Deletion

- **Session Expiry**: Sessions expire automatically after 30 days of inactivity.
- **Staging Cleanup**: Temporary upload parts in R2 are automatically purged upon transfer completion or after 7 days.
- **Job Privacy Redaction**: Job source URLs and error logs are automatically redacted after 90 days.
- **User Account Deletion**: Users may delete their account at any time via the **Settings > Danger Zone** menu. Account deletion immediately purges all database records, cancels active jobs, deletes staged files, and revokes OAuth refresh tokens with Google's servers.

---

## 6. Contact & Incident Response

For questions regarding this policy or privacy inquiries, contact:
`privacy@streamflix.app`
