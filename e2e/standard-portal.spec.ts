import {test, expect} from '@playwright/test';
import {createGame, createUser, loginAs, mockBatch, uniqueName} from './helpers';

test('the standard portal exposes games, matches and the actual token wallet', async ({page, request}) => {
  const user = await createUser(request, uniqueName('Standard portal'));
  const game = await createGame(request, uniqueName('Standard game'));
  await loginAs(page, user);
  const headers = {'X-User-Id': user.id, 'X-User-Password': user.password};
  const profile = await (await request.get(`/users/${user.id}`, {headers})).json();
  await mockBatch(page, request, {[`/users/${user.id}`]: {...profile, token_balance: 73}});
  const obsoleteRequests: string[] = [];
  page.on('request', request => {
    if (/\/experiments\/skin|\/experiments\.(css|js)|\/portal-chat-preview\.js/.test(request.url()))
      obsoleteRequests.push(request.url());
  });
  await page.addInitScript(() => {
    // Retired preferences left by an existing browser must not change the UI.
    localStorage.setItem('game-platform.portal-skin-preference.v1', 'party');
    document.cookie = 'game-platform.portal-skin.v1=neon; Path=/';
  });
  await page.goto('/static/portal.html');
  const nav = page.getByRole('navigation', {name: 'Main navigation'});
  await expect(nav.getByRole('link', {name: 'Games', exact: true})).toBeVisible();
  await expect(nav.getByRole('link', {name: /Matches/})).toBeVisible();
  await expect(nav.getByRole('link')).toHaveCount(2);
  await expect(page.locator('.library-card').first()).toBeVisible();
  await expect(page.locator('#token-balance')).toHaveText('73');
  await expect(page.locator('#token-wallet')).toContainText('tokens');
  await expect(page.locator('#token-wallet')).toHaveAttribute('data-i18n-title', 'ui.portal.wallet_title');
  await page.locator('.auth-menu-button').click();
  await expect(page.locator('#portal-skin-picker, #community-chat, #leaderboards-screen')).toHaveCount(0);
  await expect(page.getByRole('combobox', {name: /skin|theme/i})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await nav.getByRole('link', {name: /Matches/}).click();
  await expect(page.locator('#my-matches')).toBeVisible();
  await nav.getByRole('link', {name: 'Games', exact: true}).click();
  const palette = () => page.locator('.portal-main').evaluate(node => getComputedStyle(node).backgroundColor);
  const standardPalette = await palette();
  for (const retiredSkin of ['classic', 'neon', 'party', 'meadow']) {
    await page.goto(`/static/portal.html?skin=${retiredSkin}#games`);
    await expect(page.locator('.library-card').first()).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-skin');
    await expect.poll(palette).toBe(standardPalette);
    await expect(nav.getByRole('link')).toHaveCount(2);
  }
  expect(obsoleteRequests).toEqual([]);
  await page.goto(`/static/portal.html#game=${game}`);
  await expect(page.locator('#match-stake option[value="1"]')).toHaveText('1 token');
});
