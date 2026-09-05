import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT_COLOR,
  applyAccentColor,
  getStoredAccentColor,
  storeAccentColor,
  resolveAccentHex,
  getLuminance,
  getContrastRatio,
  getContrastText,
  ensureContrastOnLight,
  ensureContrastOnDark,
} from '../../src/web/theme/accentColors';
import { SettingsPage } from '../../src/web/routes/SettingsPage';
import { AppProvider } from '../../src/web/state/AppProvider';

describe('Accent Colors Module & Settings Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cleanup();
    localStorage.clear();
    const root = document.documentElement;
    root.style.removeProperty('--color-accent');
    root.style.removeProperty('--color-accent-hover');
    root.style.removeProperty('--color-accent-contrast');
    root.style.removeProperty('--color-accent-on');
    root.style.removeProperty('--color-accent-light');
    root.style.removeProperty('--color-accent-dark');
    root.style.removeProperty('--color-accent-text');
    root.style.removeProperty('--color-accent-text-dark');
    root.style.removeProperty('--color-accent-ring');
  });

  describe('accentColors utility functions', () => {
    it('has sensible default and preset definitions', () => {
      expect(DEFAULT_ACCENT_COLOR).toBe('#4f46e5');
      expect(ACCENT_PRESETS.length).toBeGreaterThanOrEqual(6);
      expect(ACCENT_PRESETS.some((p) => p.id === 'indigo')).toBe(true);
      expect(ACCENT_PRESETS.some((p) => p.id === 'emerald')).toBe(true);
    });

    it('calculates WCAG contrast ratios and selects readable text color', () => {
      // Dark backgrounds should use white text
      expect(getContrastText('#4f46e5')).toBe('#ffffff'); // Indigo
      expect(getContrastText('#059669')).toBe('#ffffff'); // Emerald
      expect(getContrastText('#000000')).toBe('#ffffff'); // Pure Black
      expect(getContrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);

      // Light backgrounds should use dark slate text
      expect(getContrastText('#facc15')).toBe('#0f172a'); // Yellow
      expect(getContrastText('#ffffff')).toBe('#0f172a'); // White
      expect(getContrastText('#a3e635')).toBe('#0f172a'); // Lime

      // Contrast ratio of selected text should always meet WCAG standards
      const darkRatio = getContrastRatio('#4f46e5', getContrastText('#4f46e5'));
      expect(darkRatio).toBeGreaterThanOrEqual(4.5);

      const lightRatio = getContrastRatio('#facc15', getContrastText('#facc15'));
      expect(lightRatio).toBeGreaterThanOrEqual(4.5);
    });

    it('ensures text contrast on light and dark surfaces', () => {
      // Light surface (#ffffff): very light color should be darkened for readability
      const readableOnWhite = ensureContrastOnLight('#facc15', 4.5);
      expect(getContrastRatio(readableOnWhite, '#ffffff')).toBeGreaterThanOrEqual(4.5);

      // Dark surface (#252527): very dark color should be lightened for readability
      const readableOnDark = ensureContrastOnDark('#1e1b4b', 4.5);
      expect(getContrastRatio(readableOnDark, '#252527')).toBeGreaterThanOrEqual(4.5);
    });

    it('resolves presets or returns hex directly, falling back safely for legacy/invalid schemes', () => {
      expect(resolveAccentHex('emerald')).toBe('#059669');
      expect(resolveAccentHex('#123456')).toBe('#123456');
      expect(resolveAccentHex(undefined)).toBe('#4f46e5');
      expect(resolveAccentHex('drive')).toBe('#4f46e5');
      expect(resolveAccentHex('default')).toBe('#4f46e5');
      expect(resolveAccentHex('invalid_color')).toBe('#4f46e5');
      expect(resolveAccentHex('slate')).toBe('#4f46e5');
    });

    it('applies CSS variables to document.documentElement with valid hex and contrast values', () => {
      applyAccentColor('#059669');
      const root = document.documentElement;
      expect(root.style.getPropertyValue('--color-accent')).toBe('#059669');
      expect(root.style.getPropertyValue('--color-accent-hover')).toBeTruthy();
      expect(root.style.getPropertyValue('--color-accent-contrast')).toBe('#ffffff');
      expect(root.style.getPropertyValue('--color-accent-on')).toBe('#ffffff');
      expect(root.style.getPropertyValue('--color-accent-light')).toContain('rgba');
      expect(root.style.getPropertyValue('--color-accent-dark')).toContain('rgba');
      expect(root.style.getPropertyValue('--color-accent-border')).toContain('rgba');
      expect(root.style.getPropertyValue('--color-accent-ring')).toContain('rgba');

      // Test bright color sets dark contrast text (#0f172a)
      applyAccentColor('#facc15');
      expect(root.style.getPropertyValue('--color-accent')).toBe('#facc15');
      expect(root.style.getPropertyValue('--color-accent-contrast')).toBe('#0f172a');
      expect(root.style.getPropertyValue('--color-accent-on')).toBe('#0f172a');

      // Test that applying legacy 'drive' or invalid color safely sets default hex #4f46e5
      applyAccentColor('drive');
      expect(root.style.getPropertyValue('--color-accent')).toBe('#4f46e5');
      expect(root.style.getPropertyValue('--color-accent-contrast')).toBe('#ffffff');
      expect(root.style.getPropertyValue('--color-accent-hover')).toBeTruthy();
      expect(root.style.getPropertyValue('--color-accent-hover')).not.toBe('#drive');
    });

    it('stores and retrieves accent color from localStorage, sanitizing legacy values', () => {
      expect(getStoredAccentColor()).toBe(DEFAULT_ACCENT_COLOR);
      storeAccentColor('#2563eb');
      expect(getStoredAccentColor()).toBe('#2563eb');

      // If legacy storage has 'drive', it should sanitize to DEFAULT_ACCENT_COLOR
      localStorage.setItem('gdu_accent_color', 'drive');
      expect(getStoredAccentColor()).toBe(DEFAULT_ACCENT_COLOR);
    });
  });

  describe('SettingsPage Accent Color Picker', () => {
    const mockUser = {
      id: 'usr-accent-1',
      email: 'test@example.com',
      name: 'Accent Tester',
      picture: null,
    };

    const mockPreferences = {
      userId: 'usr-accent-1',
      themeMode: 'dark',
      colorScheme: '#4f46e5',
      filenamePattern: '{filename}',
      notificationsEnabled: true,
      rememberAccount: true,
      updatedAt: new Date().toISOString(),
    };

    it('renders accent swatches and custom color picker', async () => {
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
        if (url === '/api/v1/seedr/status') {
          return new Response(JSON.stringify({ connected: false }), {
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
        expect(screen.getByText('Accent Tester')).toBeDefined();
        expect(screen.getByText('Appearance')).toBeDefined();
      });

      // Swatches for presets should exist
      ACCENT_PRESETS.forEach((preset) => {
        expect(screen.getByTitle(preset.name)).toBeDefined();
      });

      // Custom color picker exists
      const customInput = screen.getByTitle('Custom accent color') as HTMLInputElement;
      expect(customInput).toBeDefined();
      expect(customInput.type).toBe('color');
    });

    it('changes accent color when a swatch is clicked and updates CSS variables', async () => {
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
        if (url === '/api/v1/seedr/status') {
          return new Response(JSON.stringify({ connected: false }), {
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
        expect(screen.getByText('Appearance')).toBeDefined();
      });

      // Click Emerald preset swatch
      const emeraldBtn = screen.getByTitle('Emerald');
      fireEvent.click(emeraldBtn);

      await waitFor(() => {
        expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#059669');
        expect(localStorage.getItem('gdu_accent_color')).toBe('#059669');
      });
    });

    it('applies text-accent classes to active navigation tabs and upload mode switchers', async () => {
      // Test UploadForm mode switcher
      const { UploadForm } = await import('../../src/web/uploads/UploadForm');
      const { render: renderForm } = await import('@testing-library/react');
      
      const stubRelay = {
        relayProgress: {},
        isRelaying: false,
        startRelay: async () => {},
        cancelRelay: () => {},
      };
      
      const { unmount } = renderForm(
        <AppProvider>
          <UploadForm onJobCreated={() => {}} relay={stubRelay} />
        </AppProvider>
      );

      // Local file tab is active by default
      const localTab = screen.getByRole('button', { name: /local file/i });
      expect(localTab.className).toContain('text-accent');
      expect(localTab.className).toContain('dark:text-accent-textDark');

      // Switch to Remote URL
      const remoteTab = screen.getByRole('button', { name: /remote url/i });
      fireEvent.click(remoteTab);
      expect(remoteTab.className).toContain('text-accent');
      expect(remoteTab.className).toContain('dark:text-accent-textDark');

      unmount();
    });

    it('persists user-selected accent color across page refresh even if server returns default drive scheme', async () => {
      // User has Emerald stored locally in localStorage
      localStorage.setItem('gdu_accent_color', '#059669');

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === '/api/v1/session') {
          return new Response(JSON.stringify({ user: mockUser }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url === '/api/v1/preferences') {
          // Server has the uncustomized default 'drive'
          return new Response(
            JSON.stringify({ ...mockPreferences, colorScheme: 'drive' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url === '/api/v1/seedr/status') {
          return new Response(JSON.stringify({ connected: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Not Found', { status: 404 });
      });

      const { unmount } = render(
        <AppProvider>
          <SettingsPage />
        </AppProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Accent Tester')).toBeDefined();
      });

      // Verify that after refreshSession finishes, the user's Emerald accent color is preserved!
      expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#059669');
      expect(localStorage.getItem('gdu_accent_color')).toBe('#059669');

      unmount();
    });
  });
});

