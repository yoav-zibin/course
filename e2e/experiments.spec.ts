import { test, expect } from '@playwright/test';
import { E2E_ADMIN_HEADERS, uniqueName } from './helpers';

test('campaign link redirects to the portal and remembers its code', async ({ page }) => {
  await page.goto('/c/students-a');
  // A logged-out visitor detours through the login page first; the
  // campaign code survives the round trip in the return address.
  await expect(page).toHaveURL(/\/\?next=/);
  await page.locator('#welcome-guest-name').fill(uniqueName('Campaign guest'));
  await page.locator('#welcome-guest').click();
  await expect(page).toHaveURL(/\/static\/portal\.html\?campaign=students-a$/);
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem('game-platform.experiment-campaign.v1'),
      ),
    )
    .toBe('students-a');
});

test('campaign dashboard explains creation and supports deleting campaign variants', async ({
  page,
  request,
}) => {
  const campaignName = uniqueName('Temporary campaign');
  const campaignKey = uniqueName('temporary-campaign')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 50);
  const campaignResponse = await request.post(
    '/admin/experiments/campaign-links',
    { headers: E2E_ADMIN_HEADERS, data: { name: campaignName, key: campaignKey } },
  );
  expect(campaignResponse.status()).toBe(201);

  await page.setExtraHTTPHeaders(E2E_ADMIN_HEADERS);
  await page.goto('/static/stats.html');
  const campaignPanel = page
    .locator('.experiment-panel')
    .filter({ hasText: 'Advertisement campaigns' });
  await expect(campaignPanel).toContainText(campaignName);
  await expect(campaignPanel).not.toContainText(/actual spend|cost/i);

  await page
    .getByText('Step-by-step: create and use a campaign link')
    .click();
  await expect(page.getByText(/Copy the generated link/)).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await campaignPanel
    .getByRole('button', { name: `Delete ${campaignName}` })
    .click();
  await expect(campaignPanel.getByText(campaignName)).toHaveCount(0);
});
