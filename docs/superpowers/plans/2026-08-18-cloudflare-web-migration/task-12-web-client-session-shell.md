# Task 12: Build The Typed Web Client And Session Shell

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Create: `src/web/api/client.ts`
- Create: `src/web/auth/AuthGate.tsx`
- Create: `src/web/state/AppProvider.tsx`
- Create: `src/web/routes/UploaderPage.tsx`
- Create: `src/web/routes/DrivePage.tsx`
- Create: `src/web/routes/SettingsPage.tsx`
- Create: `test/web/App.test.tsx`
- Modify: `src/web/App.tsx`

**Interfaces:**
- Consumes: `/api/v1/session`, profile/preference contracts, secure cookie session.
- Produces: `apiRequest<T>`, application context, sign-in/sign-out/account-choice controls, route shell, and error boundary.

- [x] **Step 1: Write failing shell tests**

Test loading, signed-out, signed-in, expired session, provider error code, remembered-account selection, logout with remember on/off, sign-in as another Google identity, CSRF header on mutations, 401 reset, safe API error rendering, and narrow/mobile navigation without text overflow.

- [x] **Step 2: Implement the typed API client**

Use same-origin `fetch` with `credentials: 'same-origin'`, JSON content negotiation, CSRF cookie/header propagation on mutations, `AbortSignal`, stable `ApiError` mapping, and request IDs. Do not store session data in localStorage.

- [x] **Step 3: Implement application state**

Load the current session profile and preferences once; expose logout and account deletion actions. On the signed-out screen, load remembered profile hints through `rememberedAccounts.ts`. Keep theme in localStorage only as a first-paint optimization, then reconcile it with server preferences. Use normal React state and effects consistent with React 18; do not introduce a global state library.

- [x] **Step 4: Implement responsive routes**

Use a compact top app bar plus desktop navigation rail/mobile bottom navigation for Uploads, Drive, and Settings. Reuse the existing Material theme and color schemes, but remove popup-fixed dimensions and ensure controls fit at 360x800, 768x1024, and 1440x900.

- [x] **Step 5: Verify shell**

Run `npm test -- test/web/App.test.tsx`, type-check, lint, and Playwright screenshots of all three viewports. Expected: no horizontal page scroll, overlap, clipped controls, or raw provider errors.

- [x] **Step 6: Commit**

```bash
git add src/web test/web/App.test.tsx vitest.config.ts
git commit -m "feat: add authenticated web application shell"
```
