import { test, expect } from '@playwright/test';

test('flags app: eng_dev sees flags, stale, history, and detail controls', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /Dev Devin/ }).click();
  await page.waitForURL('/');
  await page.goto('/a/flags');
  await expect(page.getByRole('heading', { name: 'Feature flags' })).toBeVisible();
  await expect(page.getByRole('row').nth(1).getByRole('cell').first()).not.toBeEmpty();

  await page.goto('/a/flags/stale');
  await expect(page.getByRole('heading', { name: 'Stale flags (no change in 90 days)' })).toBeVisible();

  await page.goto('/a/flags/history');
  await expect(page.getByRole('heading', { name: 'Flag change history' })).toBeVisible();

  await page.goto('/a/flags');
  await page.getByRole('row').nth(1).click();
  await expect(page).toHaveURL(/\/a\/flags\/detail\?id=/);
  await expect(page.getByRole('button', { name: 'Apply to staging' })).toBeVisible();
});

test('flags app: analyst can read the flag list', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /Ana Analyst/ }).click();
  await page.waitForURL('/');
  await page.goto('/a/flags');
  await expect(page.getByRole('heading', { name: 'Feature flags' })).toBeVisible();
  await expect(page.getByRole('row').nth(1)).toBeVisible();
});
