import {test, expect} from '@playwright/test';
import { mockBatch } from './helpers';

test('paged catalog keeps its controls usable after navigation and polling',async({page, request})=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/storage/capabilities',route=>route.fulfill({json:{pagination:true}}));
  await mockBatch(page, request, {
    '/v2/matches/open': { items: [], next_cursor: null },
    '/v2/games': (path: string) => {
      const second = new URL(path, 'http://test').searchParams.has('cursor');
      const game = {
        id: second ? 'page-two' : 'page-one',
        name: second ? 'Second page game' : 'First page game',
        description: 'Pagination fixture', version: 1, allowed_player_counts: [2],
        published: true, owner_user_id: 'fixture',
      };
      return { items: [game], next_cursor: second ? null : 'second-page' };
    },
  });
  await page.goto('/portal');
  await page.locator('#browse-games').click();
  const nav=page.locator('#game-results + .storage-pagination');
  await expect(page.locator('#game-results')).toContainText('First page game');
  await nav.locator('button').nth(1).click();
  await expect(page.locator('#game-results')).toContainText('Second page game');
  await expect(nav).toBeVisible();
  await nav.locator('button').nth(0).click();
  await expect(page.locator('#game-results')).toContainText('First page game');
  await expect(nav).toBeVisible();
  expect(errors).toEqual([]);
});
