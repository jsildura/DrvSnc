import { test, expect } from '@playwright/test';

test.describe('DIAG Uploads corrected', () => {
  test('full uploads flow with network log', async ({ page }) => {
    page.on('response', async (res) => {
      if (res.url().includes('/api/v1/')) {
        let body = '';
        try {
          body = (await res.text()).slice(0, 160);
        } catch {
          body = '<no body>';
        }
        console.log(`[diag] ${res.status()} ${res.request().method()} ${res.url()} :: ${body}`);
      }
    });

    await page.route('/api/v1/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'usr-e2e-1', email: 'e2e-user@example.com', name: 'E2E User', picture: null },
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

    await page.route('/api/v1/jobs*', async (route) => {
      if (route.request().method() === 'POST') {
        console.log('[diag] POST /api/v1/jobs matched by jobs* stub');
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
        body: JSON.stringify({ jobs: [], nextCursor: null }),
      });
    });

    await page.route('/api/v1/jobs/batch*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ batches: [], nextCursor: null }),
      });
    });

    await page.goto('/');
    console.log('[diag] goto done — shell?', await page.getByText('Upload Files').isVisible().catch(() => false));
    await page.getByRole('button', { name: 'Remote URL' }).click();
    console.log('[diag] Remote URL clicked');
    await page.getByPlaceholder('https://example.com/archive.zip').fill('https://example.com/remote-doc.pdf');
    console.log('[diag] filled');
    await page.getByRole('button', { name: 'Start Remote Transfer' }).click();
    console.log('[diag] clicked Start Remote Transfer');
    await page.waitForTimeout(4000);
    console.log('[diag] after 4s — landing?', await page.getByText('Choose an account').isVisible().catch(() => false));
    await expect(page.getByText('remote-doc.pdf')).toBeVisible({ timeout: 8000 });
  });
});