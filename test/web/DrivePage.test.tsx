import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DrivePage } from '../../src/web/routes/DrivePage';
import { driveCache } from '../../src/web/services/driveCache';

beforeEach(() => {
  driveCache.invalidateAll();
});

afterEach(() => {
  driveCache.invalidateAll();
});

describe('Drive Management UI Component (<DrivePage />)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    driveCache.invalidateAll();
  });

  afterEach(() => {
    cleanup();
    driveCache.invalidateAll();
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

  it('renders rich loading skeleton while fetching drive items', async () => {
    localStorage.setItem('gdu_drive_view_mode', 'grid');
    let resolveItemsPromise: ((value: Response) => void) | undefined;
    const itemsPromise = new Promise<Response>((resolve) => {
      resolveItemsPromise = resolve;
    });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/v1/drive/quota') || url.includes('/api/v1/drive/storage')) {
        return new Response(
          JSON.stringify({ usage: 0, limit: 15000000000, usageInDrive: 0, usageInDriveTrash: 0 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/v1/drive/items')) {
        return itemsPromise;
      }
      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);

    // While loading in grid view, the skeleton container is rendered
    expect(screen.getByTestId('drive-loading-skeleton')).toBeDefined();
    expect(screen.getByText(/Loading Drive files/i)).toBeDefined();

    // Resolve the promise
    resolveItemsPromise!(
      new Response(JSON.stringify({ items: [], nextPageToken: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await waitFor(() => {
      expect(screen.queryByTestId('drive-loading-skeleton')).toBeNull();
      expect(screen.getByText(/No files or folders found/i)).toBeDefined();
    });

    localStorage.removeItem('gdu_drive_view_mode');
  });

  it('renders loading skeleton for Drive storage widget while quota is fetching', async () => {
    let resolveQuota: ((value: Response) => void) | undefined;
    const quotaPromise = new Promise<Response>((resolve) => {
      resolveQuota = resolve;
    });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/v1/drive/quota') || url.includes('/api/v1/drive/storage')) {
        return quotaPromise;
      }
      if (url.includes('/api/v1/drive/items')) {
        return new Response(JSON.stringify({ items: [], nextPageToken: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);

    // Storage skeleton is displayed while quota request is in-flight
    expect(screen.getByTestId('drive-storage-skeleton')).toBeDefined();

    // Resolve quota
    resolveQuota!(
      new Response(
        JSON.stringify({
          usage: 5 * 1024 * 1024 * 1024,
          limit: 15 * 1024 * 1024 * 1024,
          usageInDrive: 5 * 1024 * 1024 * 1024,
          usageInDriveTrash: 0,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    // After resolution, storage skeleton disappears and actual quota is shown
    await waitFor(() => {
      expect(screen.queryByTestId('drive-storage-skeleton')).toBeNull();
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

    const previewBtn = screen.getByTitle('Preview');
    fireEvent.click(previewBtn);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeDefined();
      expect(screen.getAllByText('project_spec.pdf').length).toBeGreaterThan(0);
    });
  });

  it('toggles More actions menu in list view and reveals action buttons', async () => {
    const mockItems = [
      {
        id: 'file-list-1',
        name: 'test_document.pdf',
        mimeType: 'application/pdf',
        isFolder: false,
        shared: false,
        trashed: false,
        size: 2048576,
        modifiedTime: new Date().toISOString(),
        webViewLink: 'https://drive.google.com/file/d/file-list-1/view',
      },
    ];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/v1/drive/quota') || url.includes('/api/v1/drive/storage')) {
        return new Response(
          JSON.stringify({ usage: 1000, limit: 15000000000, usageInDrive: 1000, usageInDriveTrash: 0 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/v1/drive/items')) {
        return new Response(JSON.stringify({ items: mockItems, nextPageToken: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);
    await waitFor(() => {
      expect(screen.getByText('test_document.pdf')).toBeDefined();
    });

    const moreBtn = screen.getByTitle('More actions');
    expect(moreBtn).toBeDefined();

    fireEvent.click(moreBtn);

    expect(screen.getByTitle('Preview')).toBeDefined();
    expect(screen.getByTitle('Download')).toBeDefined();
    expect(screen.getByTitle('Open in Drive')).toBeDefined();
    expect(screen.getByTitle('Rename')).toBeDefined();
    expect(screen.getByTitle('Move to trash')).toBeDefined();
  });

  it('toggles More actions menu for folders in grid view and reveals folder management buttons', async () => {
    localStorage.setItem('gdu_drive_view_mode', 'grid');
    const mockItems = [
      {
        id: 'folder-grid-1',
        name: 'Work Documents',
        mimeType: 'application/vnd.google-apps.folder',
        isFolder: true,
        shared: false,
        trashed: false,
        size: 0,
        modifiedTime: new Date().toISOString(),
        webViewLink: 'https://drive.google.com/drive/folders/folder-grid-1',
      },
    ];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/v1/drive/quota') || url.includes('/api/v1/drive/storage')) {
        return new Response(
          JSON.stringify({ usage: 1000, limit: 15000000000, usageInDrive: 1000, usageInDriveTrash: 0 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/v1/drive/items')) {
        return new Response(JSON.stringify({ items: mockItems, nextPageToken: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);
    await waitFor(() => {
      expect(screen.getByText('Work Documents')).toBeDefined();
    });

    const moreBtn = screen.getByTitle('More actions');
    expect(moreBtn).toBeDefined();

    fireEvent.click(moreBtn);

    expect(screen.getByTitle('Open folder')).toBeDefined();
    expect(screen.getByTitle('Share')).toBeDefined();
    expect(screen.getByTitle('Copy link')).toBeDefined();
    expect(screen.getByTitle('Open in Drive')).toBeDefined();
    expect(screen.getByTitle('Rename')).toBeDefined();
    expect(screen.getByTitle('Move to trash')).toBeDefined();

    // Preview and Download should not be rendered for folders
    expect(screen.queryByTitle('Preview')).toBeNull();
    expect(screen.queryByTitle('Download')).toBeNull();

    localStorage.removeItem('gdu_drive_view_mode');
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
    driveCache.invalidateAll();
    // The reported bugs are grid-view specific: the card itself opens the preview.
    localStorage.setItem('gdu_drive_view_mode', 'grid');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    driveCache.invalidateAll();
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
  });

  it('loads more items and appends them when nextPageToken is present (infinite load)', async () => {
    const page1Items = [
      {
        id: 'item-page1-1',
        name: 'File_Page1.pdf',
        mimeType: 'application/pdf',
        isFolder: false,
        shared: true,
        trashed: false,
        size: 1024,
      },
    ];

    const page2Items = [
      {
        id: 'item-page2-1',
        name: 'File_Page2.pdf',
        mimeType: 'application/pdf',
        isFolder: false,
        shared: true,
        trashed: false,
        size: 2048,
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

      if (url.includes('/api/v1/drive/shared')) {
        if (url.includes('pageToken=token-page-2')) {
          return new Response(
            JSON.stringify({ items: page2Items, nextPageToken: null }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({ items: page1Items, nextPageToken: 'token-page-2' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);

    // Switch to Shared with Me
    const sharedTabBtn = screen.getByRole('button', { name: /Shared with Me/i });
    fireEvent.click(sharedTabBtn);

    // Initial page loaded
    await waitFor(() => {
      expect(screen.getByText('File_Page1.pdf')).toBeDefined();
      expect(screen.getByRole('button', { name: /Load more items/i })).toBeDefined();
    });

    // Click load more button (or triggered via intersection)
    const loadMoreBtn = screen.getByRole('button', { name: /Load more items/i });
    fireEvent.click(loadMoreBtn);

    // Both page 1 and page 2 items should now be present
    await waitFor(() => {
      expect(screen.getByText('File_Page1.pdf')).toBeDefined();
      expect(screen.getByText('File_Page2.pdf')).toBeDefined();
      expect(screen.queryByRole('button', { name: /Load more items/i })).toBeNull();
    });
  });

  it('displays loading skeletons when loading more items', async () => {
    const page1Files = [
      {
        id: 'p1-1',
        name: 'Item_Page_1.pdf',
        mimeType: 'application/pdf',
        isFolder: false,
        shared: false,
        trashed: false,
        size: 1024,
      },
    ];

    const page2Files = [
      {
        id: 'p2-1',
        name: 'Item_Page_2.pdf',
        mimeType: 'application/pdf',
        isFolder: false,
        shared: false,
        trashed: false,
        size: 2048,
      },
    ];

    let resolvePage2: (val: Response) => void;
    const page2Promise = new Promise<Response>((resolve) => {
      resolvePage2 = resolve;
    });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/v1/drive/quota') || url.includes('/api/v1/drive/storage')) {
        return new Response(JSON.stringify({ usage: 0, limit: 100000000 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/v1/drive/items')) {
        if (url.includes('pageToken=token-more')) {
          return page2Promise;
        }
        return new Response(
          JSON.stringify({ items: page1Files, nextPageToken: 'token-more' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);

    // Initial page loaded
    await waitFor(() => {
      expect(screen.getByText('Item_Page_1.pdf')).toBeDefined();
      expect(screen.getByRole('button', { name: /Load more items/i })).toBeDefined();
    });

    // Skeletons are not visible before loading more
    expect(screen.queryAllByTestId('loading-more-skeleton').length).toBe(0);

    // Click load more button
    fireEvent.click(screen.getByRole('button', { name: /Load more items/i }));

    // While request is in-flight, loading-more-skeleton must be visible!
    await waitFor(() => {
      expect(screen.getByText('Loading more items...')).toBeDefined();
      const skeletons = screen.getAllByTestId('loading-more-skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    // Resolve page 2
    resolvePage2!(
      new Response(
        JSON.stringify({ items: page2Files, nextPageToken: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    // After resolution, page 2 items appear and loading skeletons disappear
    await waitFor(() => {
      expect(screen.getByText('Item_Page_2.pdf')).toBeDefined();
      expect(screen.queryAllByTestId('loading-more-skeleton').length).toBe(0);
    });
  });

  it('supports browsing inside a shared folder and navigating back via breadcrumb', async () => {
    const sharedRootItems = [
      {
        id: 'shared-folder-1',
        name: 'Shared Team Folder',
        mimeType: 'application/vnd.google-apps.folder',
        isFolder: true,
        shared: true,
        trashed: false,
      },
    ];

    const insideFolderItems = [
      {
        id: 'child-file-1',
        name: 'Secret_Notes.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        isFolder: false,
        shared: true,
        trashed: false,
        size: 512,
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

      if (url.includes('/api/v1/drive/shared')) {
        return new Response(
          JSON.stringify({ items: sharedRootItems, nextPageToken: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/api/v1/drive/items') && url.includes('parentId=shared-folder-1')) {
        return new Response(
          JSON.stringify({ items: insideFolderItems, nextPageToken: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);

    // Switch to Shared with Me
    fireEvent.click(screen.getByRole('button', { name: /Shared with Me/i }));

    await waitFor(() => {
      expect(screen.getByText('Shared Team Folder')).toBeDefined();
    });

    // Click to open shared folder
    fireEvent.click(screen.getByText('Shared Team Folder'));

    // Should load inside the folder and display child files
    await waitFor(() => {
      expect(screen.getByText('Secret_Notes.docx')).toBeDefined();
      expect(screen.getByText('Shared Team Folder')).toBeDefined(); // In breadcrumb
    });

    // Navigate back to Shared with Me root via breadcrumb
    const sharedButtons = screen.getAllByRole('button', { name: 'Shared with Me' });
    const rootBreadcrumb = sharedButtons[sharedButtons.length - 1];
    fireEvent.click(rootBreadcrumb);

    // Root shared items should be shown again
    await waitFor(() => {
      expect(screen.getByText('Shared Team Folder')).toBeDefined();
      expect(screen.queryByText('Secret_Notes.docx')).toBeNull();
    });
  });

  it('supports opening a shared folder shortcut via targetId and browsing its contents', async () => {
    const sharedRootItems = [
      {
        id: 'shortcut-folder-1',
        name: 'Shared Shortcut Folder',
        mimeType: 'application/vnd.google-apps.shortcut',
        isFolder: true,
        isShortcut: true,
        targetId: 'target-actual-folder-456',
        targetMimeType: 'application/vnd.google-apps.folder',
        shared: true,
        trashed: false,
      },
    ];

    const insideFolderItems = [
      {
        id: 'target-child-file-1',
        name: 'Shortcut_Target_Doc.pdf',
        mimeType: 'application/pdf',
        isFolder: false,
        shared: true,
        trashed: false,
        size: 1024,
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

      if (url.includes('/api/v1/drive/shared')) {
        return new Response(
          JSON.stringify({ items: sharedRootItems, nextPageToken: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/api/v1/drive/items') && url.includes('parentId=target-actual-folder-456')) {
        return new Response(
          JSON.stringify({ items: insideFolderItems, nextPageToken: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);

    // Switch to Shared with Me
    fireEvent.click(screen.getByRole('button', { name: /Shared with Me/i }));

    await waitFor(() => {
      expect(screen.getByText('Shared Shortcut Folder')).toBeDefined();
    });

    // Click to open shared shortcut folder
    fireEvent.click(screen.getByText('Shared Shortcut Folder'));

    // Should load inside the target folder and display child files
    await waitFor(() => {
      expect(screen.getByText('Shortcut_Target_Doc.pdf')).toBeDefined();
      expect(screen.getByText('Shared Shortcut Folder')).toBeDefined(); // In breadcrumb
    });
  });

  it('serves visited folders from cache on back-navigation without re-fetching, and re-fetches on manual refresh', async () => {
    let rootFetchCount = 0;
    let subfolderFetchCount = 0;

    const rootFolderItem = {
      id: 'subfolder-101',
      name: 'Alpha Project',
      mimeType: 'application/vnd.google-apps.folder',
      isFolder: true,
      shared: false,
      trashed: false,
    };

    const subfolderChildItem = {
      id: 'doc-202',
      name: 'Plan.pdf',
      mimeType: 'application/pdf',
      isFolder: false,
      shared: false,
      trashed: false,
      size: 5000,
    };

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/v1/drive/quota') || url.includes('/api/v1/drive/storage')) {
        return new Response(JSON.stringify({ usage: 0, limit: 100000000 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/v1/drive/items') && url.includes('parentId=subfolder-101')) {
        subfolderFetchCount += 1;
        return new Response(
          JSON.stringify({ items: [subfolderChildItem], nextPageToken: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/api/v1/drive/items')) {
        rootFetchCount += 1;
        return new Response(
          JSON.stringify({ items: [rootFolderItem], nextPageToken: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not Found', { status: 404 });
    });

    render(<DrivePage />);

    // Initial root fetch
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeDefined();
    });
    expect(rootFetchCount).toBe(1);

    // Open subfolder
    fireEvent.click(screen.getByText('Alpha Project'));
    await waitFor(() => {
      expect(screen.getByText('Plan.pdf')).toBeDefined();
    });
    expect(subfolderFetchCount).toBe(1);

    // Navigate back to My Drive root via breadcrumb
    const myDriveButtons = screen.getAllByRole('button', { name: 'My Drive' });
    fireEvent.click(myDriveButtons[myDriveButtons.length - 1]);

    // Should render immediately from cache
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeDefined();
    });
    // rootFetchCount should STILL be 1 because fresh cache served it without network call!
    expect(rootFetchCount).toBe(1);

    // Click manual refresh button
    const refreshBtn = screen.getByRole('button', { name: 'Refresh folder' });
    fireEvent.click(refreshBtn);

    // Should trigger fresh network call
    await waitFor(() => {
      expect(rootFetchCount).toBe(2);
      expect(screen.getByText('Alpha Project')).toBeDefined();
    });
  });
});

