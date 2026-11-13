import {test, expect} from '@playwright/test';
import {createGame, createUser, loginAs, uniqueName} from './helpers';

test('a failed list deletion stays visible through polling and can be retried', async ({page, request}) => {
  const owner = await createUser(request, uniqueName('List delete'));
  const name = uniqueName('Delete game');
  const game = await createGame(request, owner, name);
  const headers = {'X-User-Id':owner.id, 'X-User-Password':owner.password};
  const created = await request.post('/matches', {headers,
    data:{game_id:game, num_computer_opponents:0, bet_per_player:0}});
  expect(created.status()).toBe(201);
  const match = await created.json();
  let attempts = 0;
  await page.route(`**/matches/${match.id}`, async route => {
    if (route.request().method() !== 'DELETE') return route.continue();
    if (++attempts === 1) return route.fulfill({status:503, contentType:'application/json',
      body:JSON.stringify({detail:'Try this deletion again.'})});
    return route.continue();
  });
  await loginAs(page, owner);
  await page.goto('/static/portal.html?skin=lobby#matches');
  await page.locator('#group-waiting > summary').click();
  const row = page.locator('#list-waiting .match-list-row').filter({hasText:name});
  const remove = row.getByRole('button', {name:'Delete match', exact:true});
  await expect(remove).toBeVisible();
  await expect(page.locator('#match')).toBeHidden();
  await remove.click();
  await expect(row.getByRole('alert')).toHaveText('Try this deletion again.');
  const players = row.locator('.match-card-players');
  const before = await players.textContent();
  const updated = await request.patch(`/matches/${match.id}`, {headers,
    data:{num_computer_opponents:1}});
  expect(updated.ok()).toBe(true);
  await expect(players).not.toHaveText(before!);
  await expect(row.getByRole('alert')).toBeVisible();
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(row).toHaveCount(0);
  expect(attempts).toBe(2);
  await expect(page.locator('#match')).toBeHidden();
});
