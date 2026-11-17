import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { createUser, loginAs, mockBatch, uniqueName } from './helpers';

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname,
  '../tests/fixtures/leave_contract/catalog.json'), 'utf8'));

// Use the unchanged published solo games, with the same schemas as the server
// contract fixtures. All moves in these tests stay in local practice storage.
function soloGame(name: string) {
  const entry = catalog.find((game: any) => game.name === name);
  return {
    ...entry, description: `${name} solo puzzle`, owner_user_id: 'solo-fixture-owner',
    published: true, renderer_type: 'html',
    code: fs.readFileSync(path.join(__dirname, `../games/community/${entry.id}.original.html`), 'utf8'),
    server_code: fs.readFileSync(path.join(__dirname, '..', entry.server), 'utf8'),
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  };
}

const star = soloGame('Star Count');
const hanoi = soloGame('Tower of Hanoi');
const multiplayer = { ...star, id: 'multiplayer-setup-fixture', name: 'Multiplayer setup', description: 'A game for two people', allowed_player_counts: [2] };

async function prepare(page: Page, request: APIRequestContext) {
  const user = await createUser(request, uniqueName('Solo player'));
  await loginAs(page, user);
  const games = [star, hanoi, multiplayer];
  const mocks: Record<string, unknown> = { '/games': games, '/games/popular': [], '/users/me/recent-games': [] };
  for (const game of games) {
    mocks[`/games/${game.id}`] = game;
    mocks[`/games/${game.id}/versions/${game.version}`] = game;
  }
  await mockBatch(page, request, mocks);
  return user;
}

test('switching from a timed multiplayer setup to solo removes hidden match settings', async ({page, request}) => {
  await prepare(page, request);
  await page.goto(`/static/portal.html#game=${multiplayer.id}`);
  await page.locator('#match-speed').selectOption('60');
  await page.locator('#match-stake').selectOption('5');
  await page.locator('.back-to-games').click();
  await page.getByRole('combobox', {name: 'Search games'}).fill(star.name);
  await page.getByRole('option', {name: new RegExp(star.name)}).click();
  await expect(page.locator('#local-play-title')).toHaveText('Solo');
  await expect(page.locator('#online-play-hint')).toHaveText('Starts immediately. No opponent needed.');
  await expect(page.locator('#speed-choice')).toBeHidden();
  await expect(page.locator('#match-speed')).toBeDisabled();
  await expect(page.locator('#match-speed')).toHaveValue('');
  await expect(page.locator('#token-stake-panel')).toBeHidden();
  await expect(page.locator('#match-stake')).toHaveValue('0');
  await page.locator('#account-menu .auth-menu-button').click();
  await page.locator('#language-picker').selectOption('es');
  await expect(page.locator('#local-play-title')).toHaveText('Solo');
  await expect(page.locator('#online-play-hint')).not.toContainText('opponents');
  await page.locator('#language-picker').selectOption('en');
  await page.keyboard.press('Escape');
  await page.locator('.back-to-games').click();
  await page.getByRole('combobox', {name: 'Search games'}).fill(multiplayer.name);
  await page.getByRole('option', {name: new RegExp(multiplayer.name)}).click();
  await expect(page.locator('#local-play-title')).toHaveText('Pass and play');
  await expect(page.locator('#online-play-hint')).toHaveText('Set up your opponents in the lobby.');
  await expect(page.locator('#match-speed')).toBeEnabled();
  await expect(page.locator('#token-stake-panel')).toBeVisible();
});

test('solo Play again attempts to start immediately and keeps Start available after a connection error', async ({page, request}) => {
  const user = await prepare(page, request);
  const player = {player_index: 0, kind: 'human', user_id: user.id, id: user.id, active: true};
  const finished = {
    id: 'solo-finished-fixture', game_id: star.id, game_version: star.version,
    owner_user_id: user.id, players: [player], status: 'over', end_reason: 'finished',
    state: {count: 5}, move_count: 5, turn_of_player_indices: null,
    created_at: star.created_at, updated_at: star.updated_at, token_pot: 0, bet_per_player: 0,
  };
  let replay = {...finished, id: 'solo-replay-fixture', status: 'waiting_for_players', end_reason: null,
    state: {count: 0}, move_count: 0, turn_of_player_indices: [0]};
  const calls: string[] = [];
  await page.route('**/matches/solo-finished-fixture', route => route.fulfill({json: finished}));
  await page.route('**/matches/solo-finished-fixture/rematch', route => {
    calls.push('rematch');
    return route.fulfill({json: replay});
  });
  await page.route('**/matches/solo-replay-fixture', route => route.fulfill({json: replay}));
  let starts = 0;
  await page.route('**/matches/solo-replay-fixture/start', route => {
    calls.push('start');
    if (++starts === 1) return route.fulfill({status: 503, json: {detail: 'Start connection interrupted'}});
    replay = {...replay, status: 'ongoing'};
    return route.fulfill({json: replay});
  });
  await page.goto(`/static/portal.html#game=${star.id}&match=${finished.id}`);
  await page.getByRole('button', {name: 'Play again', exact: true}).click();
  await expect(page).toHaveURL(/match=solo-replay-fixture/);
  await expect(page.locator('#waiting')).toBeVisible();
  await expect(page.locator('#match-message')).toContainText('Start connection interrupted');
  await expect(page.getByRole('button', {name: 'Start game', exact: true})).toBeEnabled();
  expect(calls).toEqual(['rematch', 'start']);
  await page.getByRole('button', {name: 'Start game', exact: true}).click();
  await expect(page.locator('#match-status')).toHaveClass('badge ongoing');
  await expect(page.locator('#waiting')).toBeHidden();
  await expect(page.frameLocator('#game-box iframe').locator('#status')).toContainText('Count: 0 of 5');
  expect(calls).toEqual(['rematch', 'start', 'start']);
});

for (const game of [star, hanoi]) {
  test(`${game.name} local solo play finishes, replays and starts again through portal controls`, async ({page, request}) => {
    await prepare(page, request);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const writes: string[] = [];
    page.on('request', req => {
      if (req.method() !== 'GET' && new URL(req.url()).pathname.startsWith('/matches')) writes.push(req.url());
    });
    await page.goto(`/static/portal.html#game=${game.id}`);
    await page.locator('#practice').click();
    const frame = page.frameLocator('#game-box iframe');
    if (game.name === 'Star Count') {
      await expect(frame.locator('#status')).toContainText('Count: 0 of 5');
      for (let count = 1; count <= 5; count++) {
        await frame.locator('#add').click();
        await expect(frame.locator('#status')).toContainText(count === 5 ? 'You reached 5 stars!' : `Count: ${count} of 5`);
      }
    } else {
      await expect(frame.locator('#status')).toContainText('pick disk count');
      await frame.locator('#setup button[data-d="3"]').click();
      await expect(frame.locator('#pegs .peg')).toHaveCount(3);
      const solution = [[0,2], [0,1], [2,1], [0,2], [1,0], [1,2], [0,2]];
      for (const [index, [from,to]] of solution.entries()) {
        await frame.locator('#pegs .peg').nth(from).click();
        await frame.locator('#pegs .peg').nth(to).click();
        await expect(frame.locator('#moves')).toHaveText(String(index + 1));
      }
      await expect(frame.locator('#status')).toContainText('Solved in 7 moves!');
    }
    await expect(page.locator('#match-status')).toHaveClass('badge over');
    await expect(page.locator('#match-play-notice')).toHaveText('Match finished');
    await expect(page.locator('#match-result')).toHaveText('Match finished');
    const finishedUrl = page.url();
    if (await page.locator('#match-controls-toggle').getAttribute('aria-expanded') !== 'true')
      await page.locator('#match-controls-toggle').click();
    await page.locator('#history-back').click();
    await expect(page.locator('#history-position')).toContainText('read only');
    await page.locator('#history-live').click();
    await expect(page.locator('#history-position')).toContainText('Live');
    await page.locator('.match-more summary').click();
    await page.getByRole('button', {name: 'Start a new practice', exact: true}).click();
    await expect(page).not.toHaveURL(finishedUrl);
    await expect(page.locator('#match-status')).toHaveClass('badge ongoing');
    await expect(frame.locator('#status')).toContainText(game.name === 'Star Count' ? 'Count: 0 of 5' : 'pick disk count');
    if (await page.locator('#match-controls-toggle').getAttribute('aria-expanded') !== 'true')
      await page.locator('#match-controls-toggle').click();
    await page.getByRole('button', {name: 'End practice', exact: true}).click();
    await expect(page.locator('#match-status')).toHaveClass('badge over');
    await page.getByRole('button', {name: 'Resume practice', exact: true}).click();
    await expect(page.locator('#match-status')).toHaveClass('badge ongoing');
    await page.locator('#match-back').click();
    await expect(page.locator('#match')).toBeHidden();
    await expect(page.locator('#game-detail-page')).toBeVisible();
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });
}
