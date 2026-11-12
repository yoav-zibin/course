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

test('Portal and Admin have direct entry points and no app navigation tabs', async ({ page, request }, testInfo) => {
  // The portal requires a login; the admin page keeps its own sign-in.
  await loginAs(page, await createUser(request, uniqueName('Pages visitor')));
  for (const [name, path] of [['portal', '/'], ['admin', '/admin']]) {
    await page.goto(path, { waitUntil: 'commit' });
    await expect(page).toHaveURL(name === 'portal' ? /\/static\/portal\.html$/ : /\/admin(?:#.*)?$/);
    const header = page.locator('header.topbar');
    await expect(page.locator('[data-i18n="ui.nav.portal"], [data-i18n="ui.nav.admin"]')).toHaveCount(0);
    await expect(header.locator('.app-home-link')).toHaveAttribute('href', '/');
    await expect(header.getByRole('combobox', { name: 'Language' })).toBeVisible();
    await expect(header.locator('#account-menu')).toBeVisible();
    expect(await header.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await header.screenshot({ path: testInfo.outputPath(`${name}-header.png`) });
  }
  await page.getByRole('link', { name: 'Game platform home', exact: true }).click();
  await expect(page).toHaveURL(/portal(?:\.html)?$/);
});
