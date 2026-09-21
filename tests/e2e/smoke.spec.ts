import { test, expect } from '@playwright/test';

test('login as analyst → home renders', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /Ana Analyst/ }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Your tools' })).toBeVisible();
});
