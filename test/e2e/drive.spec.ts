import { test, expect } from '@playwright/test';

test.describe('Google Drive Explorer Journey', () => {
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

    await page.route('/api/v1/jobs*', async (route) => {
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

    await page.route('/api/v1/drive/quota', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          usage: 1073741824,
          limit: 16106127360,
          usageInDrive: 1073741824,
          usageInDriveTrash: 0,
        }),
      });
    });

    await page.route('/api/v1/drive/items*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'folder-1',
              name: 'Projects',
              mimeType: 'application/vnd.google-apps.folder',
              isFolder: true,
              size: null,
              modifiedTime: new Date().toISOString(),
              webViewLink: 'https://drive.google.com/drive/folders/folder-1',
              shared: false,
              trashed: false,
            },
            {
              id: 'file-1',
              name: 'report.pdf',
              mimeType: 'application/pdf',
              isFolder: false,
              size: 2048576,
              modifiedTime: new Date().toISOString(),
              webViewLink: 'https://drive.google.com/file/d/file-1/view',
              shared: false,
              trashed: false,
            },
          ],
          nextPageToken: null,
        }),
      });
    });
  });

  test('renders Drive explorer and allows browsing folders', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Drive' }).first().click();

    await expect(page.getByText('Google Drive Explorer')).toBeVisible();
    await expect(page.getByText('Projects')).toBeVisible();
    await expect(page.getByText('report.pdf')).toBeVisible();
    await expect(page.getByText('1.00 GB of 15.00 GB used')).toBeVisible();
  });
});
