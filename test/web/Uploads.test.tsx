import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UploaderPage } from '../../src/web/routes/UploaderPage';

describe('Uploads UI Component (<UploaderPage />)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders upload forms and displays active and history jobs', async () => {
    const mockJobs = [
      {
        id: 'job-1',
        userId: 'usr-1',
        sourceKind: 'remote',
        sourceUrlRedacted: 'https://example.com/file.zip',
        filename: 'file.zip',
        fileSize: 1048576,
        mimeType: 'application/zip',
        destinationFolderId: null,
        destinationFolderName: null,
        status: 'uploading',
        progressBytes: 524288,
        attemptCount: 1,
        errorCode: null,
        errorMessage: null,
        driveFileId: null,
        driveFileLink: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      },
      {
        id: 'job-2',
        userId: 'usr-1',
        sourceKind: 'local',
        sourceUrlRedacted: null,
        filename: 'archive.tar',
        fileSize: 2097152,
        mimeType: 'application/x-tar',
        destinationFolderId: null,
        destinationFolderName: null,
        status: 'completed',
        progressBytes: 2097152,
        attemptCount: 1,
        errorCode: null,
        errorMessage: null,
        driveFileId: 'drive-file-123',
        driveFileLink: 'https://drive.google.com/file/d/drive-file-123/view',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 2,
      },
    ];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/v1/jobs')) {
        return new Response(JSON.stringify({ jobs: mockJobs, nextCursor: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });

    render(<UploaderPage />);

    await waitFor(() => {
      expect(screen.getByText('file.zip')).toBeDefined();
      expect(screen.getByText('archive.tar')).toBeDefined();
      expect(screen.getByText('50%')).toBeDefined();
      expect(screen.getByText('Open in Drive')).toBeDefined();
    });
  });

  it('switches to remote URL tab and creates remote upload job', async () => {
    let remoteJobCreated = false;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/v1/jobs/remote' && init?.method === 'POST') {
        remoteJobCreated = true;
        return new Response(
          JSON.stringify({
            id: 'job-remote-new',
            userId: 'usr-1',
            sourceKind: 'remote',
            filename: 'new-download.iso',
            fileSize: 0,
            status: 'queued',
            progressBytes: 0,
            attemptCount: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/api/v1/jobs')) {
        return new Response(JSON.stringify({ jobs: [], nextCursor: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    render(<UploaderPage />);

    // Click Remote URL button
    const remoteTabBtn = screen.getAllByText('Remote URL')[0];
    fireEvent.click(remoteTabBtn);

    const input = screen.getByPlaceholderText('https://example.com/archive.zip');
    fireEvent.change(input, { target: { value: 'https://example.com/new-download.iso' } });

    const submitBtn = screen.getByText('Start Remote Transfer');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(remoteJobCreated).toBe(true);
    });
  });
});
