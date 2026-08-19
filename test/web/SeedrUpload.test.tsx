import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { UploadForm } from '../../src/web/uploads/UploadForm';

function mockJsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Seedr Magnet Upload Form UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('switches to Magnet / Torrent tab and initiates device pairing when not connected', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/v1/seedr/status')) {
        return mockJsonResponse({ connected: false });
      }
      if (url.includes('/api/v1/seedr/device/code')) {
        return mockJsonResponse({
          device_code: 'dev-1234',
          user_code: 'TEST-99',
          verification_url: 'https://www.seedr.cc/devices',
          expires_in: 300,
          interval: 5,
        });
      }
      return mockJsonResponse({});
    });

    render(<UploadForm onJobCreated={() => {}} />);

    // Click Magnet / Torrent tab
    const magnetTab = screen.getByRole('button', { name: /Magnet \/ Torrent/i });
    fireEvent.click(magnetTab);

    // Wait for Seedr onboarding card
    await waitFor(() => {
      expect(screen.getByText(/Remote Torrent & Magnet Downloads/i)).toBeTruthy();
    });

    // Click Connect Free Seedr Account
    const connectBtn = screen.getByRole('button', { name: /Connect Free Seedr\.cc Account/i });
    fireEvent.click(connectBtn);

    // Verify user code is shown
    await waitFor(() => {
      expect(screen.getByText('TEST-99')).toBeTruthy();
      expect(screen.getByText(/Waiting for authorization/i)).toBeTruthy();
    });
  });

  it('renders magnet input form when connected and submits magnet transfer', async () => {
    const onJobCreatedMock = vi.fn();

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/v1/seedr/status')) {
        return mockJsonResponse({
          connected: true,
          username: 'Tester Seedr',
          spaceUsed: 524288000,
          spaceMax: 2147483648,
          torrents: [],
        });
      }
      if (url.includes('/api/v1/seedr/transfer')) {
        return mockJsonResponse({
          success: true,
          status: 'transferring',
          jobId: 'job-seedr-123',
          message: 'Torrent ready! Transferring directly to Google Drive...',
        });
      }
      return mockJsonResponse({});
    });

    render(<UploadForm onJobCreated={onJobCreatedMock} />);

    // Switch to Magnet tab
    const magnetTab = screen.getByRole('button', { name: /Magnet \/ Torrent/i });
    fireEvent.click(magnetTab);

    // Wait for textarea to appear when connected
    const textarea = await screen.findByPlaceholderText('magnet:?xt=urn:btih:...');
    expect(textarea).toBeTruthy();

    // Fill in magnet link
    fireEvent.change(textarea, {
      target: { value: 'magnet:?xt=urn:btih:abcdef1234567890' },
    });

    // Submit
    const submitBtn = screen.getByRole('button', { name: /Download Magnet & Transfer to Drive/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onJobCreatedMock).toHaveBeenCalled();
      expect(screen.getByText(/Torrent ready! Transferring directly to Google Drive\.\.\./i)).toBeTruthy();
    });
  });
});
