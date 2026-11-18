import { test, expect } from '@playwright/test';
import { createGame, createUser, loginAs, uniqueName } from './helpers';

test.describe('Choosing and playing a game (logged in, real server)', () => {
  for (const entry of ['card', 'detail']) {
    test(`quick play from the ${entry} starts the chosen game free against a computer`, async ({page, request}) => {
      const owner = await createUser(request, uniqueName('Quick play'));
      const name = uniqueName('Quick game');
      const game = await createGame(request, name);
      await loginAs(page, owner);
      await page.goto(entry === 'card' ? '/static/portal.html#games' : `/static/portal.html#game=${game}`);
      const button = entry === 'card'
        ? page.locator('.library-card-wrap').filter({has: page.locator('.library-title', {hasText: name})})
          .getByRole('button', {name: `Play ${name} against computers now`, exact: true})
        : page.locator('#quick-play');
      const creation = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/matches');
      await button.click();
      expect((await creation).postDataJSON()).toEqual({game_id: game, num_computer_opponents: 1, bet_per_player: 0});
      await expect(page.locator('body')).toHaveClass(/match-immersive/);
      await expect(page.locator('#match-toolbar-title')).toBeEmpty();
      const board = page.locator('#game-box .declarative-target');
      await expect(board).toHaveCount(9);
      await board.first().click();
      await expect(page.locator('#game-box [data-ui-id=piece_0]')).toHaveText('X');
      await expect(page.locator('#game-box .declarative-piece').filter({hasText: 'O'})).toHaveCount(1, {timeout: 15_000});
    });
  }

  test('search for a game, open it and play a match against the computer', async ({ page, request }) => {
    const owner = await createUser(request, uniqueName('Owner'));
    const gameName = uniqueName('Noughts');
    await createGame(request, gameName);
    const player = await createUser(request, uniqueName('Player'));
    await loginAs(page, player);

    await page.goto('/static/portal.html');
    await page.getByRole('combobox', { name: 'Search games' }).fill(gameName);
    await page.getByRole('option', { name: new RegExp(gameName) }).click();

    await expect(page.locator('#selected-game-name')).toHaveText(gameName);
    // Online computer matches remain server-authoritative.
    await page.getByRole('button', { name: /Play with computers/ }).click();
    await expect(page.locator('#match')).toBeVisible();

    const board = page.locator('#game-box .declarative-target');
    await expect(board).toHaveCount(9);
    await board.first().click();
    await expect(page.locator('#game-box [data-ui-id=piece_0]')).toHaveText('X');
    // The server moves the computer itself: its O appears without
    // anyone acting on its behalf.
    await expect(page.locator('#game-box .declarative-piece').filter({ hasText: 'O' })).toHaveCount(1, { timeout: 15_000 });
  });

  test('create an online match and see it listed', async ({ page, request }) => {
    const owner = await createUser(request, uniqueName('Owner'));
    const gameName = uniqueName('OnlineGame');
    await createGame(request, gameName);
    await loginAs(page, owner);

    await page.goto('/static/portal.html');
    await page.getByRole('combobox', { name: 'Search games' }).fill(gameName);
    await page.getByRole('option', { name: new RegExp(gameName) }).click();
    await page.getByRole('button', { name: /Create public match/ }).click();

    await expect(page.locator('#match')).toBeVisible();
    await expect(page.locator('#match-toolbar-title')).toContainText(gameName);
  });
});
