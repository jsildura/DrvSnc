import { test, expect } from '@playwright/test';

test.describe('Uploads & Job Queue Journey', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('/api/v1/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'usr-e2e-1',
            email: 'e2e-user@example.com',
            name: 'E2E User',
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
          userId: 'usr-e2e-1',
          themeMode: 'system',
          colorScheme: 'slate',
          filenamePattern: '{filename}',
          notificationsEnabled: true,
          rememberAccount: true,
          updatedAt: new Date().toISOString(),
        }),
      });
    });
  });

  test('creates remote URL upload and polls job list', async ({ page }) => {
    let createdJob = false;

    await page.route('/api/v1/jobs*', async (route) => {
      if (route.request().method() === 'POST') {
        createdJob = true;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'job-e2e-remote-1',
            status: 'queued',
            sourceType: 'remote_url',
            targetFolderId: 'root',
            targetFileName: 'remote-doc.pdf',
            bytesTransferred: 0,
            fileSize: 1048576,
            progressPercent: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jobs: createdJob
            ? [
                {
                  id: 'job-e2e-remote-1',
                  status: 'transferring',
                  sourceType: 'remote_url',
                  targetFolderId: 'root',
                  targetFileName: 'remote-doc.pdf',
                  bytesTransferred: 524288,
                  fileSize: 1048576,
                  progressPercent: 50,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              ]
            : [],
          nextCursor: null,
        }),
      });
    });

    // Batch summary polling (registered after the broader jobs* glob so it wins)
    await page.route('/api/v1/jobs/batch*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ batches: [], nextCursor: null }),
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Remote URL' }).click();

    await page.getByPlaceholder('https://example.com/archive.zip').fill('https://example.com/remote-doc.pdf');
    await page.getByRole('button', { name: 'Start Remote Transfer' }).click();

    await expect(page.getByText('remote-doc.pdf')).toBeVisible();
    await expect(page.getByText('50%')).toBeVisible();
  });
});
