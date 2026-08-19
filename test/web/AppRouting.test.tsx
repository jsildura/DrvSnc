import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { App } from '../../src/web/App';

/**
 * The dashboard's active tab is mirrored into the URL. Covers the three reported
 * symptoms: tab clicks never changed the URL, the post-OAuth ?auth=success was
 * never cleaned up, and signing out left the signed-in URL in place.
 */
describe('Dashboard URL routing', () => {
  const mockUser = {
    id: 'usr-web-1',
    email: 'test@example.com',
    name: 'Test User',
    picture: null,
  };

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  /** Mock every endpoint the shell and its three tabs touch on mount. */
  const mockApi = (user: typeof mockUser | null) =>
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/v1/session') return json({ user, csrfToken: user ? 'csrf-1' : undefined });
      if (url === '/api/v1/auth/logout') return json({ ok: true });
      if (url === '/api/v1/preferences')
        return json({
          userId: 'usr-web-1',
          themeMode: 'light',
          colorScheme: 'drive',
          filenamePattern: '{filename}',
          notificationsEnabled: true,
          rememberAccount: true,
          updatedAt: new Date().toISOString(),
        });
      if (url.includes('/api/v1/drive/quota') || url.includes('/api/v1/drive/storage'))
        return json({ usage: 1000, limit: 15000000000, usageInDrive: 1000, usageInDriveTrash: 0 });
      if (url.includes('/api/v1/drive/items')) return json({ items: [], nextPageToken: null });
      if (url.includes('/api/v1/jobs')) return json({ jobs: [], nextCursor: null });

      return new Response('Not Found', { status: 404 });
    });

  const at = (url: string) => window.history.replaceState({}, '', url);

  /**
   * Unique to the login screen and present whether or not a remembered account
   * is offered — the sign-in button's own label flips to "Use another account"
   * once an account has been remembered, so it isn't a reliable marker.
   */
  const LOGIN_MARKER = 'Transfer large files directly to your Google Drive seamlessly';

  beforeEach(() => {
    vi.restoreAllMocks();
    // A signed-in render remembers the account in localStorage, which changes what
    // the login screen offers. Clear it so tests don't inherit each other's state.
    localStorage.clear();
    at('/');
  });

  afterEach(() => {
    cleanup();
    at('/');
  });

  it('strips the ?auth=success left behind by the OAuth callback', async () => {
    globalThis.fetch = mockApi(mockUser);
    at('/uploads?auth=success');

    render(<App />);

    await waitFor(() => expect(screen.getByText('Upload Files')).toBeDefined());
    await waitFor(() => {
      expect(window.location.search).toBe('');
      expect(window.location.pathname).toBe('/uploads');
    });
  });

  it('canonicalises the bare root to /uploads', async () => {
    globalThis.fetch = mockApi(mockUser);
    at('/');

    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe('/uploads'));
  });

  it('opens the tab named by the URL on a deep link', async () => {
    globalThis.fetch = mockApi(mockUser);
    at('/drive');

    render(<App />);

    await waitFor(() => expect(screen.getByText('Google Drive Explorer')).toBeDefined());
    expect(window.location.pathname).toBe('/drive');
  });

  it('pushes a history entry for each tab click', async () => {
    globalThis.fetch = mockApi(mockUser);
    at('/uploads');

    render(<App />);
    await waitFor(() => expect(screen.getByText('Upload Files')).toBeDefined());

    fireEvent.click(screen.getAllByText('Drive')[0]);
    await waitFor(() => {
      expect(screen.getByText('Google Drive Explorer')).toBeDefined();
      expect(window.location.pathname).toBe('/drive');
    });

    fireEvent.click(screen.getAllByText('Settings')[0]);
    await waitFor(() => {
      expect(screen.getByText('Appearance')).toBeDefined();
      expect(window.location.pathname).toBe('/settings');
    });
  });

  it('follows Back/Forward between tabs', async () => {
    globalThis.fetch = mockApi(mockUser);
    at('/uploads');

    render(<App />);
    await waitFor(() => expect(screen.getByText('Upload Files')).toBeDefined());

    fireEvent.click(screen.getAllByText('Drive')[0]);
    await waitFor(() => expect(screen.getByText('Google Drive Explorer')).toBeDefined());

    // jsdom's history.back() delivers popstate asynchronously and flakily, so
    // drive the listener the way the browser would once the URL has moved back.
    at('/uploads');
    window.dispatchEvent(new PopStateEvent('popstate'));

    await waitFor(() => expect(screen.getByText('Upload Files')).toBeDefined());
    expect(screen.queryByText('Google Drive Explorer')).toBeNull();
  });

  it('rewrites a signed-in path to /login when there is no session', async () => {
    globalThis.fetch = mockApi(null);
    at('/drive');

    render(<App />);

    await waitFor(() => expect(screen.getByText(LOGIN_MARKER)).toBeDefined());
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
  });

  it('drops to /login when the user signs out', async () => {
    globalThis.fetch = mockApi(mockUser);
    at('/settings');

    render(<App />);
    await waitFor(() => expect(screen.getByText('Connected Account')).toBeDefined());
    expect(window.location.pathname).toBe('/settings');

    fireEvent.click(screen.getByText('Sign Out'));

    await waitFor(() => expect(screen.getByText(LOGIN_MARKER)).toBeDefined());
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
  });

  it('restores the deep-linked tab in the URL when a session comes back without a page load', async () => {
    // Signed out on a deep link: the URL is rewritten to /login while the tab the
    // path named stays selected underneath. If the session then returns without a
    // reload (bfcache restore, pageshow), the URL has to go back to that tab rather
    // than to the default one.
    globalThis.fetch = mockApi(null);
    at('/drive');

    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe('/login'));

    globalThis.fetch = mockApi(mockUser);
    fireEvent(window, new PageTransitionEvent('pageshow', { persisted: true }));

    await waitFor(() => expect(screen.getByText('Google Drive Explorer')).toBeDefined());
    await waitFor(() => expect(window.location.pathname).toBe('/drive'));
  });
});
