import { test, expect, Page, Route } from '@playwright/test';

interface BatchState {
  batch: Record<string, unknown>;
  jobs: Record<string, unknown>[];
}

function redactedUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

function makeJobs(urls: string[], folderName: string | null): Record<string, unknown>[] {
  return urls.map((url, idx) => {
    const status = idx === 0 ? 'failed' : idx === 1 ? 'completed' : 'queued';
    return {
      id: `e2e-job-${idx}`,
      userId: 'usr-e2e-batch',
      batchId: 'e2e-batch-1',
      sourceKind: 'remote',
      sourceUrlRedacted: redactedUrl(url),
      filename: `item-${idx}.bin`,
      fileSize: 1048576,
      mimeType: 'application/octet-stream',
      destinationFolderId: folderName ? 'folder-reports' : null,
      destinationFolderName: folderName,
      status,
      progressBytes: status === 'completed' ? 1048576 : 0,
      attemptCount: 1,
      errorCode: status === 'failed' ? 'REMOTE_HTTP_ERROR' : null,
      errorMessage:
        status === 'failed' ? 'Remote server returned 403 (Forbidden)' : null,
      driveFileId: status === 'completed' ? 'drive-file-1' : null,
      driveFileLink:
        status === 'completed' ? 'https://drive.google.com/file/d/drive-file-1/view' : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
  });
}

function makeBatchState(urls: string[], folderName: string | null): BatchState {
  const jobs = makeJobs(urls, folderName);
  const failedCount = jobs.filter((j) => j.status === 'failed').length;
  const completedCount = jobs.filter((j) => j.status === 'completed').length;
  return {
    jobs,
    batch: {
      id: 'e2e-batch-1',
      userId: 'usr-e2e-batch',
      destinationFolderId: folderName ? 'folder-reports' : null,
      destinationFolderName: folderName,
      itemCount: urls.length,
      queuedCount: jobs.filter((j) => j.status === 'queued').length,
      activeCount: 0,
      completedCount,
      failedCount,
      canceledCount: 0,
      progressBytes: completedCount * 1048576,
      totalKnownBytes: urls.length * 1048576,
      status: 'running',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      jobs,
    },
  };
}

async function stubAppBoundary(page: Page): Promise<() => Promise<{ urlsInRequest: string[] }>> {
  let state = makeBatchState([], null);
  let submittedUrls: string[] = [];

  await page.route('/api/v1/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'usr-e2e-batch',
          email: 'e2e-batch@example.com',
          name: 'E2E Batch User',
          picture: null,
        },
      }),
    });
  });

  await page.route('/api/v1/preferences', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        userId: 'usr-e2e-batch',
        themeMode: 'system',
        colorScheme: 'slate',
        filenamePattern: '{filename}',
        notificationsEnabled: true,
        rememberAccount: true,
        updatedAt: new Date().toISOString(),
      }),
    });
  });

  // Generic job-list polling (registered first; more specific batch routes win).
  await page.route('/api/v1/jobs?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jobs: [], nextCursor: null }),
    });
  });

  await page.route('/api/v1/jobs/batch*', async (route: Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (method === 'POST' && url.pathname === '/api/v1/jobs/batch') {
      const body = route.request().postDataJSON() as {
        items?: { url: string; filename?: string }[];
        folderId?: string;
      };
      submittedUrls = (body.items || []).map((i) => i.url);
      const folderName = body.folderId === 'folder-reports' ? 'Reports' : null;
      state = makeBatchState(submittedUrls, folderName);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ batch: state.batch, jobs: state.jobs }),
      });
      return;
    }

    if (method === 'POST' && url.pathname.endsWith('/cancel')) {
      state.batch = {
        ...state.batch,
        status: 'canceled',
        queuedCount: 0,
        activeCount: 0,
        completedCount: 0,
        failedCount: 0,
        canceledCount: state.jobs.length,
      };
      state.jobs = state.jobs.map((j) => ({ ...j, status: 'canceled' }));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ batch: state.batch, jobs: state.jobs }),
      });
      return;
    }

    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ batches: [state.batch], nextCursor: null }),
      });
      return;
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.route('/api/v1/drive/folders*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            id: 'folder-reports',
            name: 'Reports',
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
    });
  });

  return () => Promise.resolve({ urlsInRequest: submittedUrls });
}

test.describe('Bulk Batch Importer Journey', () => {
  test('past 20 links, picks a folder, submits once, observes progress, cancels, and expands a failed item', async ({
    page,
  }) => {
    const getSubmitted = await stubAppBoundary(page);

    const urls = Array.from({ length: 20 }, (_, i) => `https://example.com/archive-${i}.zip`);
    urls[1] = 'https://example.com/secret-file.bin?token=DO_NOT_LEAK#fragment';

    await page.goto('/');
    await page.getByRole('button', { name: 'Batch URLs (Bulk)' }).click();

    await page.getByPlaceholder(/example\.com/).fill(urls.join('\n'));

    // Redacted preview: the queue renders the query-free URL, never the raw query string
    await expect(page.getByText('20 / 50 valid URLs')).toBeVisible();
    await expect(page.getByText('https://example.com/secret-file.bin', { exact: true })).toBeVisible();
    await expect(page.getByText('https://example.com/secret-file.bin', { exact: true })).not.toContainText('?');

    // Select destination folder from the picker
    await page.getByRole('button', { name: /Destination:/i }).click();
    await page.getByText('Reports', { exact: true }).click();
    await expect(page.getByRole('button', { name: /Destination: Reports/ })).toBeVisible();

    // Submit once
    await page.getByRole('button', { name: /Import & Start Batch Transfer \(20 URLs\)/ }).click();

    // Batch progress panel with aggregate counts and a failed child
    await expect(page.getByText('Batch Transfer (20 files)')).toBeVisible();
    await expect(page.getByText('Transferring')).toBeVisible();
    await expect(page.getByText(/1 completed • 0 active • 1 failed/)).toBeVisible();

    // Server-view URLs are redacted; the raw query string never reaches the DOM
    await expect(page.getByText('token=DO_NOT_LEAK')).toHaveCount(0);
    await expect(page.getByText('https://example.com/secret-file.bin', { exact: true })).toBeVisible();

    // Failed item is disclosed with its redacted error
    await expect(page.getByText('Remote server returned 403 (Forbidden)')).toBeVisible();
    await expect(page.getByText('Failed', { exact: true })).toBeVisible();

    // Cancel the batch from the progress panel
    await page.getByRole('button', { name: 'Cancel Batch' }).click();
    await expect(page.getByText('0 completed • 0 active • 20 failed')).toBeVisible();
    await expect(page.getByRole('button', { name: /Retry Failed \(20\)/ })).toBeVisible();

    const { urlsInRequest } = await getSubmitted();
    expect(urlsInRequest).toHaveLength(20);
    expect(urlsInRequest[1]).toBe('https://example.com/secret-file.bin?token=DO_NOT_LEAK#fragment');
  });

  test('drops a CRLF .txt link list without uploading the file itself', async ({ page }) => {
    const getSubmitted = await stubAppBoundary(page);

    const txtLines = [
      'https://example.com/drop-a.mp4',
      '  https://example.com/drop-b.zip  ',
      '',
      'https://example.com/drop-c.iso',
      'https://example.com/drop-a.mp4',
    ].join('\r\n');

    await page.goto('/');
    await page.getByRole('button', { name: 'Batch URLs (Bulk)' }).click();

    await page.evaluate((content) => {
      const file = new File([content], 'links.txt', { type: 'text/plain' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const textarea = document.querySelector('textarea');
      textarea!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, txtLines);

    // Three unique valid URLs; the blank line and duplicate are silently dropped
    await expect(page.getByText('3 / 50 valid URLs')).toBeVisible();
    await expect(page.getByText('https://example.com/drop-a.mp4', { exact: true })).toBeVisible();
    await expect(page.getByText('https://example.com/drop-b.zip', { exact: true })).toBeVisible();
    await expect(page.getByText('https://example.com/drop-c.iso', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /Import & Start Batch Transfer \(3 URLs\)/ }).click();
    await expect(page.getByText('Batch Transfer (3 files)')).toBeVisible();

    const { urlsInRequest } = await getSubmitted();
    expect(urlsInRequest).toHaveLength(3);
    expect(urlsInRequest).toEqual([
      'https://example.com/drop-a.mp4',
      'https://example.com/drop-b.zip',
      'https://example.com/drop-c.iso',
    ]);
  });
});