# Task 5: Add Current Account And Preference APIs

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Create: `src/worker/routes/account.ts`
- Create: `src/worker/routes/preferences.ts`
- Create: `test/worker/account.test.ts`
- Create: `test/worker/preferences.test.ts`
- Modify: `src/worker/index.ts`

**Interfaces:**
- Consumes: authenticated session, encrypted Google credential, `AccountView`, `PreferencesView`.
- Produces: current-account deletion and single-account preferences.

- [x] **Step 1: Write ownership and preference tests**

Cover current profile retrieval through session, cross-user account deletion returning 404, revocation before deletion, deletion of credentials/sessions, cancellation of non-terminal jobs, one default folder, theme/color validation, filename pattern length, and response redaction.

- [x] **Step 2: Run tests and confirm route absence**

Run `npm test -- test/worker/account.test.ts test/worker/preferences.test.ts`. Expected: 404/failing assertions.

- [x] **Step 3: Implement current-account deletion**

`DELETE /api/v1/account` revokes Google access where possible, removes encrypted credentials, cancels the user's non-terminal jobs, deletes all application sessions for that user, and schedules metadata deletion under the retention policy. Signing into another Google identity is logout followed by a new OAuth login; there is no connect endpoint.

- [x] **Step 4: Implement preferences routes**

Store `theme`, `colorScheme`, `filenamePattern`, `notificationsEnabled`, `defaultFolderId`, and `defaultFolderName` for the current user. Treat web notifications as in-page completion notices; browser push is not part of v1.

- [x] **Step 5: Verify routes**

Run current-account/preference tests, `npm run type-check`, and `npm run lint`. Expected: pass.

- [x] **Step 6: Commit**

```bash
git add src/worker/routes src/worker/index.ts test/worker/account.test.ts test/worker/preferences.test.ts
git commit -m "feat: add current account and preferences"
```
