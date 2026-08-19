import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { FolderPicker } from '../../src/web/components/FolderPicker';
import { BatchImporter } from '../../src/web/uploads/BatchImporter';
import { BatchProgress } from '../../src/web/uploads/BatchProgress';
import { BatchView } from '../../src/shared/contracts';

describe('Batch Upload UI Components', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('FolderPicker Component', () => {
    it('renders folder selector and loads folders on open', async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/v1/drive/folders')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 'folder-1',
                  name: 'Documents',
                  isFolder: true,
                  mimeType: 'application/vnd.google-apps.folder',
                  modifiedTime: new Date().toISOString(),
                  createdTime: new Date().toISOString(),
                  shared: false,
                  trashed: false,
                },
              ],
              nextPageToken: null,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not found', { status: 404 });
      });

      const onSelect = vi.fn();
      render(
        <FolderPicker
          selectedFolderId={undefined}
          selectedFolderName="My Drive (Root)"
          onSelect={onSelect}
        />
      );

      expect(screen.getByText(/My Drive \(Root\)/i)).toBeDefined();

      // Open dropdown
      const button = screen.getByText(/Destination:/i).closest('button')!;
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Documents')).toBeDefined();
      });

      // Select Documents folder
      fireEvent.click(screen.getByText('Documents'));
      expect(onSelect).toHaveBeenCalledWith('folder-1', 'Documents');
    });

    it('navigates subfolders via breadcrumbs', async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('parentId=folder-1')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 'subfolder-2',
                  name: 'Invoices',
                  isFolder: true,
                  mimeType: 'application/vnd.google-apps.folder',
                  modifiedTime: new Date().toISOString(),
                  createdTime: new Date().toISOString(),
                  shared: false,
                  trashed: false,
                },
              ],
              nextPageToken: null,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.includes('/api/v1/drive/folders')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 'folder-1',
                  name: 'Finance',
                  isFolder: true,
                  mimeType: 'application/vnd.google-apps.folder',
                  modifiedTime: new Date().toISOString(),
                  createdTime: new Date().toISOString(),
                  shared: false,
                  trashed: false,
                },
              ],
              nextPageToken: null,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not found', { status: 404 });
      });

      const onSelect = vi.fn();
      render(
        <FolderPicker
          selectedFolderId={undefined}
          selectedFolderName="My Drive (Root)"
          onSelect={onSelect}
        />
      );

      const triggerBtn = screen.getByText(/Destination:/i).closest('button')!;
      fireEvent.click(triggerBtn);
      await waitFor(() => {
        expect(screen.getByText('Finance')).toBeDefined();
      });

      const browseBtn = screen.getByTitle(/browse into folder/i);
      fireEvent.click(browseBtn);

      await waitFor(() => {
        expect(screen.getByText('Invoices')).toBeDefined();
      });

      fireEvent.click(screen.getByText('Choose this Folder'));
      expect(onSelect).toHaveBeenCalledWith('folder-1', 'Finance');
    });

    it('loads additional folder pages without losing the first page', async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        const parsed = new URL(url, 'https://uploader.local');
        const pageToken = parsed.searchParams.get('pageToken');

        if (pageToken === 'page-2') {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 'folder-51',
                  name: 'Folder 51',
                  isFolder: true,
                  mimeType: 'application/vnd.google-apps.folder',
                  shared: false,
                  trashed: false,
                },
              ],
              nextPageToken: null,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'folder-1',
                name: 'Folder 1',
                isFolder: true,
                mimeType: 'application/vnd.google-apps.folder',
                shared: false,
                trashed: false,
              },
            ],
            nextPageToken: 'page-2',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      render(
        <FolderPicker
          selectedFolderName="My Drive (Root)"
          onSelect={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText(/Destination:/i).closest('button')!);
      await screen.findByText('Folder 1');
      fireEvent.click(screen.getByRole('button', { name: /load more folders/i }));
      await screen.findByText('Folder 51');

      expect(screen.getByText('Folder 1')).toBeDefined();
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('pageToken=page-2'),
        expect.anything()
      );
    });

    it('resets pagination when navigating to another parent', async () => {
      const requestedUrls: string[] = [];
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        const parsed = new URL(url, 'https://uploader.local');
        const parentId = parsed.searchParams.get('parentId');
        const pageToken = parsed.searchParams.get('pageToken');
        requestedUrls.push(url);

        if (parentId === 'folder-1' && !pageToken) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 'subfolder-2',
                  name: 'Subfolder 2',
                  isFolder: true,
                  mimeType: 'application/vnd.google-apps.folder',
                  shared: false,
                  trashed: false,
                },
              ],
              nextPageToken: null,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (!parentId && !pageToken) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 'folder-1',
                  name: 'Folder 1',
                  isFolder: true,
                  mimeType: 'application/vnd.google-apps.folder',
                  shared: false,
                  trashed: false,
                },
              ],
              nextPageToken: 'page-2',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response(JSON.stringify({ items: [], nextPageToken: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      render(
        <FolderPicker
          selectedFolderName="My Drive (Root)"
          onSelect={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText(/Destination:/i).closest('button')!);
      await screen.findByText('Folder 1');

      fireEvent.click(screen.getByTitle(/browse into folder/i));
      await screen.findByText('Subfolder 2');

      const subfolderRequest = requestedUrls[requestedUrls.length - 1];
      expect(subfolderRequest).toContain('parentId=folder-1');
      expect(subfolderRequest).not.toContain('pageToken');

      fireEvent.click(screen.getByText('My Drive'));
      await screen.findByText('Folder 1');

      const rootRequest = requestedUrls[requestedUrls.length - 1];
      expect(rootRequest).not.toContain('parentId=');
      expect(rootRequest).not.toContain('pageToken');
      expect(screen.queryByText('Folder 51')).toBeNull();
      expect(screen.getByRole('button', { name: /load more folders/i })).toBeDefined();
    });
  });

  describe('BatchImporter Component', () => {
    it('parses pasted URLs and handles stable row removal and custom filenames', async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(JSON.stringify({ items: [], nextPageToken: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const onBatchCreated = vi.fn();
      render(<BatchImporter onBatchCreated={onBatchCreated} />);

      const textarea = screen.getByPlaceholderText(/example\.com/i);
      fireEvent.change(textarea, {
        target: {
          value: `https://example.com/file1.mp4\nhttps://example.com/file2.zip?token=secret\nhttps://example.com/file3.iso`,
        },
      });

      expect(screen.getByText(/3 \/ 50 valid URLs/i)).toBeDefined();

      // Verify query string is redacted in preview display
      expect(screen.getByText('https://example.com/file2.zip')).toBeDefined();

      // Custom filename for item 2
      const filenameInputs = screen.getAllByPlaceholderText(/custom filename/i);
      expect(filenameInputs).toHaveLength(3);
      fireEvent.change(filenameInputs[1], { target: { value: 'renamed-file2.zip' } });

      // Remove item 0
      const removeButtons = screen.getAllByTitle(/remove from batch/i);
      fireEvent.click(removeButtons[0]);

      // Verify remaining count is 2 and item 2's custom filename is preserved without misalignment
      expect(screen.getByText(/2 \/ 50 valid URLs/i)).toBeDefined();
      expect(screen.getByDisplayValue('renamed-file2.zip')).toBeDefined();
    });

    it('parses dropped .txt files into preview rows', async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(JSON.stringify({ items: [], nextPageToken: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const onBatchCreated = vi.fn();
      render(<BatchImporter onBatchCreated={onBatchCreated} />);

      const txtFile = new File(
        ['https://example.com/drop1.mp4\r\n\r\n  https://example.com/drop2.zip  \nhttps://example.com/drop3.iso'],
        'links.txt',
        { type: 'text/plain' }
      );

      fireEvent.drop(screen.getByPlaceholderText(/example\.com/i), {
        dataTransfer: { files: [txtFile] },
      });

      await waitFor(() => {
        expect(screen.getByText(/3 \/ 50 valid URLs/i)).toBeDefined();
      });
      expect(screen.getByText('https://example.com/drop1.mp4')).toBeDefined();
      expect(screen.getByText('https://example.com/drop2.zip')).toBeDefined();
      expect(screen.getByText('https://example.com/drop3.iso')).toBeDefined();
    });

    it('rejects dropped non-.txt files with a visible error and no items', async () => {
      const onBatchCreated = vi.fn();
      render(<BatchImporter onBatchCreated={onBatchCreated} />);

      const imageFile = new File(['not-a-link-list'], 'photo.jpg', { type: 'image/jpeg' });
      fireEvent.drop(screen.getByPlaceholderText(/example\.com/i), {
        dataTransfer: { files: [imageFile] },
      });

      await waitFor(() => {
        expect(screen.getByText('Only .txt plain text files are supported')).toBeDefined();
      });
      expect(screen.queryByText(/Batch Items Queue/i)).toBeNull();
      expect(
        (screen.getByRole('button', { name: /import & start batch transfer/i }) as HTMLButtonElement).disabled
      ).toBe(true);
    });

    it('rejects empty .txt drops with a visible error', async () => {
      const onBatchCreated = vi.fn();
      render(<BatchImporter onBatchCreated={onBatchCreated} />);

      const emptyFile = new File([''], 'empty.txt', { type: 'text/plain' });
      fireEvent.drop(screen.getByPlaceholderText(/example\.com/i), {
        dataTransfer: { files: [emptyFile] },
      });

      await waitFor(() => {
        expect(screen.getByText('Uploaded file is empty')).toBeDefined();
      });
      expect(screen.queryByText(/Batch Items Queue/i)).toBeNull();
    });

    it('submits batch upload to API and triggers callback', async () => {
      const mockBatch: BatchView = {
        id: 'batch-submit-1',
        userId: 'usr-1',
        destinationFolderId: null,
        destinationFolderName: null,
        itemCount: 2,
        queuedCount: 2,
        activeCount: 0,
        completedCount: 0,
        failedCount: 0,
        canceledCount: 0,
        progressBytes: 0,
        totalKnownBytes: 0,
        status: 'queued',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      };

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/v1/jobs/batch') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({ batch: mockBatch, jobs: [] }),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      });

      const onBatchCreated = vi.fn();
      render(<BatchImporter onBatchCreated={onBatchCreated} />);

      const textarea = screen.getByPlaceholderText(/example\.com/i);
      fireEvent.change(textarea, {
        target: {
          value: 'https://example.com/item1.mp4\nhttps://example.com/item2.zip',
        },
      });

      const submitBtn = screen.getByRole('button', { name: /import & start batch/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(onBatchCreated).toHaveBeenCalledWith(mockBatch);
      });
    });
  });

  describe('BatchProgress Component', () => {
    const mockBatch: BatchView = {
      id: 'batch-progress-1',
      userId: 'usr-1',
      destinationFolderId: null,
      destinationFolderName: 'Projects',
      itemCount: 2,
      queuedCount: 0,
      activeCount: 1,
      completedCount: 1,
      failedCount: 0,
      canceledCount: 0,
      progressBytes: 50,
      totalKnownBytes: 100,
      status: 'running',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      jobs: [
        {
          id: 'job-1',
          userId: 'usr-1',
          batchId: 'batch-progress-1',
          sourceKind: 'remote',
          sourceUrlRedacted: 'https://example.com/first.mp4',
          filename: 'first.mp4',
          fileSize: 50,
          mimeType: 'video/mp4',
          destinationFolderId: null,
          destinationFolderName: null,
          status: 'completed',
          progressBytes: 50,
          attemptCount: 1,
          errorCode: null,
          errorMessage: null,
          driveFileId: 'drive-1',
          driveFileLink: 'https://drive.google.com/file/d/drive-1/view',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
        },
        {
          id: 'job-2',
          userId: 'usr-1',
          batchId: 'batch-progress-1',
          sourceKind: 'remote',
          sourceUrlRedacted: 'https://example.com/second.mp4',
          filename: 'second.mp4',
          fileSize: 50,
          mimeType: 'video/mp4',
          destinationFolderId: null,
          destinationFolderName: null,
          status: 'uploading',
          progressBytes: 10,
          attemptCount: 1,
          errorCode: null,
          errorMessage: null,
          driveFileId: null,
          driveFileLink: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
        },
      ],
    };

    it('renders progress bar and handles cancel batch action', async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/cancel')) {
          return new Response(
            JSON.stringify({
              batch: { ...mockBatch, status: 'canceled' },
              jobs: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not found', { status: 404 });
      });

      const onUpdate = vi.fn();
      render(<BatchProgress batch={mockBatch} onRefresh={onUpdate} />);

      expect(screen.getByText(/50%/)).toBeDefined();
      expect(screen.getByText(/1 completed • 1 active/i)).toBeDefined();

      const cancelBtn = screen.getByRole('button', { name: /cancel batch/i });
      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalled();
      });
    });

    it('renders retry button when batch has failed/canceled items', async () => {
      const failedBatch: BatchView = {
        ...mockBatch,
        status: 'failed',
        activeCount: 0,
        completedCount: 0,
        failedCount: 2,
      };

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/retry')) {
          return new Response(
            JSON.stringify({
              batch: { ...failedBatch, status: 'queued', queuedCount: 2, failedCount: 0 },
              jobs: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not found', { status: 404 });
      });

      const onUpdate = vi.fn();
      render(<BatchProgress batch={failedBatch} onRefresh={onUpdate} />);

      const retryBtn = screen.getByRole('button', { name: /retry failed/i });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalled();
      });
    });
  });
});
