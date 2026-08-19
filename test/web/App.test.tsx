import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../../src/web/App';

describe('Web Client Application Shell (<App />)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Google sign-in screen when user is unauthenticated', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/v1/session') {
        return new Response(JSON.stringify({ user: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('CloudDrive Sync')).toBeDefined();
      expect(screen.getByText('Sign in with Google')).toBeDefined();
    });
  });

  it('renders authenticated dashboard and allows tab navigation', async () => {
    const mockUser = {
      id: 'usr-web-1',
      email: 'test@example.com',
      name: 'Test User',
      picture: null,
    };

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/v1/session') {
        return new Response(JSON.stringify({ user: mockUser }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/v1/preferences') {
        return new Response(
          JSON.stringify({
            userId: 'usr-web-1',
            themeMode: 'dark',
            colorScheme: 'slate',
            filenamePattern: '{filename}',
            notificationsEnabled: true,
            rememberAccount: true,
            updatedAt: new Date().toISOString(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/v1/jobs')) {
        return new Response(JSON.stringify({ jobs: [], nextCursor: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText('Uploads').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Upload Files')).toBeDefined();
    });

    // Switch to Drive tab
    const driveTabs = screen.getAllByText('Drive');
    fireEvent.click(driveTabs[0]);

    await waitFor(() => {
      expect(screen.getByText('Google Drive Explorer')).toBeDefined();
    });

    // Switch to Settings tab
    const settingsTabs = screen.getAllByText('Settings');
    fireEvent.click(settingsTabs[0]);

    await waitFor(() => {
      expect(screen.getByText('Connected Account')).toBeDefined();
      expect(screen.getByText('Appearance')).toBeDefined();
    });
  });
});
