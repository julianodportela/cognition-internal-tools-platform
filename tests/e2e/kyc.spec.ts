import { test, expect } from '@playwright/test';

test('kyc app: analyst sees masked queue and detail', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /Ana Analyst/ }).click();
  await page.waitForURL('/');
  await page.goto('/a/kyc');
  await expect(page.getByRole('heading', { name: 'KYC queue' })).toBeVisible();
  // Sensitive columns render masked in the queue table.
  await expect(page.getByText(/••••/).first()).toBeVisible();
  await page.getByRole('row').nth(1).click();
  await expect(page).toHaveURL(/\/a\/kyc\/detail\?id=/);
  await expect(page.getByText(/••••/).first()).toBeVisible();
});

test('kyc app: senior can reveal a masked field', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /Sam Senior/ }).click();
  await page.waitForURL('/');
  await page.goto('/a/kyc');
  await page.getByRole('button', { name: 'Reveal' }).first().click();
  await expect(page.getByText(/Test Customer/).first()).toBeVisible();
});
