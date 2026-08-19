# Task 13: Migrate Upload UI, Multipart Client, Jobs, And History

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Create: `src/web/api/jobs.ts`
- Create: `src/web/uploads/multipartUpload.ts`
- Create: `src/web/uploads/UploadForm.tsx`
- Create: `src/web/uploads/JobList.tsx`
- Create: `test/unit/multipartUpload.test.ts`
- Create: `test/web/Uploads.test.tsx`
- Modify: `src/web/routes/UploaderPage.tsx`
- Reference: `src/popup/UploaderHome.tsx`

**Interfaces:**
- Consumes: job/local multipart endpoints and `UploadJobView`.
- Produces: URL/local forms, direct R2 multipart upload, two-second ETag polling, cancel/retry/history, and folder selection for the authenticated account.

- [x] **Step 1: Write failing upload UI/client tests**

Cover URL validation, filename derivation/rename, folder requirement, multi-file selection, 5 GiB rejection, part concurrency of three, ETag capture, transient part retry, browser refresh resume metadata, abort/cancel, polling 304, terminal notices, retry, and history clear confirmation.

- [x] **Step 2: Implement multipart browser upload**

Slice the `File` by server-provided part size, request signed URLs in batches, upload at concurrency three, retain only `{ jobId, uploadId, completedParts }` in IndexedDB, and report aggregate staging progress. On reload, require the user to reselect the same file and verify name/size/lastModified before resuming; browsers cannot restore `File` handles portably.

- [x] **Step 3: Migrate upload interaction**

Extract filename/folder matching behavior from `UploaderHome.tsx` into tested pure functions. Replace every `sendMessage`, `chrome.storage`, IndexedDB blob store, and service-worker listener with typed API calls. Show separate `staging`, `fetching`, and `uploading` progress.

- [x] **Step 4: Implement durable polling and notices**

Poll only while jobs are active or the page is visible; use ETags and exponential backoff after network failure. In-page snackbar notices replace Chrome notifications. Keep the latest 100 history rows per page through cursor pagination; the server owns retention.

- [x] **Step 5: Verify uploads**

Run unit/component tests and Playwright local/URL upload flows for small and 100 MiB fixtures. Refresh during local staging and during Drive transfer; expected: staging can resume after file reselect and server transfer resumes without reselect.

- [x] **Step 6: Commit**

```bash
git add src/web/api/jobs.ts src/web/uploads src/web/routes/UploaderPage.tsx test/unit/multipartUpload.test.ts test/web/Uploads.test.tsx
git commit -m "feat: migrate uploads to the web app"
```
