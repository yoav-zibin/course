import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { uniqueName } from './helpers';

// Every page requires a login: a logged-out visitor to the portal is sent
// to the login (welcome) page and returns after logging in. The welcome
// page's "Log in" button opens the shared login dialog.
async function openLoginDialog(page: Page) {
  await page.locator('#welcome-login').click();
}

async function continueAsGuest(page: Page, name: string) {
  await page.locator('#welcome-guest-name').fill(name);
  await page.locator('#welcome-guest').click();
}

test.describe('Guest login (real server)', () => {
  test('an open account menu keeps keyboard focus across portal polling', async ({page}) => {
    let refreshPicture = false;
    await page.route('**/batch?*', async route => {
      const response = await route.fetch();
      const body = await response.json();
      if (refreshPicture) {
        for (const item of body) {
          if (item.body?.picture_url) item.body.picture_url += '?focus-refresh';
        }
      }
      await route.fulfill({response, json: body});
    });
    const name = uniqueName('Focus guest');
    await page.goto('/static/portal.html');
    await expect(page).toHaveURL(/\/\?next=/);
    await continueAsGuest(page, name);
    await expect(page).toHaveURL(/\/static\/portal\.html$/);
    // The menu redraws while the account settles (picture, tokens) and the
    // translations land; wait until a full polling cycle leaves it
    // untouched, so the only redraws left are the key-stable polling ones.
    const menuHtml = () => page.evaluate(() => document.querySelector('#account-menu')?.innerHTML ?? '');
    await expect.poll(async () => {
      const before = await menuHtml();
      await page.waitForResponse(response => new URL(response.url()).pathname==='/batch' && response.request().method()==='GET', {timeout: 15000}).catch(() => {});
      return (await menuHtml()) === before;
    }, {timeout: 30000}).toBe(true);
    await page.getByRole('button', {name, exact:true}).click();
    const logout=page.locator('.auth-menu-panel').getByRole('button', {name:`Log out ${name}`, exact:true});
    await logout.focus();
    await expect(logout).toBeFocused();
    // Force a profile update in the next poll, which rebuilds the menu even
    // after its initial contents have settled. Focus must follow the action.
    refreshPicture = true;
    // The portal polls in batches now: wait for a batch carrying the catalog.
    await page.waitForResponse(response => new URL(response.url()).pathname==='/batch' && response.request().method()==='GET');
    await expect(page.locator('.auth-menu-button img')).toHaveAttribute('src', /focus-refresh/);
    await expect(logout).toBeFocused();
    await page.getByRole('heading',{name:'BuildPlay.fun',exact:true}).click();
    await expect(page.locator('.auth-menu-panel')).toBeHidden();
    for(let i=0;i<2;i++) {
      await page.getByRole('button',{name,exact:true}).click();
      await expect(page.locator('.auth-menu-panel')).toBeVisible();
      await page.getByRole('heading',{name:'BuildPlay.fun',exact:true}).click();
      await expect(page.locator('.auth-menu-panel')).toBeHidden();
    }
  });
  test('log in as a guest, see the name in the menu, then log out', async ({ page }) => {
    const name = uniqueName('Guest');
    await page.goto('/static/portal.html');
    await expect(page).toHaveURL(/\/\?next=/);
    await openLoginDialog(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await dialog.getByLabel('Guest name').fill(name);
    await dialog.getByRole('button', { name: 'Continue as guest' }).click();

    await expect(dialog).toBeHidden();
    // Logging in returns the visitor to the page they were sent from.
    await expect(page).toHaveURL(/\/static\/portal\.html$/);
    const menu = page.getByRole('button', { name, exact: true });
    await expect(menu).toBeVisible();

    await menu.click();
    await page.evaluate(() =>
      document.dispatchEvent(new Event('i18n-changed')),
    );
    await expect(page.getByText(`Logged in as ${name}`)).toBeVisible();
    await page.getByRole('button', { name: `Log out ${name}` }).click();
    // Logging out leaves the portal: the login page takes over again.
    await expect(page).toHaveURL(/\/\?next=/);
    await expect(page.locator('#welcome-guest')).toBeVisible();
  });

  test('the login survives a page reload', async ({ page }) => {
    const name = uniqueName('Persist');
    await page.goto('/static/portal.html');
    await openLoginDialog(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Guest name').fill(name);
    await dialog.getByRole('button', { name: 'Continue as guest' }).click();
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  });

  test('the dialog closes with the × button', async ({ page }) => {
    await page.goto('/');
    await openLoginDialog(page);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('shows an error in the dialog when account creation fails', async ({ page }) => {
    await page.route('**/users', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, json: { detail: 'server exploded' } })
        : route.continue(),
    );
    await page.goto('/');
    await openLoginDialog(page);
    await page.getByRole('dialog').getByRole('button', { name: 'Continue as guest' }).click();
    await expect(page.getByRole('dialog').locator('.message.error')).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('#welcome-login')).toBeVisible();
  });
});
