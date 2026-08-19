# Data Retention Policy — Google Drive Uploader

| Data Type | Storage Location | Retention Period | Deletion Mechanism |
| :--- | :--- | :--- | :--- |
| **OAuth PKCE States** | D1 `oauth_states` | 10 minutes | Consumed on callback or purged by scheduled cleanup cron |
| **User Sessions** | D1 `sessions` | 30 days of inactivity | Purged on logout, user deletion, or scheduled cleanup cron |
| **Encrypted Refresh Tokens** | D1 `google_credentials` | Duration of user account | Purged immediately on account deletion or OAuth revocation |
| **Temporary Staging Chunks** | Cloudflare R2 | Max 7 days | Deleted upon transfer finalization or scheduled cleanup cron |
| **Job Details & Source URLs** | D1 `upload_jobs` | 90 days active retention | Redacted after 90 days (`source_url_encrypted` and `error_message` set to NULL) |
| **User Account & Preferences** | D1 `users`, `preferences` | Until explicit deletion | Deleted immediately upon user request in Settings |
