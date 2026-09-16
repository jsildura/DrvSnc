import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MoveItemModal } from '../../src/web/components/MoveItemModal';
import { DriveItemView } from '../../src/shared/contracts';

describe('<MoveItemModal /> Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const mockFile: DriveItemView = {
    id: 'file-123',
    name: 'presentation.mp4',
    mimeType: 'video/mp4',
    isFolder: false,
    shared: false,
    trashed: false,
    size: 1048576,
  };

  const mockFolder: DriveItemView = {
    id: 'folder-abc',
    name: 'Work Projects',
    mimeType: 'application/vnd.google-apps.folder',
    isFolder: true,
    shared: false,
    trashed: false,
    size: 0,
  };

  it('renders modal with item name and loads root folders', async () => {
    const mockFolders: DriveItemView[] = [
      {
        id: 'subfolder-1',
        name: 'Archive 2026',
        mimeType: 'application/vnd.google-apps.folder',
        isFolder: true,
        shared: false,
        trashed: false,
        size: 0,
      },
    ];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/v1/drive/folders')) {
        return new Response(JSON.stringify({ items: mockFolders, nextPageToken: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    });

    render(
      <MoveItemModal
        isOpen={true}
        item={mockFile}
        currentFolderId={undefined}
        onClose={vi.fn()}
        onMoved={vi.fn()}
      />
    );

    expect(screen.getByText(/Move "presentation.mp4"/i)).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText('Archive 2026')).toBeDefined();
    });
  });

  it('allows selecting destination folder and triggers onMoved callback', async () => {
    const onMoved = vi.fn();
    const onClose = vi.fn();

    const mockFolders: DriveItemView[] = [
      {
        id: 'dest-folder-99',
        name: 'Target Folder',
        mimeType: 'application/vnd.google-apps.folder',
        isFolder: true,
        shared: false,
        trashed: false,
        size: 0,
      },
    ];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/v1/drive/folders')) {
        return new Response(JSON.stringify({ items: mockFolders, nextPageToken: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    });

    render(
      <MoveItemModal
        isOpen={true}
        item={mockFile}
        currentFolderId="old-folder"
        onClose={onClose}
        onMoved={onMoved}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Target Folder')).toBeDefined();
    });

    // Select the folder
    fireEvent.click(screen.getByText('Target Folder'));

    // Move button should update with target folder name
    const moveBtn = screen.getByRole('button', { name: /Move to Target Folder/i });
    expect(moveBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(moveBtn);

    await waitFor(() => {
      expect(onMoved).toHaveBeenCalledWith(mockFile, 'dest-folder-99', 'Target Folder');
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('prevents moving a folder into itself', async () => {
    const mockFolders: DriveItemView[] = [
      {
        id: 'folder-abc',
        name: 'Work Projects',
        mimeType: 'application/vnd.google-apps.folder',
        isFolder: true,
        shared: false,
        trashed: false,
        size: 0,
      },
      {
        id: 'other-folder',
        name: 'Other Folder',
        mimeType: 'application/vnd.google-apps.folder',
        isFolder: true,
        shared: false,
        trashed: false,
        size: 0,
      },
    ];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/v1/drive/folders')) {
        return new Response(JSON.stringify({ items: mockFolders, nextPageToken: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    });

    render(
      <MoveItemModal
        isOpen={true}
        item={mockFolder} // Moving 'folder-abc'
        currentFolderId="some-parent"
        onClose={vi.fn()}
        onMoved={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Work Projects')).toBeDefined();
      expect(screen.getByText('(Current folder)')).toBeDefined();
    });
  });

  it('creates a new folder inside the modal and selects it', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/v1/drive/folders') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        return new Response(
          JSON.stringify({
            id: 'new-folder-created',
            name: body.name,
            mimeType: 'application/vnd.google-apps.folder',
            isFolder: true,
            shared: false,
            trashed: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/v1/drive/folders')) {
        return new Response(JSON.stringify({ items: [], nextPageToken: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    });

    render(
      <MoveItemModal
        isOpen={true}
        item={mockFile}
        currentFolderId="old-folder"
        onClose={vi.fn()}
        onMoved={vi.fn()}
      />
    );

    // Click "New Folder"
    fireEvent.click(screen.getByRole('button', { name: /New Folder/i }));

    const input = screen.getByPlaceholderText(/New folder name/i);
    fireEvent.change(input, { target: { value: 'Newly Created Folder' } });

    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Move to Newly Created Folder/i })).toBeDefined();
    });
  });
});
