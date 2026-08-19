# Task 2: Scaffold The Cloudflare Full-Stack Runtime

> **Plan index:** [Cloudflare Web Migration Implementation Plan](../2026-08-18-cloudflare-web-migration.md)
> **Execution:** Complete this task only after all earlier numbered tasks are complete and verified.

**Files:**
- Create: `index.html`
- Create: `src/web/main.tsx`
- Create: `src/web/App.tsx`
- Create: `src/worker/index.ts`
- Create: `src/worker/env.ts`
- Create: `wrangler.jsonc`
- Create: `.dev.vars.example`
- Create: `vitest.config.ts`
- Create: `test/worker/health.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Modify: `vite.config.ts`

**Interfaces:**
- Produces: `Env`, Hono `App`, `GET /api/v1/health`, SPA static-asset fallback, and scripts `dev`, `test`, `test:watch`, `test:e2e`, `build`, `deploy:staging`, `deploy:production`, `db:migrate:local`, `db:migrate:staging`.

- [x] **Step 1: Add the failing health route test**

Use `@cloudflare/vitest-pool-workers` to call `SELF.fetch('https://example.com/api/v1/health')`; assert status 200 and exact shape `{ status: 'ok', version: 1 }`. Add a second assertion that `/settings` returns the SPA document rather than a 404.

- [x] **Step 2: Run the test to prove the runtime is absent**

Run `npm test -- test/worker/health.test.ts`. Expected: failure because the Worker entry and test pool are not configured.

- [x] **Step 3: Install runtime and test dependencies**

Add `hono`, `zod`, `aws4fetch`, `@cloudflare/vite-plugin`, `wrangler`, `vitest`, `@cloudflare/vitest-pool-workers`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`, and `@playwright/test`. Keep existing React and Material UI versions for the migration.

- [x] **Step 4: Configure one Worker deployment**

Set `compatibility_date` to `2026-08-18`, enable Node compatibility only if a verified dependency needs it, route `/api/*` through the Worker first, configure SPA not-found handling, and define placeholder bindings `DB`, `UPLOADS`, `DRIVE_TRANSFER`, and `DRIVE_COPY`. Do not add production resource IDs to source until resources exist.

- [x] **Step 5: Replace extension-specific Vite inputs**

Make `index.html` the sole browser entry. Remove manifest copying, nested popup/options HTML moves, service worker/content-script Rollup inputs, and visualizer from default builds. Keep the extension source files in the repository but outside the web build graph.

- [x] **Step 6: Implement the minimal Worker and SPA shell**

`src/worker/index.ts` handles `/api/v1/health` and delegates non-API requests to static assets. `src/web/App.tsx` renders a stable loading shell with the existing Material theme and responsive viewport metadata.

- [x] **Step 7: Verify scaffold**

Run `npm test -- test/worker/health.test.ts`, `npm run type-check`, `npm run lint`, `npm run build`, and `npx wrangler deploy --dry-run`. Expected: all pass and dry-run reports a Worker plus static assets.

- [x] **Step 8: Commit**

```bash
git add index.html src/web src/worker package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts wrangler.jsonc .dev.vars.example test/worker/health.test.ts
git commit -m "feat: scaffold Cloudflare web runtime"
```
