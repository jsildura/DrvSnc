import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthGate } from '../../src/web/auth/AuthGate';
import { AppProvider } from '../../src/web/state/AppProvider';
import { rememberAccount } from '../../src/web/auth/rememberedAccounts';

describe('AuthGate Component (<AuthGate />)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('reactively updates account tiles when storage or custom events fire', async () => {
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

    render(
      <AppProvider>
        <AuthGate>
          <div>Protected Content</div>
        </AuthGate>
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('CloudDrive Sync')).toBeDefined();
      expect(screen.getByText('Sign in with Google')).toBeDefined();
      expect(screen.queryByText('Choose an account')).toBeNull();
    });

    // Dynamically remember an account (which triggers gdu:remembered_accounts_changed)
    rememberAccount({
      sub: 'sub-gate-1',
      email: 'dyn@example.com',
      name: 'Dynamic User',
    });

    await waitFor(() => {
      expect(screen.getByText('Choose an account')).toBeDefined();
      expect(screen.getByText('Dynamic User')).toBeDefined();
      expect(screen.getByText('dyn@example.com')).toBeDefined();
    });
  });
});
