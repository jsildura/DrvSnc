import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { UploaderPage } from '../../src/web/routes/UploaderPage';

describe('Uploads UI Component (<UploaderPage />)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
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

  // The remote tab used to post without a folder, so every single-URL transfer landed in
  // My Drive root no matter what the user intended. The picker is only useful if the id it
  // yields actually reaches the request body.
  it('sends the chosen destination folder with a remote URL transfer', async () => {
    let remotePayload: { url?: string; filename?: string; folderId?: string } | null = null;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/v1/drive/folders')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'folder-wallpaper',
                name: 'Android Wallpaper',
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

      if (url === '/api/v1/jobs/remote' && init?.method === 'POST') {
        remotePayload = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({
            id: 'job-remote-folder',
            userId: 'usr-1',
            sourceKind: 'remote',
            filename: 'wallpaper.jpg',
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

      if (url.includes('/api/v1/jobs/batch')) {
        return new Response(JSON.stringify({ batches: [], nextCursor: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
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

    fireEvent.click(screen.getAllByText('Remote URL')[0]);

    fireEvent.change(screen.getByPlaceholderText('https://example.com/archive.zip'), {
      target: { value: 'https://example.com/wallpaper.jpg' },
    });

    // Parity with the Batch URLs tab: the selector has to be on this form at all.
    fireEvent.click(screen.getByText(/Destination:/i).closest('button')!);

    await waitFor(() => {
      expect(screen.getByText('Android Wallpaper')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Android Wallpaper'));

    // Picker closed, so this match is the trigger label echoing the selection back.
    expect(screen.getByText('Android Wallpaper')).toBeDefined();

    fireEvent.click(screen.getByText('Start Remote Transfer'));

    await waitFor(() => {
      expect(remotePayload).not.toBeNull();
    });
    expect(remotePayload).toMatchObject({
      url: 'https://example.com/wallpaper.jpg',
      folderId: 'folder-wallpaper',
    });

    // Sending a run of files to one folder is the normal case, so the choice survives submit.
    expect(screen.getByText('Android Wallpaper')).toBeDefined();
  });
});

// A signed delivery link is often bound to the IP that created it, so the worker's own fetch is
// refused from Cloudflare's egress addresses. These cover the fallback: the tab fetches the source
// itself and stages it into R2, which is a path only the browser can take.
describe('Browser-relayed remote transfers', () => {
  const SOURCE_URL = 'https://cdn.example.com/media/clip.mp4?acctoken=SUPERSECRETTOKEN';
  const SOURCE_BYTES = 12;

  interface RelayCalls {
    relayBodies: Record<string, unknown>[];
    completeBodies: Record<string, unknown>[];
    putUrls: string[];
    sourceGets: number;
  }

  /** Answers every leg of the relay: source read, job create, part signing, part PUT, completion. */
  function mockRelayBackend(jobs: unknown[] = []): RelayCalls {
    const calls: RelayCalls = { relayBodies: [], completeBodies: [], putUrls: [], sourceGets: 0 };

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });

      if (url.startsWith('https://cdn.example.com/')) {
        calls.sourceGets++;
        return new Response(new Uint8Array(SOURCE_BYTES), {
          status: 200,
          headers: { 'Content-Length': String(SOURCE_BYTES), 'Content-Type': 'video/mp4' },
        });
      }

      if (url.startsWith('https://r2.example.com/') && init?.method === 'PUT') {
        calls.putUrls.push(url);
        return new Response(null, { status: 200, headers: { ETag: '"staged-etag"' } });
      }

      if (url === '/api/v1/jobs/relay' && init?.method === 'POST') {
        calls.relayBodies.push(JSON.parse(String(init.body)));
        return json(
          {
            job: {
              id: 'job-relay-new',
              userId: 'usr-1',
              sourceKind: 'local',
              sourceUrlRedacted: 'https://cdn.example.com/media/clip.mp4',
              filename: 'clip.mp4',
              fileSize: SOURCE_BYTES,
              mimeType: 'video/mp4',
              status: 'staging',
              progressBytes: 0,
              attemptCount: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              version: 1,
            },
            // Small enough that a 12-byte source produces a full part plus a short final one.
            partSize: 8,
            partCount: 1,
            uploadId: 'r2-upload-1',
          },
          201
        );
      }

      if (url.includes('/parts?')) {
        const from = Number(new URL(url, 'https://app.example.com').searchParams.get('from') || 1);
        const count = Number(new URL(url, 'https://app.example.com').searchParams.get('count') || 1);
        return json({
          parts: Array.from({ length: count }, (_, i) => ({
            partNumber: from + i,
            url: `https://r2.example.com/staged?partNumber=${from + i}`,
          })),
        });
      }

      if (url.includes('/complete') && init?.method === 'POST') {
        calls.completeBodies.push(JSON.parse(String(init.body)));
        return json({ id: 'job-relay-new', status: 'queued' });
      }

      if (url.includes('/api/v1/jobs/batch')) {
        return json({ batches: [], nextCursor: null });
      }

      if (url.includes('/api/v1/jobs')) {
        return json({ jobs, nextCursor: null });
      }

      return new Response('Not Found', { status: 404 });
    }) as unknown as typeof fetch;

    return calls;
  }

  function failedJob(overrides: Record<string, unknown> = {}) {
    return {
      id: 'job-denied',
      userId: 'usr-1',
      sourceKind: 'remote',
      sourceUrlRedacted: 'https://cdn.example.com/media/clip.mp4',
      filename: 'clip.mp4',
      fileSize: 1048576,
      mimeType: 'video/mp4',
      destinationFolderId: null,
      destinationFolderName: null,
      status: 'failed',
      progressBytes: 0,
      attemptCount: 1,
      errorCode: 'REMOTE_ACCESS_DENIED',
      errorMessage: 'Source refused the request (403)',
      driveFileId: null,
      driveFileLink: null,
      createdAt: new Date(Date.now() - 3600_000).toISOString(),
      updatedAt: new Date(Date.now() - 3600_000).toISOString(),
      version: 2,
      ...overrides,
    };
  }

  function cacheRelaySource(jobId: string) {
    localStorage.setItem(
      'gdu_relay_sources',
      JSON.stringify([{ jobId, url: SOURCE_URL, savedAt: new Date().toISOString() }])
    );
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('stages the source through the browser when the relay checkbox is on', async () => {
    const calls = mockRelayBackend();

    render(<UploaderPage />);

    fireEvent.click(screen.getAllByText('Remote URL')[0]);
    fireEvent.change(screen.getByPlaceholderText('https://example.com/archive.zip'), {
      target: { value: SOURCE_URL },
    });
    fireEvent.click(screen.getByLabelText(/Fetch from my browser/i));

    // The button label is the confirmation that the toggle rewired the submit path.
    fireEvent.click(await screen.findByText('Fetch in Browser & Transfer'));

    await waitFor(() => {
      expect(calls.completeBodies).toHaveLength(1);
    });

    // Read from the user's own connection, not the worker's — the entire point.
    expect(calls.sourceGets).toBe(1);
    // The worker never receives the query string, so the token stays in this tab.
    expect(calls.relayBodies[0]).toMatchObject({ url: SOURCE_URL, fileSize: SOURCE_BYTES });
    // 12 bytes at an 8-byte part size: one full part plus the short final flush.
    expect(calls.putUrls).toEqual([
      'https://r2.example.com/staged?partNumber=1',
      'https://r2.example.com/staged?partNumber=2',
    ]);
    // A stream has no declared length, so the client's count is what makes `file_size` exact.
    expect(calls.completeBodies[0]).toMatchObject({ totalBytes: SOURCE_BYTES });
  });

  it('offers a browser retry for an older IP-bound failure without starting one', async () => {
    cacheRelaySource('job-denied');
    const calls = mockRelayBackend([failedJob()]);

    render(<UploaderPage />);

    const retryBtn = await screen.findByText('Retry from my browser');

    // The failure is an hour old, so it is offered rather than acted on: silently pulling
    // gigabytes for a transfer the user has stopped watching is not a favour.
    expect(calls.relayBodies).toHaveLength(0);

    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(calls.completeBodies).toHaveLength(1);
    });
    expect(calls.relayBodies[0]).toMatchObject({ url: SOURCE_URL });
  });

  it('retries a just-failed IP-bound transfer from the browser on its own', async () => {
    cacheRelaySource('job-denied');
    const calls = mockRelayBackend([failedJob({ updatedAt: new Date().toISOString() })]);

    render(<UploaderPage />);

    // The user submitted this seconds ago and is watching it; making them diagnose a 403 first
    // is work the app can do itself.
    await waitFor(() => {
      expect(calls.completeBodies).toHaveLength(1);
    });
    expect(calls.relayBodies).toHaveLength(1);
  });

  it('leaves a failure with no remembered URL alone', async () => {
    // Nothing server-side can supply the token: `sourceUrlRedacted` strips the query string.
    const calls = mockRelayBackend([failedJob({ updatedAt: new Date().toISOString() })]);

    render(<UploaderPage />);

    await waitFor(() => {
      expect(screen.getByText('clip.mp4')).toBeDefined();
    });

    expect(screen.queryByText('Retry from my browser')).toBeNull();
    expect(calls.relayBodies).toHaveLength(0);
  });

  it('renders Clear all button when transfer history exists, and clicking it clears all history', async () => {
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
    let historyDeleted = false;

    const completedJob = {
      id: 'job-completed-1',
      userId: 'usr-1',
      sourceKind: 'remote',
      sourceUrlRedacted: null,
      filename: 'DrvSnc.zip',
      fileSize: 1593835,
      mimeType: 'application/zip',
      destinationFolderId: null,
      destinationFolderName: null,
      status: 'completed',
      progressBytes: 1593835,
      attemptCount: 1,
      errorCode: null,
      errorMessage: null,
      driveFileId: 'drive-123',
      driveFileLink: 'https://drive.google.com/file/d/drive-123/view',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/v1/jobs/history') && init?.method === 'DELETE') {
        historyDeleted = true;
        return new Response(JSON.stringify({ success: true, deletedCount: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/v1/jobs')) {
        return new Response(
          JSON.stringify({
            jobs: historyDeleted ? [] : [completedJob],
            nextCursor: null,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      return new Response('Not Found', { status: 404 });
    });

    render(<UploaderPage />);

    // Transfer history shows the record and the Clear all button
    await waitFor(() => {
      expect(screen.getByText('DrvSnc.zip')).toBeDefined();
    });

    const clearAllBtn = screen.getByTestId('clear-all-history-btn');
    expect(clearAllBtn).toBeDefined();
    expect(clearAllBtn.textContent).toContain('Clear all');

    // Click Clear all
    fireEvent.click(clearAllBtn);

    // After clearing, verify the history is empty and Clear all button is removed
    await waitFor(() => {
      expect(screen.queryByText('DrvSnc.zip')).toBeNull();
      expect(screen.getByText('No transfer history yet')).toBeDefined();
      expect(screen.queryByTestId('clear-all-history-btn')).toBeNull();
    });

    expect(historyDeleted).toBe(true);
  });

  it('does not render Clear all button when there are no history jobs', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/v1/jobs')) {
        return new Response(JSON.stringify({ jobs: [], nextCursor: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });

    render(<UploaderPage />);

    await waitFor(() => {
      expect(screen.getByText('No transfer history yet')).toBeDefined();
    });

    expect(screen.queryByTestId('clear-all-history-btn')).toBeNull();
  });
});
