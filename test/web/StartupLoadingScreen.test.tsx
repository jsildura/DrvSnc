import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { StartupLoadingScreen } from '../../src/web/components/StartupLoadingScreen';

describe('<StartupLoadingScreen /> Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/v1/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders brand title, app icon, environment checking phase and progress bar', () => {
    render(<StartupLoadingScreen minPhaseDuration={500} isSessionLoading={true} />);

    expect(screen.getByTestId('startup-loading-screen')).toBeDefined();
    expect(screen.getByText('CloudDrive Sync')).toBeDefined();
    expect(screen.getByText('Checking environment')).toBeDefined();
    expect(screen.getByTestId('startup-progress-bar')).toBeDefined();

    const img = screen.getByAltText('CloudDrive Sync');
    expect(img).toBeDefined();
    expect(img.getAttribute('src')).toBe('/icon.png');
  });

  it('progresses through environment and session phases and calls onComplete', async () => {
    const onComplete = vi.fn();

    render(
      <StartupLoadingScreen
        minPhaseDuration={10}
        isSessionLoading={false}
        onComplete={onComplete}
      />
    );

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it('halts with error and displays Retry button when /api/v1/health fails, and resumes on retry', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    // First attempt fails (API gateway unavailable)
    fetchSpy.mockRejectedValueOnce(new Error('Connection refused'));
    const onComplete = vi.fn();

    render(
      <StartupLoadingScreen
        minPhaseDuration={10}
        isSessionLoading={false}
        onComplete={onComplete}
      />
    );

    // Should halt with API gateway error and show retry button
    await waitFor(() => {
      expect(screen.getByText('API Gateway Unavailable')).toBeDefined();
      expect(screen.getByText('Retry Connection')).toBeDefined();
    });

    expect(onComplete).not.toHaveBeenCalled();

    // Now restore API health and click Retry Connection
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    const retryBtn = screen.getByText('Retry Connection');
    retryBtn.click();

    // After retry, should proceed and complete
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it('halts with error when offline, and auto-recovers when online event fires', async () => {
    const originalOnLine = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    const onComplete = vi.fn();

    render(
      <StartupLoadingScreen
        minPhaseDuration={10}
        isSessionLoading={false}
        onComplete={onComplete}
      />
    );

    // Should halt with offline error
    await waitFor(() => {
      expect(screen.getByText('No Internet Connection')).toBeDefined();
    });

    expect(onComplete).not.toHaveBeenCalled();

    // Restore online state and dispatch event
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    window.dispatchEvent(new Event('online'));

    // Should auto-recover and complete
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });

    // Cleanup
    Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true });
  });

  it('progresses after isSessionLoading switches from true to false', async () => {
    const onComplete = vi.fn();

    const { rerender } = render(
      <StartupLoadingScreen
        minPhaseDuration={10}
        isSessionLoading={true}
        onComplete={onComplete}
      />
    );

    // Allow environment phase to complete
    await new Promise((r) => setTimeout(r, 30));

    // Session finishes loading
    rerender(
      <StartupLoadingScreen
        minPhaseDuration={10}
        isSessionLoading={false}
        onComplete={onComplete}
      />
    );

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it('progresses through ready state and calls onComplete with exit transition', async () => {
    const onComplete = vi.fn();

    render(
      <StartupLoadingScreen
        minPhaseDuration={60}
        isSessionLoading={false}
        onComplete={onComplete}
      />
    );

    // Should display environment check first
    expect(screen.getByText('Checking environment')).toBeDefined();

    // After env and session phases, should show ready state
    await waitFor(() => {
      expect(screen.getByText('Ready')).toBeDefined();
    }, { timeout: 2000 });

    // Then should call onComplete
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    }, { timeout: 2000 });
  });
});
