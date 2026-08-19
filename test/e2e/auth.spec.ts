import { test, expect } from '@playwright/test';

test.describe('Authentication Journey', () => {
  test('renders Google Sign-In when unauthenticated', async ({ page }) => {
    await page.route('/api/v1/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: null }),
      });
    });

    await page.goto('/');
    await expect(page.getByText('CloudDrive Sync')).toBeVisible();
    await expect(page.getByText('Sign in with Google')).toBeVisible();
  });

  test('renders authenticated shell with user profile', async ({ page }) => {
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

    await page.goto('/');
    await expect(page.getByRole('banner').getByAltText('CloudDrive Sync')).toBeVisible();
    await expect(page.getByText('Upload Files')).toBeVisible();
  });
});
