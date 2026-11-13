import { test, expect } from '@playwright/test';
import { createGame, createUser, loginAs, uniqueName } from './helpers';

test('referral match link survives switching accounts and opens the intended lobby', async ({ page, request }) => {
  const alice = await createUser(request, uniqueName('Inviter'));
  const bob = await createUser(request, uniqueName('Joiner'));
  const auth = (u: typeof alice) => ({ 'X-User-Id': u.id, 'X-User-Password': u.password });
  const gameId = await createGame(request, alice, uniqueName('Invited duel'));
  const created = await request.post('/matches', {headers: auth(alice), data: {game_id: gameId}});
  expect(created.ok()).toBeTruthy();
  const match = await created.json();
  await page.addInitScript(({first, second}) => {
    if (window !== window.top) return;
    localStorage.setItem('game-platform.accounts.v1', JSON.stringify([first, second].map(u => ({...u, linked: [], picture_url: ''}))));
    localStorage.setItem('game-platform.current-account.v1', first.id);
  }, {first: alice, second: bob});
  await page.goto(`/r/80479#match=${match.id}`);
  await expect(page.getByRole('button', {name: 'Start game', exact: true})).toBeVisible();
  await page.evaluate((id) => { Auth.setCurrent(id); }, bob.id);
  await expect(page).toHaveURL(new RegExp(`#match=${match.id}`));
  await expect(page.getByRole('button', {name: 'Join', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Join', exact: true}).click();
  await expect.poll(async () => (await (await request.get(`/matches/${match.id}`, {headers: auth(alice)})).json()).players.length).toBe(2);
});

test('two players in separate browsers: join an online match and see each other\'s moves', async ({ browser, request }) => {
  const alice = await createUser(request, uniqueName('Alice'));
  const bob = await createUser(request, uniqueName('Bob'));
  const gameId = await createGame(request, alice, uniqueName('Duel'));
  const auth = (u: typeof alice) => ({ 'X-User-Id': u.id, 'X-User-Password': u.password });

  const created = await request.post('/matches', { headers: auth(alice), data: { game_id: gameId, num_computer_opponents: 0 } });
  expect(created.ok()).toBeTruthy();
  const match = await created.json();
  expect((await request.post(`/matches/${match.id}/join`, { headers: auth(bob) })).ok()).toBeTruthy();
  expect((await request.post(`/matches/${match.id}/start`, { headers: auth(alice), data: {} })).ok()).toBeTruthy();

  const open = async (user: typeof alice) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, user);
    await page.goto(`/static/portal.html#match=${match.id}`);
    return { context, page, board: page.frameLocator('#game-box iframe').locator('#board button') };
  };
  const a = await open(alice);
  const b = await open(bob);

  await expect(a.board).toHaveCount(9);
  await expect(b.board).toHaveCount(9);

  // Hold Bob's next catalog refresh open. His active match must still receive
  // Alice's move without waiting for that unrelated request to finish. The
  // refresh goes out as one /batch call; the live match poll is a direct
  // request, so holding the batch must not hold the match.
  let releaseCatalog!: () => void;
  const catalogBlocked = new Promise<void>(resolve => { releaseCatalog = resolve; });
  let catalogStarted!: () => void;
  const started = new Promise<void>(resolve => { catalogStarted = resolve; });
  await b.page.route('**/batch?*', async route => {
    catalogStarted();
    await catalogBlocked;
    await route.continue().catch(() => {});
  });
  await started;
  await a.board.nth(4).click();
  await expect(a.board.nth(4)).toHaveText(/X|O/);
  await expect(b.board.nth(4)).toHaveText(/X|O/, { timeout: 5_000 });
  releaseCatalog();

  await a.context.close();
  await b.context.close();
});
