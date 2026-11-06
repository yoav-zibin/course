import fs from 'node:fs';
import path from 'node:path';
import {test, expect} from '@playwright/test';
import {createUser, loginAs, uniqueName} from './helpers';

test('Take Away plays to completion in real Portal matches', async ({browser, request}) => {
  test.setTimeout(120_000);
  const alice = await createUser(request, uniqueName('Take Away Alice'));
  const bob = await createUser(request, uniqueName('Take Away Bob'));
  const auth = (user: typeof alice) => ({'X-User-Id':user.id, 'X-User-Password':user.password});
  const client = fs.readFileSync(path.resolve(__dirname, '../games/take-away.html'), 'utf8');
  const server = fs.readFileSync(path.resolve(__dirname, '../games/take-away.server.js'), 'utf8');
  const tested = await request.post('/games/test', {headers:auth(alice), data:{
    server_code:server, allowed_player_counts:[2, 3], allows_leave_mid_match:false, allows_join_mid_match:false,
  }});
  expect(tested.ok()).toBeTruthy();
  const report = await tested.json();
  expect(report.passed).toBeTruthy();
  const game = await request.post('/games', {headers:auth(alice), data:{
    name:uniqueName('Take Away'), description:'Take the last stone', allowed_player_counts:[2, 3],
    code:client, server_code:server, game_schemas:report.game_schemas,
  }});
  expect(game.ok(), await game.text()).toBeTruthy();
  const gameId = (await game.json()).id;

  const openMatch = async (computer: boolean) => {
    const created = await request.post('/matches', {headers:auth(alice), data:{
      game_id:gameId, num_computer_opponents:computer ? 1 : 0,
    }});
    expect(created.ok(), await created.text()).toBeTruthy();
    const match = await created.json();
    if (!computer)
      expect((await request.post(`/matches/${match.id}/join`, {headers:auth(bob)})).ok()).toBeTruthy();
    expect((await request.post(`/matches/${match.id}/start`, {headers:auth(alice), data:{}})).ok()).toBeTruthy();
    return match.id as string;
  };
  const openPlayer = async (user: typeof alice, matchId: string) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, user);
    await page.goto(`/static/portal.html#match=${matchId}`);
    return {context, page, frame:page.frameLocator('#game-box iframe')};
  };

  const soloId = await openMatch(true);
  const solo = await openPlayer(alice, soloId);
  for (let n = 0; n < 9; n++) {
    await expect.poll(async () => {
      const status = await solo.frame.locator('#status').textContent();
      return Boolean(status?.includes('wins!')) || await solo.frame.locator('button[data-take]:enabled').count() > 0;
    }, {timeout:15_000}).toBeTruthy();
    const status = await solo.frame.locator('#status').textContent();
    if (status?.includes('wins!')) break;
    await solo.frame.locator('button[data-take]:enabled').first().click({timeout:15_000});
    await expect(solo.frame.locator('#status')).not.toHaveText(status || '', {timeout:15_000});
  }
  await expect(solo.frame.locator('#status')).toContainText('wins!', {timeout:15_000});
  await solo.context.close();

  const matchId = await openMatch(false);
  const a = await openPlayer(alice, matchId);
  const b = await openPlayer(bob, matchId);
  for (let n = 0; n < 3; n++) {
    const player = n % 2 === 0 ? a : b;
    await player.frame.locator('button[data-take="3"]:enabled').click({timeout:15_000});
  }
  await expect(a.frame.locator('#status')).toContainText('wins!', {timeout:15_000});
  await expect(b.frame.locator('#status')).toContainText('wins!', {timeout:15_000});
  await a.context.close();
  await b.context.close();
});
