# Task 15: Migrate Settings And Remove Personal Backend Configuration

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Create: `test/web/Settings.test.tsx`
- Modify: `src/components/SettingsContent.tsx`
- Modify: `src/components/AccountManager.tsx`
- Modify: `src/web/routes/SettingsPage.tsx`
- Reference: `src/components/GitHubActionsConfig.tsx`
- Reference: `src/components/GitHubQuickSetup.tsx`
- Reference: `src/components/AppsScriptQuickSetup.tsx`
- Reference: `src/components/ServiceConfigManager.tsx`

**Interfaces:**
- Consumes: current-profile, account-deletion, remembered-hint, and preference APIs.
- Produces: hosted settings for theme, filename, notifications, default folder, current-account deletion, remembered-account management, and history deletion.

- [x] **Step 1: Write failing settings tests**

Cover preferences save/rollback, theme first paint, default folder, logout and sign in as another account, revoked-account reauthentication, current-account deletion confirmation, remembered-hint forget/clear, and clear-history confirmation.

- [x] **Step 2: Remove backend setup surfaces**

Do not render GitHub PAT/repository, Apps Script URL, Cloud Run URL/key, refresh-token secret naming, or backend-routing controls. Cloudflare orchestration is service-owned and has no user configuration.

- [x] **Step 3: Replace the multi-account manager**

Replace the connected-account list and switcher with the current profile, **Log out**, **Log out and forget this account**, **Sign in with another Google account**, and **Delete app account**. Display safe health states `connected` and `reauthentication required`; never show provider tokens or token diagnostics. The signed-out `AuthGate` owns the remembered-account list.

- [x] **Step 4: Verify settings**

Run `npm test -- test/web/Settings.test.tsx`, type-check, lint, and Playwright mobile/desktop settings flows. Search rendered snapshots for `GitHub token`, `Apps Script`, `Cloud Run`, `refresh token`, and `client secret`; expected: no matches.

- [x] **Step 5: Commit**

```bash
git add src/web/routes/SettingsPage.tsx test/web/Settings.test.tsx
git commit -m "feat: migrate hosted account settings"
```
