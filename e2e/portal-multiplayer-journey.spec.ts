import { test, expect } from '@playwright/test';
import { createGame, createUser, loginAs, uniqueName } from './helpers';

declare const I18n: any;

test('friends create, share, join, play, rematch and leave through the portal', async ({ browser, request }, testInfo) => {
  test.setTimeout(90_000);
  const alice = await createUser(request, uniqueName('Lobby host'));
  const spectator = await createUser(request, uniqueName('Spectator'));
  const name = uniqueName('Friends duel');
  const game = await createGame(request, alice, name);
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext(testInfo.project.use)));
  try {
    const [a, b, watching] = await Promise.all(contexts.map(context => context.newPage()));
    await loginAs(a, alice);
    await loginAs(watching, spectator);
    // Capture the shared link without depending on system clipboard permissions.
    await a.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (link: string) => { (window as any).sharedMatchLink = link; } },
    }));
    await a.goto(`/static/portal.html?skin=classic#game=${game}`);
    await a.locator('#create').click();
    await expect(a.locator('#waiting')).toContainText('Invite others to join');
    await expect(a.getByRole('button', { name: 'Start game', exact: true })).toBeDisabled();
    const matchId = new URLSearchParams(new URL(a.url()).hash.slice(1)).get('match');
    expect(matchId).toBeTruthy();
    await a.getByRole('button', { name: 'Invite friends', exact: true }).click();
    await expect.poll(() => a.evaluate(() => (window as any).sharedMatchLink || '')).toContain(`#match=${matchId}`);
    const link = await a.evaluate(() => (window as any).sharedMatchLink as string);

    // An invited first-time player keeps the match destination through signup.
    await b.goto(link);
    await expect(b.locator('#welcome-guest-name')).toBeVisible();
    const bobName = uniqueName('Invited friend');
    await b.locator('#welcome-guest-name').fill(bobName);
    await b.locator('#welcome-guest').click();
    await expect(b).toHaveURL(new RegExp(`#match=${matchId}`));
    await b.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(b.locator('#seats')).toContainText(bobName);
    await expect(a.locator('#seats')).toContainText(bobName);
    await expect(b.locator('#waiting')).toContainText('The owner starts');
    await expect(a.locator('.invite-action')).toHaveText('Share match');
    await testInfo.attach('multiplayer-lobby', { body: await a.screenshot(), contentType: 'image/png' });
    await a.getByRole('button', { name: 'Start game', exact: true }).click();
    const boardA = a.frameLocator('#game-box iframe').locator('#board button');
    const boardB = b.frameLocator('#game-box iframe').locator('#board button');
    await expect(boardA).toHaveCount(9);
    await expect(boardB).toHaveCount(9);

    await watching.goto(`/static/portal.html#match=${matchId}`);
    const publicBoard = watching.frameLocator('#game-box iframe').locator('#board button');
    await expect(publicBoard).toHaveCount(9);
    await expect(publicBoard.filter({ hasNotText: /X|O/ }).first()).toBeDisabled();
    for (const [board, cell, mark] of [
      [boardA, 0, 'X'], [boardB, 3, 'O'], [boardA, 1, 'X'],
      [boardB, 4, 'O'], [boardA, 2, 'X'],
    ] as const) {
      await expect(board.nth(cell)).toBeEnabled();
      await board.nth(cell).click();
      await expect(publicBoard.nth(cell)).toHaveText(mark);
    }
    await expect(a.locator('#match-result')).toHaveText('You won');
    await expect(b.locator('#match-result')).toBeVisible();
    await expect(a.locator('.invite-action')).toHaveText('Share match');
    await a.getByRole('button', { name: 'Request rematch', exact: true }).click();
    await expect(a.locator('#waiting')).toBeVisible();
    await b.getByRole('button', { name: 'Join rematch', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Start game', exact: true })).toBeEnabled();
    await a.getByRole('button', { name: 'Start game', exact: true }).click();
    await expect(boardB).toHaveCount(9);
    await b.getByRole('button', { name: 'Controls', exact: true }).click();
    b.once('dialog', async dialog => {
      expect(dialog.message()).toContain('leave?');
      await dialog.accept();
    });
    await b.getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(a.locator('#match-result')).toBeVisible();
    await expect(b.locator('#match-status')).toHaveText('over');
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});

test('one click exits the focus selected by a skin or portal layout', async ({ page, request }) => {
  const owner = await createUser(request, uniqueName('Focus host'));
  const game = await createGame(request, owner, uniqueName('Focus duel'));
  const headers = { 'X-User-Id': owner.id, 'X-User-Password': owner.password };
  const match = await (await request.post('/matches', { headers, data: { game_id: game, num_computer_opponents: 1 } })).json();
  expect((await request.post(`/matches/${match.id}/start`, { headers, data: {} })).ok()).toBeTruthy();
  await loginAs(page, owner);
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const variant of [{ skin: 'immersive', archetype: '' }, { skin: 'classic', archetype: 'focus' }]) {
    await page.goto(`/static/portal.html?skin=${variant.skin}#match=${match.id}`);
    await expect(page.frameLocator('#game-box iframe').locator('#board button')).toHaveCount(9);
    await expect(page.locator('.invite-action')).toHaveText('Share match');
    if (variant.archetype) await page.evaluate(archetype => {
      document.documentElement.dataset.portalArchetype = archetype;
      document.dispatchEvent(new Event('portal-skin-change'));
    }, variant.archetype);
    await expect(page.locator('body')).toHaveClass(/match-focus/);
    await page.getByRole('button', { name: 'Exit focus', exact: true }).click();
    await expect(page.locator('body')).not.toHaveClass(/match-focus/);
    await expect(page.getByRole('button', { name: 'Focus', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: 'Focus', exact: true }).click();
    await expect(page.locator('body')).toHaveClass(/match-focus/);
  }
  await page.evaluate(async () => {
    await I18n.choose('es');
  });
  await page.context().setOffline(true);
  await expect(page.locator('#match-play-notice')).toHaveText('Sin conexión · las jugadas se guardan en este dispositivo');
});
