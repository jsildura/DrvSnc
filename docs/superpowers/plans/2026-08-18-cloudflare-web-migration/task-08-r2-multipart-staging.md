# Task 8: Stage Local Files With Private R2 Multipart Uploads

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Create: `src/worker/services/r2Multipart.ts`
- Create: `config/r2-cors.json`
- Create: `test/worker/r2Multipart.test.ts`
- Modify: `src/worker/routes/jobs.ts`
- Modify: `src/worker/env.ts`

**Interfaces:**
- Consumes: a user-owned `staging` job and private `UPLOADS` bucket.
- Produces: short-lived signed part URLs, multipart completion, abort, and verified R2 object metadata for `DriveTransferWorkflow`.

- [x] **Step 1: Write failing multipart tests**

Test object-key ownership, 16 MiB default part size, 5 MiB minimum non-final part, 10,000-part maximum, one-hour URL expiry, Content-Length checks, ETag list validation, duplicate completion, abort on cancel, wrong-user access, and total-size mismatch.

- [x] **Step 2: Implement multipart session creation**

Generate keys only on the server. Persist R2 multipart ID and encrypted object key in the job's provider state, never in `UploadJobView`. Return `partSize`, `partCount`, and a job-scoped endpoint for requesting batches of at most 20 signed part URLs.

- [x] **Step 3: Implement signed part capabilities**

Use `aws4fetch` with dedicated R2 S3 API credentials held in Worker secrets to generate one-hour SigV4 `UploadPart` URLs. Bind each URL to the exact R2 account endpoint, bucket, server-generated key, multipart upload ID, part number, expiry, and signed `Content-Length`; reject arbitrary object keys from clients. The credentials may access only the staging bucket and are rotated independently from Worker deployment credentials.

- [x] **Step 4: Configure private-bucket CORS**

Create `config/r2-cors.json` allowing `PUT` only from the exact local/staging/production app origins, allowing `Content-Type` and `Content-Length`, exposing `ETag`, and setting a one-hour max age. Apply it with `wrangler r2 bucket cors set <bucket> --file config/r2-cors.json`; keep public development URLs and wildcard origins out of production.

- [x] **Step 5: Complete and verify staging**

On completion, validate all part numbers/ETags, call multipart complete, `HEAD` the object, compare actual size with declared size, then transition `staging -> queued` and start the Workflow. On mismatch, abort multipart, mark failed with `LOCAL_SIZE_MISMATCH`, and delete any completed object.

- [x] **Step 6: Verify without buffering**

Run multipart tests and a staging-browser upload of a 100 MiB generated fixture so real SigV4 and CORS behavior are exercised. Confirm an unapproved Origin fails its preflight, observe Worker memory below 64 MiB, and assert the stored object's SHA-256 matches the fixture before cleanup.

- [x] **Step 7: Commit**

```bash
git add src/worker/services/r2Multipart.ts src/worker/routes/jobs.ts src/worker/env.ts config/r2-cors.json test/worker/r2Multipart.test.ts
git commit -m "feat: stage local uploads in R2"
```
