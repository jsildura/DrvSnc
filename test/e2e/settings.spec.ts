import { test, expect } from '@playwright/test';

test.describe('Settings Journey', () => {
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
  });

  test('renders user profile and allows theme selection', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).first().click();

    await expect(page.getByText('Connected Account')).toBeVisible();
    await expect(page.getByRole('main').getByText('E2E User')).toBeVisible();
    await expect(page.getByText('e2e-user@example.com')).toBeVisible();
    await expect(page.getByRole('button', { name: 'dark' })).toBeVisible();
    await expect(page.getByText('Danger Zone')).toBeVisible();
  });
});
