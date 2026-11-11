import { test, expect } from '@playwright/test';
import { createUser, loginAs, uniqueName } from './helpers';

// Parameterized: every page must load (HTTP 200) without JavaScript errors.
const pages = ['portal', 'admin', 'browse', 'invites', 'stats'];

for (const name of pages) {
  test(`${name}.html loads without JS errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const response = await page.goto(`/static/${name}.html`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('app navigation and language controls stay consistent across Portal and Admin', async ({ page, request }, testInfo) => {
  // The portal requires a login; the admin page keeps its own sign-in.
  await loginAs(page, await createUser(request, uniqueName('Pages visitor')));
  for (const name of ['portal', 'admin']) {
    await page.goto(`/static/${name}.html`);
    const header = page.locator('header.topbar');
    await expect(header.locator('nav a')).toHaveText(['Portal', 'Admin']);
    await expect(header.locator('nav a[aria-current="page"]')).toHaveAttribute('href', '/' + name);
    await expect(header.getByRole('combobox', { name: 'Language' })).toBeVisible();
    await expect(header.locator('#account-menu')).toBeVisible();
    expect(await header.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await header.screenshot({ path: testInfo.outputPath(`${name}-header.png`) });
  }
  await page.locator('header.topbar nav').getByRole('link', { name: 'Portal', exact: true }).click();
  await expect(page).toHaveURL(/portal(?:\.html)?$/);
});
