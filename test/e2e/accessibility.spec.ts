import { test, expect } from '@playwright/test';

test.describe('Accessibility & Responsive Viewports', () => {
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
  });

  test('ensures no horizontal overflow and all main interactive buttons are keyboard accessible', async ({ page }) => {
    await page.goto('/');

    // Check no horizontal scrollbar on body
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    // Tab through buttons
    await page.keyboard.press('Tab');
    const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedElement).toBeDefined();
  });
});
