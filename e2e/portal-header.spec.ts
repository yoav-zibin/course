import { test, expect } from '@playwright/test';
import { createUser, loginAs, mockBatch, uniqueName } from './helpers';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('wallet appears before the profile response and refreshes its balance later', async ({ page, request }) => {
  const user = await createUser(request, uniqueName('😀 Wallet'));
  await loginAs(page, user);
  let gate = deferred();
  let profileRequested = deferred();
  let balance = 27;
  let failRefresh = false;
  await page.route('**/batch?*', async route => {
    const items = JSON.parse(new URL(route.request().url()).searchParams.get('requests') || '[]');
    const profileIndex = items.findIndex((item: { path: string }) => item.path === `/users/${user.id}`);
    if (profileIndex < 0) return route.continue();
    const pending = gate;
    const captured = profileRequested;
    const response = await route.fetch();
    const body = await response.json();
    if (failRefresh) body[profileIndex] = { status: 503, body: { detail: 'Temporary profile failure' } };
    else body[profileIndex].body.token_balance = balance;
    captured.resolve();
    await pending.promise;
    await route.fulfill({ response, json: body });
  });

  await page.goto('/static/portal.html', { waitUntil: 'domcontentloaded' });
  const wallet = page.locator('#token-wallet');
  try {
    await profileRequested.promise;
    await expect(wallet).toBeVisible();
    await expect(wallet.locator('#token-balance')).toHaveText('0');
    await expect(page.locator('#account-menu .auth-menu-button')).toBeVisible();
    await expect(page.locator('#account-menu .auth-avatar-placeholder')).toHaveText('😀');
  } finally {
    gate.resolve();
  }
  await expect(wallet.locator('#token-balance')).toHaveText('27');
  await expect(wallet).toBeVisible();

  // A warm load can show the last balance while its fresh profile is pending.
  gate = deferred();
  profileRequested = deferred();
  balance = 41;
  await page.reload({ waitUntil: 'domcontentloaded' });
  try {
    await profileRequested.promise;
    await expect(wallet).toBeVisible();
    await expect(wallet.locator('#token-balance')).toHaveText('27');
  } finally {
    gate.resolve();
  }
  await expect(wallet.locator('#token-balance')).toHaveText('41');

  failRefresh = true;
  await page.evaluate('refresh()');
  await expect(wallet).toBeVisible();
  await expect(wallet.locator('#token-balance')).toHaveText('41');
});

test('mobile match and focus layouts retain their header visibility rules', async ({ page, request }) => {
  await loginAs(page, await createUser(request, uniqueName('Match header')));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/static/portal.html');
  await page.addScriptTag({url: '/static/portal-match-layout.js'});
  // Exercise the real layout controller and styles without creating a match.
  const views = await page.evaluate(() => {
    const layout = (window as any).PortalMatchLayout;
    layout.init(() => {});
    const header = document.querySelector('.topbar[data-app-page="portal"]')!;
    layout.update({id: 'header-layout-fixture', status: 'waiting_for_players'});
    const lobby = getComputedStyle(header).display;
    layout.update({id: 'header-layout-fixture', status: 'ongoing'});
    const match = getComputedStyle(header).display;
    if (!document.body.classList.contains('match-focus'))
      document.getElementById('match-focus-toggle')!.click();
    const focused = getComputedStyle(header).display;
    layout.update(null);
    return {lobby, match, focused, catalog: getComputedStyle(header).display};
  });
  expect(views.lobby, 'lobby').toBe('none');
  expect(views.match, 'match').toBe('none');
  expect(views.focused, 'focus').toBe('none');
  expect(views.catalog, 'catalog').not.toBe('none');
});

test('phone header keeps brand, wallet, and account on one row', async ({ page, request }, testInfo) => {
  const user = await createUser(request, uniqueName('A very long account display name'));
  const profile = await (await request.get(`/users/${user.id}`, {
    headers: { 'X-User-Id': user.id, 'X-User-Password': user.password },
  })).json();
  await loginAs(page, user);
  await mockBatch(page, request, { [`/users/${user.id}`]: { ...profile, token_balance: 12345 } });
  await page.emulateMedia({ reducedMotion: 'reduce' });

  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/static/portal.html');
    const header = page.locator('.topbar[data-app-page="portal"]');
    const account = header.locator('.auth-menu-button');
    await expect(header.locator('#token-balance')).toHaveText('12345');
    await expect(account).toHaveAccessibleName(user.display_name);
    const controls = header.locator('.sidebar-toggle:visible, .app-home-link:visible, #token-wallet:visible, .auth-menu-button:visible');
    await expect(controls).toHaveCount(3);
    const positions = await controls.evaluateAll(elements => elements.map(element => {
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left, right: bounds.right, center: bounds.top + bounds.height / 2,
        width: bounds.width, height: bounds.height, button: element.matches('button'),
      };
    }));
    expect(Math.max(...positions.map(item => item.center)) - Math.min(...positions.map(item => item.center)),
      `${width}px: primary controls must share one header row`).toBeLessThanOrEqual(2);
    for (const position of positions) {
      expect(position.left).toBeGreaterThanOrEqual(0);
      expect(position.right).toBeLessThanOrEqual(width);
      if (position.button) {
        expect(position.width).toBeGreaterThanOrEqual(44);
        expect(position.height).toBeGreaterThanOrEqual(44);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await account.click();
    await expect(header.locator('.auth-menu-panel')).toBeVisible();
    await expect(header.locator('.auth-menu-heading')).toContainText(user.display_name);
    await account.click();
    await page.screenshot({ path: testInfo.outputPath(`header-${width}.png`) });
  }
});
