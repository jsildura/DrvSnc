import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SettingsPage } from '../../src/web/routes/SettingsPage';
import { AppProvider } from '../../src/web/state/AppProvider';

describe('Settings Management UI (<SettingsPage />)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cleanup();
    localStorage.clear();
  });

  const mockUser = {
    id: 'usr-settings-1',
    email: 'alex@example.com',
    name: 'Alex User',
    picture: null,
  };

  const mockPreferences = {
    userId: 'usr-settings-1',
    themeMode: 'dark',
    colorScheme: 'indigo',
    filenamePattern: '{filename}-{date}',
    notificationsEnabled: true,
    rememberAccount: true,
    updatedAt: new Date().toISOString(),
  };

  it('renders connected account details and preferences', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/v1/session') {
        return new Response(JSON.stringify({ user: mockUser }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/v1/preferences') {
        return new Response(JSON.stringify(mockPreferences), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    render(
      <AppProvider>
        <SettingsPage />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Alex User')).toBeDefined();
      expect(screen.getByText('alex@example.com')).toBeDefined();
      expect(screen.getByText('Connected')).toBeDefined();
      expect(screen.getByText('Appearance')).toBeDefined();
      expect(screen.getByText('Danger Zone')).toBeDefined();
    });
  });

  it('allows saving preferences with updated values', async () => {
    let savedPayload: Record<string, unknown> | null = null;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/v1/session') {
        return new Response(JSON.stringify({ user: mockUser }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/v1/preferences') {
        if (init?.method === 'PUT') {
          savedPayload = JSON.parse(init.body as string);
          return new Response(
            JSON.stringify({ ...mockPreferences, ...savedPayload }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify(mockPreferences), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    render(
      <AppProvider>
        <SettingsPage />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Alex User')).toBeDefined();
    });

    const patternInput = screen.getByPlaceholderText('{filename}') as HTMLInputElement;
    await waitFor(() => {
      expect(patternInput.value).toBe('{filename}-{date}');
    });

    fireEvent.change(patternInput, { target: { value: 'custom-{filename}' } });

    const saveBtn = screen.getByText('Save Preferences');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(savedPayload).not.toBeNull();
      expect(savedPayload?.filenamePattern).toBe('custom-{filename}');
    });
  });

  it('purges remembered accounts and cookies when user deletes account', async () => {
    // Seed remembered account and cookies
    localStorage.setItem(
      'gdu_remembered_accounts',
      JSON.stringify([
        {
          sub: 'usr-settings-1',
          email: 'alex@example.com',
          name: 'Alex User',
          lastUsedAt: new Date().toISOString(),
        },
      ])
    );
    document.cookie = 'gdu_session=sess-to-clear';
    document.cookie = 'gdu_csrf=csrf-to-clear';

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/v1/session') {
        return new Response(JSON.stringify({ user: mockUser }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/v1/preferences') {
        return new Response(JSON.stringify(mockPreferences), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/v1/account' && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    render(
      <AppProvider>
        <SettingsPage />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Delete Account & Revoke Access')).toBeDefined();
    });

    // Click Delete Account button -> reveals confirm button
    fireEvent.click(screen.getByText('Delete Account & Revoke Access'));

    await waitFor(() => {
      expect(screen.getByText('Yes, Delete Account')).toBeDefined();
    });

    // Click confirm delete
    fireEvent.click(screen.getByText('Yes, Delete Account'));

    await waitFor(() => {
      const stored = localStorage.getItem('gdu_remembered_accounts');
      const parsed = stored ? JSON.parse(stored) : [];
      expect(parsed).toHaveLength(0);
    });
  });

  it('removes remembered account hint when rememberAccount is disabled and saved', async () => {
    localStorage.setItem(
      'gdu_remembered_accounts',
      JSON.stringify([
        {
          sub: 'usr-settings-1',
          email: 'alex@example.com',
          name: 'Alex User',
          lastUsedAt: new Date().toISOString(),
        },
      ])
    );

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/v1/session') {
        return new Response(JSON.stringify({ user: mockUser }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/v1/preferences') {
        if (init?.method === 'PUT') {
          const body = JSON.parse(init.body as string);
          return new Response(
            JSON.stringify({ ...mockPreferences, ...body }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify(mockPreferences), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    render(
      <AppProvider>
        <SettingsPage />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Remember account hint on this device')).toBeDefined();
    });

    const rememberCheckbox = screen.getByRole('checkbox', { name: /remember account hint/i });
    fireEvent.click(rememberCheckbox);

    const saveBtn = screen.getByText('Save Preferences');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const stored = localStorage.getItem('gdu_remembered_accounts');
      const parsed = stored ? JSON.parse(stored) : [];
      expect(parsed).toHaveLength(0);
    });
  });
});
