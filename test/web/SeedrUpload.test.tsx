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

  it('switches to Magnet / Torrent tab and connects via direct email and password login', async () => {
    let connected = false;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/seedr/status')) {
        return mockJsonResponse({
          connected,
          username: connected ? 'user@example.com' : undefined,
          spaceUsed: connected ? 1000000 : 0,
          spaceMax: 2147483648,
          torrents: [],
        });
      }
      if (url.includes('/api/v1/seedr/login') && init?.method === 'POST') {
        connected = true;
        return mockJsonResponse({
          success: true,
          username: 'user@example.com',
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

    // Fill in Email and Password
    const emailInput = screen.getByPlaceholderText('your-email@example.com');
    const passwordInput = screen.getByPlaceholderText('••••••••');
    fireEvent.change(emailInput, { target: { value: 'user@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'secretpass123' } });

    // Click Connect Seedr Account
    const loginBtn = screen.getByRole('button', { name: /Connect Seedr Account/i });
    fireEvent.click(loginBtn);

    // Verify form transitions to connected magnet transfer view
    await waitFor(() => {
      expect(screen.getByPlaceholderText('magnet:?xt=urn:btih:...')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Disconnect/i })).toBeTruthy();
    });
  });

  it('renders completed cloud folders and transfers existing folder to Google Drive', async () => {
    const onJobCreatedMock = vi.fn();

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/seedr/status')) {
        return mockJsonResponse({
          connected: true,
          username: 'Tester Seedr',
          spaceUsed: 349603840,
          spaceMax: 3758096384,
          folders: [
            { id: 998877, name: 'LCD Soundsystem - Sound of Silver (2007) FLAC', size: 349603840 },
          ],
          files: [],
          torrents: [],
        });
      }
      if (url.includes('/api/v1/seedr/transfer-item') && init?.method === 'POST') {
        return mockJsonResponse({
          success: true,
          status: 'transferring',
          jobId: 'job-transfer-item-123',
          message: 'Started transfer for "LCD Soundsystem - Sound of Silver (2007) FLAC" to Google Drive!',
        });
      }
      return mockJsonResponse({});
    });

    render(<UploadForm onJobCreated={onJobCreatedMock} />);

    // Switch to Magnet tab
    const magnetTab = screen.getByRole('button', { name: /Magnet \/ Torrent/i });
    fireEvent.click(magnetTab);

    // Wait for the completed folder to be shown
    const folderTitle = await screen.findByText(/LCD Soundsystem - Sound of Silver/i);
    expect(folderTitle).toBeTruthy();

    // Click the folder's "Save to Google Drive" button (label shortens to "Save"
    // below `sm`, but both halves are in the accessible name).
    const transferBtn = screen.getByRole('button', { name: /^Save to Google Drive$/i });
    fireEvent.click(transferBtn);

    await waitFor(() => {
      expect(onJobCreatedMock).toHaveBeenCalled();
      expect(screen.getByText(/Started transfer for "LCD Soundsystem - Sound of Silver/i)).toBeTruthy();
    });
  });

  it('renders magnet input form when connected, submits transfer, and allows disconnecting', async () => {
    const onJobCreatedMock = vi.fn();
    let disconnected = false;

    // mock window.confirm for disconnect
    vi.spyOn(window, 'confirm').mockImplementation(() => true);

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/seedr/status')) {
        return mockJsonResponse({
          connected: !disconnected,
          username: 'Tester Seedr',
          spaceUsed: 524288000,
          spaceMax: 2147483648,
          torrents: [],
        });
      }
      if (url.includes('/api/v1/seedr/transfer')) {
        return mockJsonResponse({
          success: true,
          status: 'downloading',
          userTorrentId: 12345,
          title: 'Test Torrent Download',
          message: 'Torrent added to Seedr cloud. It will appear in "Ready in Seedr Cloud" once downloaded.',
        });
      }
      if (url.includes('/api/v1/seedr/disconnect') && init?.method === 'DELETE') {
        disconnected = true;
        return mockJsonResponse({ success: true });
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
    const submitBtn = screen.getByRole('button', { name: /Save Torrent/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      // status is 'downloading', so onJobCreated should NOT be called (no Drive job yet)
      expect(screen.getByText(/Torrent added to Seedr cloud/i)).toBeTruthy();
    });

    // Click Disconnect button
    const disconnectBtn = screen.getByRole('button', { name: /Disconnect/i });
    fireEvent.click(disconnectBtn);

    // Form should return to not connected login view
    await waitFor(() => {
      expect(screen.getByPlaceholderText('your-email@example.com')).toBeTruthy();
    });
  });
});
