import { test, expect } from '@playwright/test';
import { createUser, uniqueName } from './helpers';

test('a fresh visitor continues as a guest and keeps the account', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const name = uniqueName('Welcome guest');
  let creations = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/users') creations++;
  });

  await page.goto('/');
  await expect(page.locator('#welcome-guest')).toBeVisible();
  await page.locator('#welcome-guest-name').fill(name);
  await page.locator('#welcome-guest').click();
  await expect(page).toHaveURL(/\/(?:static\/portal\.html|portal)$/);
  await expect(page.locator('#account-menu').getByRole('button', { name, exact: true })).toBeVisible();
  expect(creations).toBe(1);
  expect(errors).toEqual([]);
  await expect(page.locator('#page-error')).toBeHidden();

  // Logged-in welcome immediately redirects; waiting for its load event
  // races that navigation. Check the final destination and account below.
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page).toHaveURL(/\/(?:static\/portal\.html|portal)$/);
  await expect(page.locator('#account-menu').getByRole('button', { name, exact: true })).toBeVisible();
  expect(creations).toBe(1);
  expect(errors).toEqual([]);
});

test('guest signup can retry a failed request and use the default name', async ({ page }) => {
  let attempts = 0;
  await page.route('**/users', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    if (++attempts === 1) {
      return route.fulfill({ status: 503, json: { detail: 'Please try again.' } });
    }
    return route.continue();
  });
  await page.goto('/');
  await page.locator('#welcome-guest').click();
  await expect(page.locator('#welcome-message')).toContainText('Please try again.');
  await expect(page.locator('#welcome-guest')).toBeEnabled();
  await page.locator('#welcome-guest').click();
  await expect(page).toHaveURL(/\/(?:static\/portal\.html|portal)$/);
  await expect(page.locator('#account-menu').getByRole('button', { name: 'Guest 1', exact: true })).toBeVisible();
  expect(attempts).toBe(2);
});

test('successful login from the welcome dialog continues to the games page', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const user = await createUser(request, uniqueName('Welcome login'));
  // Keep email delivery outside this browser-flow test.
  await page.route('**/auth/config', route => route.fulfill({ json: { email_login_enabled: true } }));
  await page.route('**/auth/email/start', route => route.fulfill({
    json: { verification_id: 'welcome-login', expires_in_seconds: 300 },
  }));
  await page.route('**/auth/email/verify', route => route.fulfill({ json: {
    user_id: user.id, display_name: user.display_name, password: user.password,
    linked_accounts: [{ kind: 'email', identifier: 'welcome@example.com' }],
  } }));

  await page.goto('/');
  await page.locator('#welcome-login').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email', { exact: true }).fill('welcome@example.com');
  await dialog.getByRole('button', { name: 'Email me a code', exact: true }).click();
  await dialog.getByLabel('Code', { exact: true }).fill('123456');
  await dialog.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page).toHaveURL(/\/(?:static\/portal\.html|portal)$/);
  await expect(page.locator('#account-menu').getByRole('button', { name: user.display_name, exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('after login the visitor returns to the ?next= page; external targets are ignored', async ({ page }) => {
  // A same-site return path named by the page that sent the visitor here.
  await page.goto('/?next=%2Fstatic%2Fportal.html');
  await page.locator('#welcome-guest-name').fill(uniqueName('Next guest'));
  await page.locator('#welcome-guest').click();
  await expect(page).toHaveURL(/\/static\/portal\.html$/);
  // An external or protocol-relative target is never honored: the visitor
  // (now logged in, so the welcome page forwards at once) lands on the
  // games page instead.
  await page.goto('/?next=%2F%2Fexample.com', { waitUntil: 'commit' });
  await expect(page).toHaveURL(/\/(?:static\/portal\.html|portal)$/);
});
