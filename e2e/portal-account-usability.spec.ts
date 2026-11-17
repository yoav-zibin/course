import { test, expect } from '@playwright/test';
import { createGame, createUser, loginAs, uniqueName } from './helpers';

test('all portal languages switch and English labels return after a translated reload', async ({ page, request }) => {
  const user = await createUser(request, uniqueName('Languages'));
  await loginAs(page, user);
  await page.goto('/static/portal.html');
  await page.locator('.auth-menu-button').click();
  const picker = page.locator('#language-picker');
  for (const locale of ['es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar', 'en']) {
    await picker.selectOption(locale);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(picker).toHaveValue(locale);
  }
  await picker.selectOption('es');
  await expect(picker).toHaveAccessibleName('Idioma');
  await expect(page.locator('.app-home-link')).toHaveAttribute('title', 'Volver a los juegos');
  await page.reload();
  await page.locator('.auth-menu-button').click();
  await expect(picker).toHaveAccessibleName('Idioma');
  await picker.selectOption('en');
  await expect(picker).toHaveAccessibleName('Language');
  await expect(picker).toHaveAttribute('title', 'Language');
  await expect(page.locator('.app-home-link')).toHaveAttribute('title', 'Back to games');
});

test('login dialog has a name, contains keyboard focus, and Escape returns to its opener', async ({ page }) => {
  await page.goto('/');
  const opener = page.locator('#welcome-login');
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Log in', exact: true });
  await expect(dialog).toBeVisible();
  const name = dialog.getByLabel('Guest name');
  const submit = dialog.getByRole('button', { name: 'Continue as guest' });
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  await expect(name).toBeFocused();
  await submit.focus();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(submit).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('a guest can submit the login dialog by pressing Enter', async ({ page }) => {
  const name = uniqueName('Enter guest');
  await page.goto('/');
  await page.locator('#welcome-login').click();
  const input = page.getByRole('dialog').getByLabel('Guest name');
  await input.fill(name);
  await input.press('Enter');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.auth-menu-button')).toHaveAccessibleName(name);
});

test('Escape closes only the login dialog before reaching match controls', async ({ page, request }) => {
  test.setTimeout(60_000);
  const user = await createUser(request, uniqueName('Modal keyboard'));
  const game = await createGame(request, user, uniqueName('Modal match'));
  const headers = {'X-User-Id': user.id, 'X-User-Password': user.password};
  const match = await (await request.post('/matches', {headers, data: {game_id: game, num_computer_opponents: 1}})).json();
  expect((await request.post(`/matches/${match.id}/start`, {headers, data: {}})).ok()).toBeTruthy();
  await loginAs(page, user);
  await page.goto(`/static/portal.html?skin=classic#match=${match.id}`);
  await expect(page.locator('#game-box .declarative-stage')).toBeVisible();
  const controls = page.locator('#match-controls-toggle');
  if (await controls.getAttribute('aria-expanded') !== 'true') await controls.click();
  await page.evaluate('Auth.openDialog()');
  const dialog = page.getByRole('dialog', {name: 'Log in', exact: true});
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(controls).toHaveAttribute('aria-expanded', 'true');
  await controls.focus();
  await page.keyboard.press('Escape');
  await expect(controls).toHaveAttribute('aria-expanded', 'false');
});

test('a canceled guest login cannot switch accounts or close a newer dialog', async ({ page, request }) => {
  const user = await createUser(request, uniqueName('Keep current account'));
  await loginAs(page, user);
  let release!: () => void, received!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { received = resolve; });
  await page.route('**/users', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    received();
    await gate;
    await route.fulfill({response});
  });
  await page.goto('/static/portal.html');
  const openLogin = async () => {
    await page.locator('.auth-menu-button').click();
    await page.locator('[data-auth-action="login"]').click();
  };
  await openLogin();
  const dialog = page.getByRole('dialog', {name: 'Log in', exact: true});
  await dialog.getByLabel('Guest name').fill('Canceled guest');
  const submit = dialog.getByRole('button', {name: 'Continue as guest'});
  await submit.evaluate(button => { (window as any).pendingGuestSubmit = button; });
  await submit.click();
  try {
    await requested;
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await openLogin();
    await dialog.getByLabel('Guest name').fill('Still editing');
    release();
    await page.waitForFunction(() => !(window as any).pendingGuestSubmit.disabled);
    expect(await page.evaluate('Auth.current()?.id')).toBe(user.id);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Guest name')).toHaveValue('Still editing');
  } finally {
    release();
  }
});

test('email code forms support Enter to send and verify without losing resend', async ({ page, request }) => {
  const user = await createUser(request, uniqueName('Code keyboard'));
  await page.route('**/auth/config', route => route.fulfill({ json: { email_login_enabled: true } }));
  let sends = 0;
  await page.route('**/auth/email/start', route => route.fulfill({ json: {
    verification_id: `local-${++sends}`, expires_in_seconds: 600,
  } }));
  await page.route('**/auth/email/verify', async route => {
    expect(route.request().postDataJSON()).toMatchObject({ verification_id: 'local-2', code: '123456' });
    await route.fulfill({ json: { ...user, user_id: user.id } });
  });
  await page.goto('/');
  await page.locator('#welcome-login').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email', { exact: true }).fill('player@example.com');
  await dialog.getByLabel('Email', { exact: true }).press('Enter');
  await expect(dialog.getByLabel('Code', { exact: true })).toBeFocused();
  await expect.poll(() => sends).toBe(1);
  await dialog.getByRole('button', { name: 'Send again', exact: true }).click();
  await expect.poll(() => sends).toBe(2);
  await expect(dialog.getByRole('button', { name: 'Send again', exact: true })).toBeEnabled();
  await dialog.getByLabel('Code', { exact: true }).fill('123456');
  await dialog.getByLabel('Code', { exact: true }).press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.auth-menu-button')).toHaveAccessibleName(user.display_name);
});

test('account menu exposes its state and Escape restores focus', async ({ page, request }) => {
  const user = await createUser(request, uniqueName('Menu keyboard'));
  await loginAs(page, user);
  await page.goto('/static/portal.html');
  const toggle = page.locator('.auth-menu-button');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.locator('[data-auth-action="link"]').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.auth-menu-panel')).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
});

test('linking a login never offers to replace the current account with a new guest', async ({ page, request }) => {
  const user = await createUser(request, uniqueName('Keep guest'));
  await loginAs(page, user);
  await page.route('**/auth/config', route => route.fulfill({ json: { email_login_enabled: true } }));
  await page.goto('/static/portal.html');
  await page.locator('.auth-menu-button').click();
  await page.locator('[data-auth-action="link"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName(`Link a login to ${user.display_name}`);
  await expect(dialog.getByLabel('Email', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Continue as guest' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.auth-menu-button')).toHaveAccessibleName(user.display_name);
  await expect(page.locator('.auth-menu-button')).toBeFocused();
});

test('Arabic phone preferences fit the viewport and wrap a long account name', async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const user = await createUser(request, uniqueName('لاعب تجريبي باسم طويل للغاية لاختبار جميع خيارات الحساب على الهاتف'));
  await loginAs(page, user);
  await page.goto('/static/portal.html?skin=classic');
  const menu = page.locator('.auth-menu-panel');
  await page.locator('.auth-menu-button').click();
  await page.locator('#language-picker').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const checkFit = async () => {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    const bounds = await menu.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360);
    expect(await menu.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  };
  await checkFit();
  await page.locator('#portal-skin-picker').selectOption('sunset');
  await page.locator('#portal-layout-picker').selectOption('top');
  await expect(page.locator('#portal-skin-picker')).toHaveValue('sunset');
  await expect(page.locator('#portal-layout-picker')).toHaveValue('top');
  await checkFit();
  await page.locator('#language-picker').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await checkFit();
  await page.locator('#language-picker').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.locator('.auth-menu-button').click();
  await page.locator('.auth-menu-button').click();
  await checkFit();
  await page.locator('#offline-storage > summary').click();
  await expect(page.locator('#storage-refresh')).toBeVisible();
  await page.locator('#storage-refresh').click();
  await checkFit();
});
