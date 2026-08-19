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
      expect(screen.getByText('Open with')).toBeDefined();
      expect(screen.getAllByText('project_spec.pdf').length).toBeGreaterThan(0);
    });
  });
});

