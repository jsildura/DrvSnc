/**
 * Mapping between the dashboard's tabs and the browser URL.
 *
 * Kept free of React and DOM dependencies so the mapping can be unit tested on
 * its own, and so callers decide when to touch `history`.
 */

export type AppTab = 'uploader' | 'drive' | 'settings';

/** Shown while signed out. Matches the path the worker already redirects to on
 *  auth failure (see src/worker/routes/auth.ts). */
export const LOGIN_PATH = '/login';

/**
 * Canonical path per tab. `/uploads` (not `/uploader`) matches both the visible
 * nav label and the post-OAuth redirect in src/worker/routes/auth.ts.
 */
export const TAB_PATHS: Record<AppTab, string> = {
  uploader: '/uploads',
  drive: '/drive',
  settings: '/settings',
};

const PATH_TO_TAB = new Map<string, AppTab>([
  ['/uploads', 'uploader'],
  // The tab id is `uploader`, so accept that spelling as an alias rather than 404-ing to the default.
  ['/uploader', 'uploader'],
  ['/drive', 'drive'],
  ['/settings', 'settings'],
]);

export function pathForTab(tab: AppTab): string {
  return TAB_PATHS[tab];
}

/**
 * Resolve a URL path to a tab. Unrecognised paths — including `/` and
 * `/login` — fall back to the uploader, which is the app's landing tab.
 */
export function tabForPath(pathname: string): AppTab {
  const normalized = pathname.toLowerCase().replace(/\/+$/, '');
  return PATH_TO_TAB.get(normalized || '/') ?? 'uploader';
}
