import fs from 'node:fs';
import path from 'node:path';
import {test, expect} from '@playwright/test';
import {createUser, loginAs, mockBatch, uniqueName} from './helpers';

test('the portal ignores a stale HTML catalog entry and never loads legacy APIs', async ({page, request}) => {
  const payload = JSON.parse(fs.readFileSync(path.join(__dirname, '../games/declarative/tictactoe.json'), 'utf8'));
  const game = {...payload, id:'declarative-retirement-fixture', version:1, name:'Declarative fixture',
    renderer_type:'declarative', code:'', game_schemas:{state:payload.unit_tests.state_schema,
      move:payload.unit_tests.move_schema, view:payload.unit_tests.view_schema}};
  const html = {id:'retired-html-fixture', version:1, name:'Retired HTML fixture',
    renderer_type:'html', allowed_player_counts:[2]};
  await loginAs(page, await createUser(request, uniqueName('Declarative visitor')));
  const legacyRequests:string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    const paths = url.pathname === '/batch'
      ? JSON.parse(url.searchParams.get('requests') || '[]').map((item:{path:string}) => item.path)
      : [url.pathname];
    legacyRequests.push(...paths.filter((path:string) => path.startsWith('/legacy/')));
  });
  await page.route('**/legacy/**', route => route.abort());
  await mockBatch(page, request, {
    '/games':[game, html], '/games/popular':[], '/users/me/recent-games':[],
    [`/games/${game.id}`]:game, [`/games/${game.id}/versions/1`]:game,
  });
  await page.goto('/static/portal.html#games');
  await expect(page.locator('.library-title', {hasText:game.name})).toBeVisible();
  await expect(page.locator('.library-title', {hasText:html.name})).toHaveCount(0);
  await page.locator('.library-card', {has:page.locator('.library-title', {hasText:game.name})}).click();
  await page.locator('#practice').click();
  await expect(page.locator('#game-box .declarative-stage')).toBeVisible();
  await expect(page.locator('#game-box > iframe:visible')).toHaveCount(0);
  expect(legacyRequests).toEqual([]);
});
