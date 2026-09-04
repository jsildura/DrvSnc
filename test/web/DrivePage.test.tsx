import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DrivePage } from '../../src/web/routes/DrivePage';

describe('Drive Management UI Component (<DrivePage />)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Drive explorer with folders, files, and storage quota', async () => {
    const mockItems = [
      {
        id: 'folder-1',
        name: 'Project Documents',
        mimeType: 'application/vnd.google-apps.folder',
        isFolder: true,
        shared: false,
        trashed: false,
        size: 0,
        modifiedTime: new Date().toISOString(),
        webViewLink: 'https://drive.google.com/drive/folders/folder-1',
      },
      {
        id: 'file-1',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        isFolder: false,
        shared: false,
        trashed: false,
        size: 1048576,
        modifiedTime: new Date().toISOString(),
        webViewLink: 'https://drive.google.com/file/d/file-1/view',
      },
    ];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/v1/drive/quota') || url.includes('/api/v1/drive/storage')) {
        return new Response(
          JSON.stringify({
            usage: 5 * 1024 * 1024 * 1024,
            limit: 15 * 1024 * 1024 * 1024,
            usageInDrive: 5 * 1024 * 1024 * 1024,
            usageInDriveTrash: 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/api/v1/drive/items')) {
        return new Response(
          JSON.stringify({ items: mockItems, nextPageToken: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);

    await waitFor(() => {
      expect(screen.getByText('Google Drive Explorer')).toBeDefined();
      expect(screen.getByText('Project Documents')).toBeDefined();
      expect(screen.getByText('report.pdf')).toBeDefined();
      expect(screen.getByText('5.0 GB of 15 GB')).toBeDefined();
    });
  });

  it('switches between My Drive, Shared with Me, and Trash views', async () => {
    let trashLoaded = false;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/v1/drive/quota') || url.includes('/api/v1/drive/storage')) {
        return new Response(
          JSON.stringify({
            usage: 0,
            limit: 15000000000,
            usageInDrive: 0,
            usageInDriveTrash: 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/api/v1/drive/trash')) {
        trashLoaded = true;
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'trashed-file-1',
                name: 'deleted_note.txt',
                mimeType: 'text/plain',
                isFolder: false,
                shared: false,
                trashed: true,
                size: 100,
                modifiedTime: new Date().toISOString(),
              },
            ],
            nextPageToken: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/api/v1/drive/items')) {
        return new Response(
          JSON.stringify({ items: [], nextPageToken: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);

    const trashTab = screen.getAllByText('Trash')[0];
    fireEvent.click(trashTab);

    await waitFor(() => {
      expect(trashLoaded).toBe(true);
      expect(screen.getByText('deleted_note.txt')).toBeDefined();
      expect(screen.getByText('Empty Trash')).toBeDefined();
    });
  });

  it('opens native preview modal when a file is clicked', async () => {
    const mockItems = [
      {
        id: 'file-doc-1',
        name: 'project_spec.pdf',
        mimeType: 'application/pdf',
        isFolder: false,
        shared: false,
        trashed: false,
        size: 2048576,
        modifiedTime: new Date().toISOString(),
        webViewLink: 'https://drive.google.com/file/d/file-doc-1/view',
      },
    ];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/v1/drive/quota') || url.includes('/api/v1/drive/storage')) {
        return new Response(
          JSON.stringify({
            usage: 1000,
            limit: 15000000000,
            usageInDrive: 1000,
            usageInDriveTrash: 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/api/v1/drive/items')) {
        return new Response(
          JSON.stringify({ items: mockItems, nextPageToken: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);

    await waitFor(() => {
      expect(screen.getByText('project_spec.pdf')).toBeDefined();
    });

    const previewBtn = screen.getByTitle('Preview file');
    fireEvent.click(previewBtn);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeDefined();
      expect(screen.getAllByText('project_spec.pdf').length).toBeGreaterThan(0);
    });
  });
});

describe('Drive destructive actions (grid view)', () => {
  const quotaResponse = () =>
    new Response(
      JSON.stringify({ usage: 1000, limit: 15000000000, usageInDrive: 1000, usageInDriveTrash: 0 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  const jsonResponse = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const activeFile = {
    id: 'file-1',
    name: 'quarterly_report.pdf',
    mimeType: 'application/pdf',
    isFolder: false,
    shared: false,
    trashed: false,
    size: 1048576,
    modifiedTime: new Date().toISOString(),
  };

  const trashedFile = { ...activeFile, id: 'trashed-1', name: 'stale_file.txt', mimeType: 'text/plain', trashed: true };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('confirm', vi.fn(() => true));
    // The reported bugs are grid-view specific: the card itself opens the preview.
    localStorage.setItem('gdu_drive_view_mode', 'grid');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.removeItem('gdu_drive_view_mode');
  });

  it('moves a file to trash without opening the preview, and confirms with a toast', async () => {
    let trashCalls = 0;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method || 'GET').toUpperCase();

      if (url.includes('/api/v1/drive/quota') || url.includes('/api/v1/drive/storage')) return quotaResponse();
      if (method === 'POST' && url.endsWith('/trash')) {
        trashCalls += 1;
        return jsonResponse({ ...activeFile, trashed: true });
      }
      // Drive keeps listing the file for a moment after the trash call.
      if (url.includes('/api/v1/drive/items')) return jsonResponse({ items: [activeFile], nextPageToken: null });

      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);

    await waitFor(() => {
      expect(screen.getByTitle('Move to trash')).toBeDefined();
    });

    fireEvent.click(screen.getByTitle('Move to trash'));

    await waitFor(() => {
      expect(trashCalls).toBe(1);
      expect(screen.getByText(/moved to trash/i)).toBeDefined();
    });

    // The click must not bubble to the card, and the stale reload must not restore the file.
    expect(screen.queryByText('Open with')).toBeNull();
    expect(screen.queryByText('quarterly_report.pdf')).toBeNull();
  });

  it('permanently deletes a trashed file without opening the preview, and confirms with a toast', async () => {
    let deleteCalls = 0;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method || 'GET').toUpperCase();

      if (url.includes('/api/v1/drive/quota') || url.includes('/api/v1/drive/storage')) return quotaResponse();
      if (method === 'DELETE' && url.includes('/api/v1/drive/items/')) {
        deleteCalls += 1;
        return jsonResponse({ success: true });
      }
      if (url.includes('/api/v1/drive/trash')) return jsonResponse({ items: [trashedFile], nextPageToken: null });
      if (url.includes('/api/v1/drive/items')) return jsonResponse({ items: [], nextPageToken: null });

      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);

    fireEvent.click(screen.getAllByText('Trash')[0]);

    await waitFor(() => {
      expect(screen.getByTitle('Delete permanently')).toBeDefined();
    });

    fireEvent.click(screen.getByTitle('Delete permanently'));

    await waitFor(() => {
      expect(deleteCalls).toBe(1);
      expect(screen.getByText(/deleted permanently/i)).toBeDefined();
    });

    expect(screen.queryByText('Open with')).toBeNull();
    expect(screen.queryByText('stale_file.txt')).toBeNull();
  });

  it('clears the trash list on Empty Trash without re-listing', async () => {
    let trashListCalls = 0;
    let emptyCalls = 0;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method || 'GET').toUpperCase();

      if (url.includes('/api/v1/drive/quota') || url.includes('/api/v1/drive/storage')) return quotaResponse();
      if (method === 'POST' && url.includes('/api/v1/drive/trash/empty')) {
        emptyCalls += 1;
        return jsonResponse({ success: true });
      }
      if (url.includes('/api/v1/drive/trash')) {
        trashListCalls += 1;
        // Drive empties the trash asynchronously, so it keeps returning the item.
        return jsonResponse({ items: [trashedFile], nextPageToken: null });
      }
      if (url.includes('/api/v1/drive/items')) return jsonResponse({ items: [], nextPageToken: null });

      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);

    fireEvent.click(screen.getAllByText('Trash')[0]);

    await waitFor(() => {
      expect(screen.getByText('stale_file.txt')).toBeDefined();
    });

    const listCallsBeforeEmpty = trashListCalls;
    fireEvent.click(screen.getByText('Empty Trash'));

    await waitFor(() => {
      expect(emptyCalls).toBe(1);
      expect(screen.queryByText('stale_file.txt')).toBeNull();
      expect(screen.getByText(/trash emptied/i)).toBeDefined();
    });

    // A verification reload used to fire ~1.5s later. It could never show anything
    // different — every id it returns is masked as locally removed — and it flashed
    // the loading placeholder over the list. It must stay gone.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(trashListCalls).toBe(listCallsBeforeEmpty);
    expect(screen.queryByText('stale_file.txt')).toBeNull();
    expect(screen.queryByText(/Loading Drive files/i)).toBeNull();
  });

  it('removes the row before the trash request resolves, not after', async () => {
    // Hold the trash response open so "the request is still in flight" is an
    // observable state. The row must already be gone at that point — waiting for
    // the round-trip is what made the button feel delayed by seconds.
    let releaseTrash: (() => void) | undefined;
    const trashInFlight = new Promise<void>((resolve) => {
      releaseTrash = resolve;
    });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method || 'GET').toUpperCase();

      if (url.includes('/api/v1/drive/quota') || url.includes('/api/v1/drive/storage')) return quotaResponse();
      if (method === 'POST' && url.endsWith('/trash')) {
        await trashInFlight;
        return jsonResponse({ ...activeFile, trashed: true });
      }
      if (url.includes('/api/v1/drive/items')) return jsonResponse({ items: [activeFile], nextPageToken: null });

      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);
    await waitFor(() => expect(screen.getByText('quarterly_report.pdf')).toBeDefined());

    fireEvent.click(screen.getByTitle('Move to trash'));

    // Still in flight — the row must already have disappeared.
    await waitFor(() => expect(screen.queryByText('quarterly_report.pdf')).toBeNull());
    expect(screen.queryByText(/moved to trash/i)).toBeNull();

    releaseTrash?.();
    await waitFor(() => expect(screen.getByText(/moved to trash/i)).toBeDefined());
  });

  it('puts the row back and reports an error when the trash request fails', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method || 'GET').toUpperCase();

      if (url.includes('/api/v1/drive/quota') || url.includes('/api/v1/drive/storage')) return quotaResponse();
      if (method === 'POST' && url.endsWith('/trash')) {
        return new Response(JSON.stringify({ error: 'Bad Gateway' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/v1/drive/items')) return jsonResponse({ items: [activeFile], nextPageToken: null });

      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);
    await waitFor(() => expect(screen.getByText('quarterly_report.pdf')).toBeDefined());

    fireEvent.click(screen.getByTitle('Move to trash'));

    // Optimistic removal must be rolled back, so the user doesn't lose sight of a
    // file that is in fact still in Drive.
    await waitFor(() => expect(screen.getByText('quarterly_report.pdf')).toBeDefined());
    expect(screen.queryByText(/moved to trash/i)).toBeNull();
  });

  it('does not re-list or show the loading placeholder after moving a file to trash', async () => {
    // The reported annoyance: the handler used to call loadData(), which flips
    // isLoading and replaces the entire grid with "Loading Drive files..." — the
    // whole view flashed on every single click.
    //
    // Only the first listing resolves; any re-list hangs. That makes a stray reload
    // deterministically observable as a stuck placeholder, instead of a sub-tick
    // flash that a polling interval would usually miss.
    let listCalls = 0;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method || 'GET').toUpperCase();

      if (url.includes('/api/v1/drive/quota') || url.includes('/api/v1/drive/storage')) return quotaResponse();
      if (method === 'POST' && url.endsWith('/trash')) return jsonResponse({ ...activeFile, trashed: true });
      if (url.includes('/api/v1/drive/items')) {
        listCalls += 1;
        if (listCalls > 1) await new Promise<void>(() => {});
        return jsonResponse({
          items: [activeFile, { ...activeFile, id: 'file-2', name: 'keep_me.txt', mimeType: 'text/plain' }],
          nextPageToken: null,
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);
    await waitFor(() => expect(screen.getByText('quarterly_report.pdf')).toBeDefined());
    expect(listCalls).toBe(1);

    fireEvent.click(screen.getAllByTitle('Move to trash')[0]);

    await waitFor(() => expect(screen.getByText(/moved to trash/i)).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 200));

    // The visible symptom first: the list must never be swapped for the placeholder.
    expect(screen.queryByText(/Loading Drive files/i)).toBeNull();
    expect(listCalls).toBe(1);
    // The untouched row must still be on screen — nothing was torn down and rebuilt.
    expect(screen.getByText('keep_me.txt')).toBeDefined();
    expect(screen.queryByText('quarterly_report.pdf')).toBeNull();
  });

  it('clicking Convert Video stores the file metadata in sessionStorage and switches tab', async () => {
    sessionStorage.clear();
    const mockVideo = {
      id: 'vid-99',
      name: '5143bced42c3-preview1.mp4',
      mimeType: 'video/mp4',
      isFolder: false,
      shared: false,
      trashed: false,
      size: 6312427,
      modifiedTime: new Date().toISOString(),
      parents: ['folder-parent-123'],
    };

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/v1/drive/quota') || url.includes('/api/v1/drive/storage')) {
        return new Response(JSON.stringify({ usage: 0, limit: 100000000 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/v1/drive/items')) {
        return new Response(JSON.stringify({ items: [mockVideo], nextPageToken: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);

    await waitFor(() => {
      expect(screen.getByText('5143bced42c3-preview1.mp4')).toBeDefined();
    });

    const convertBtn = screen.getByTitle('Convert Video');
    expect(convertBtn).toBeDefined();

    fireEvent.click(convertBtn);

    const storedRaw = sessionStorage.getItem('gdu_pending_converter_file');
    expect(storedRaw).not.toBeNull();
    const stored = JSON.parse(storedRaw!);
    expect(stored.id).toBe('vid-99');
    expect(stored.name).toBe('5143bced42c3-preview1.mp4');
    expect(stored.sizeBytes).toBe(6312427);
    expect(stored.mimeType).toBe('video/mp4');
    expect(stored.parentFolderId).toBe('folder-parent-123');
  });

  it('displays detected max video quality badge on video files in grid and list views', async () => {
    localStorage.setItem('gdu_drive_view_mode', 'grid');
    const mockVideos = [
      {
        id: 'vid-1080',
        name: '5143bced42c3-preview1.mp4',
        mimeType: 'video/mp4',
        isFolder: false,
        shared: false,
        trashed: false,
        size: 6312427,
        modifiedTime: new Date().toISOString(),
        videoMediaMetadata: { width: 1920, height: 1080 },
        videoQuality: '1080p',
      },
      {
        id: 'vid-720',
        name: 'nature_clip_720p.mkv',
        mimeType: 'video/x-matroska',
        isFolder: false,
        shared: false,
        trashed: false,
        size: 3500000,
        modifiedTime: new Date().toISOString(),
        videoMediaMetadata: { width: 1280, height: 720 },
      },
      {
        id: 'vid-4k',
        name: 'drone_cinematic_4k.mp4',
        mimeType: 'video/mp4',
        isFolder: false,
        shared: false,
        trashed: false,
        size: 15000000,
        modifiedTime: new Date().toISOString(),
      },
    ];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/v1/drive/quota') || url.includes('/api/v1/drive/storage')) {
        return new Response(JSON.stringify({ usage: 0, limit: 100000000 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/v1/drive/items')) {
        return new Response(JSON.stringify({ items: mockVideos, nextPageToken: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);

    await waitFor(() => {
      expect(screen.getByText('5143bced42c3-preview1.mp4')).toBeDefined();
      expect(screen.getByText('1080p')).toBeDefined();
      expect(screen.getByText('720p')).toBeDefined();
      expect(screen.getByText('4K')).toBeDefined();
    });

    // Check that format badges (MP4, MKV) are also present
    expect(screen.getAllByText('MP4').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('MKV')).toBeDefined();
  });
});

