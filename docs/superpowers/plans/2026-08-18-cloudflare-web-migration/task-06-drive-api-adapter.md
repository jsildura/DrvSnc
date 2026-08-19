# Task 6: Build The Server-Side Drive API Adapter

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Create: `src/worker/services/driveClient.ts`
- Create: `src/worker/routes/drive.ts`
- Create: `test/unit/driveClient.test.ts`
- Create: `test/worker/drive.test.ts`
- Modify: `src/worker/index.ts`

**Interfaces:**
- Consumes: authenticated user ID and `googleAuth.refreshAccessToken`.
- Produces: normalized `DriveItemView`, `DrivePage`, `PermissionView`, quota DTOs, and all `/api/v1/drive/*` endpoints except upload workflows.

- [x] **Step 1: Write failing adapter tests**

Mock Google responses for token refresh, pagination, 401 refresh-and-retry once, 403 permission failure, 429/5xx `Retry-After`, folder/list/search query escaping, Shared-with-me, trash, Workspace export formats, permission changes, signed-out access, and cross-user resource access. Assert Google error bodies are not returned verbatim.

- [x] **Step 2: Implement a normalized Drive client**

Move behavior from `src/lib/drive.ts` and direct calls in `src/sw.ts` into methods `listFolders`, `createFolder`, `listItems`, `search`, `listShared`, `listTrash`, `quota`, `rename`, `move`, `trash`, `restore`, `deletePermanently`, `emptyTrash`, `permissions`, `addPermission`, `updatePermission`, `removePermission`, `setPublicAccess`, `download`, `exportFile`, `startResumableUpload`, `queryResumableOffset`, and `uploadChunk`.

- [x] **Step 3: Centralize account-token resolution**

Each method receives `userId`, resolves that user's sole Google credential in D1, decrypts the refresh token, refreshes access server-side, and updates credential health/last-used timestamps. No route receives an account ID or returns a Google token.

- [x] **Step 4: Implement metadata and permission routes**

Validate `pageToken`, `pageSize <= 100`, sort enums, MIME/date/location filters, folder/file IDs, names up to 255 characters, role enums, and emails. Require CSRF for changes and derive identity only from the authenticated session.

- [x] **Step 5: Implement streaming downloads**

Choose Drive `alt=media` for binary files and explicit export MIME types for Google Docs/Sheets/Slides/Drawings. Pipe `response.body`, preserve safe range/status headers where supported, and set `Content-Disposition` using an ASCII fallback plus RFC 5987 filename. Cancel the upstream body if the browser disconnects.

- [x] **Step 6: Verify Drive boundary**

Run `npm test -- test/unit/driveClient.test.ts test/worker/drive.test.ts`, type-check, lint, and an integration script against the dedicated test account for list/create/rename/trash/restore/download. Expected: mocked suite passes and integration operations leave the fixture account restored.

- [x] **Step 7: Commit**

```bash
git add src/worker/services/driveClient.ts src/worker/routes/drive.ts src/worker/index.ts test/unit/driveClient.test.ts test/worker/drive.test.ts
git commit -m "feat: expose Drive operations through web API"
```
