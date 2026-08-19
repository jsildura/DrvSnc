# Task 14: Migrate Drive Browser, Search, Sharing, Preview, And Downloads

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Create: `src/web/api/drive.ts`
- Create: `test/web/DrivePage.test.tsx`
- Modify: `src/components/DriveFileBrowser.tsx`
- Modify: `src/components/SearchComponent.tsx`
- Modify: `src/components/SharedWithMeView.tsx`
- Modify: `src/components/ShareDialog.tsx`
- Modify: `src/components/StorageDisplay.tsx`
- Modify: `src/components/FilePreview.tsx`
- Modify: `src/popup/FolderTreeView.tsx`
- Modify: `src/web/routes/DrivePage.tsx`

**Interfaces:**
- Consumes: Drive API routes and normalized DTOs.
- Produces: web-native Drive management with no Chrome API or Google token dependency.

- [x] **Step 1: Write failing Drive UI tests**

Cover folder pagination/navigation, fresh state after logging into a different Google identity, current user's default folder, search filters and escaping, Shared with me, storage quota, rename/move/trash/restore/permanent-delete confirmations, empty-trash job progress, permission CRUD, preview fallback, regular/Workspace download, and bulk actions.

- [x] **Step 2: Implement Drive web client**

Create typed methods for every Drive endpoint. Downloads use browser navigation to the streaming endpoint; bulk download issues bounded individual downloads in v1 rather than building ZIPs in Worker memory. Remove the existing cross-account copy control because only one Google identity can be active per app session.

- [x] **Step 3: Remove Chrome and token dependencies component by component**

Pass API methods through focused props or hooks. Remove account-ID selectors, `chrome.runtime`, `chrome.storage`, `chrome.downloads`, `chrome.tabs`, direct Drive fetches, and token reads. Replace `chrome.tabs.create` with safe `window.open(url, '_blank', 'noopener,noreferrer')` and Chrome downloads with `<a download>`/navigation.

- [x] **Step 4: Make preview behavior explicit**

Try the existing Google Drive embed for private fixture files under the production CSP. If third-party session behavior prevents reliable preview, show metadata plus Open in Drive and Download actions; do not proxy private preview bytes into a public URL.

- [x] **Step 5: Verify feature parity**

Run component tests and Playwright scenarios across all fixture types and viewports. Run `rg "chrome\.|TokenResponse|access_token|refresh_token" src/web src/components`; expected: no Chrome API or token dependency in the web graph.

- [x] **Step 6: Commit**

```bash
git add src/web/api/drive.ts src/web/routes/DrivePage.tsx test/web/DrivePage.test.tsx
git commit -m "feat: migrate Drive management to web APIs"
```
