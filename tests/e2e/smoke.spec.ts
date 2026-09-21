import { test, expect } from '@playwright/test';

test('template app: analyst sees masked queue and detail', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /Ana Analyst/ }).click();
  await page.waitForURL('/');
  await page.goto('/a/template');
  await expect(page.getByRole('heading', { name: 'Expense queue' })).toBeVisible();
  // 40 fixture rows, 20 per page → at least one masked email cell visible.
  await expect(page.getByText(/••••/).first()).toBeVisible();
  await page.getByRole('row').nth(1).click();
  await expect(page).toHaveURL(/\/a\/template\/detail\?id=/);
  await expect(page.getByText('••••', { exact: false }).first()).toBeVisible();
});

test('template app: eng_admin can reveal a masked field', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /Ada Admin/ }).click();
  await page.waitForURL('/');
  await page.goto('/a/template');
  await page.getByRole('button', { name: 'Reveal' }).first().click();
  await expect(page.getByText(/@example\.test/).first()).toBeVisible();
});

test('login as analyst → home renders', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /Ana Analyst/ }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Your tools' })).toBeVisible();
});
