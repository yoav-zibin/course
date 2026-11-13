import { test, expect } from '@playwright/test';
import { createGame, createUser, loginAs, uniqueName } from './helpers';

test('selected game shows its score and refreshes after a start from another client', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const owner = await createUser(request, uniqueName('Popularity'));
  const game = await createGame(request, owner, uniqueName('Ranked game'));
  await loginAs(page, owner);
  await page.goto(`/static/portal.html?game=${game}`);
  const score = page.locator('#selected-game-popularity');
  await expect(score).toBeVisible();
  await expect(score).toHaveText('Popularity score: 0');

  const headers = { 'X-User-Id': owner.id, 'X-User-Password': owner.password };
  const created = await request.post('/matches', {
    headers, data: { game_id: game, num_computer_opponents: 1 },
  });
  expect(created.ok()).toBeTruthy();
  const match = await created.json();
  const started = await request.post(`/matches/${match.id}/start`, { headers, data: {} });
  expect(started.ok(), await started.text()).toBeTruthy();

  // Advance the freshness clock while leaving polling/network timers running normally.
  await page.evaluate(() => {
    const now = Date.now.bind(Date);
    Date.now = () => now() + 61_000;
  });
  await expect(score).toHaveText('Popularity score: 2', { timeout: 10_000 });
  expect(errors).toEqual([]);
});
