import fs from 'node:fs';
import path from 'node:path';
import {expect, test, type APIRequestContext, type Page} from '@playwright/test';
import {createUser, loginAs, uniqueName} from './helpers';

declare const state: any;
declare const frame: any;

async function backgammon(request: APIRequestContext) {
  const catalog = await (await request.get('/games')).json();
  const known = (Array.isArray(catalog) ? catalog : catalog.items || [])
    .find((game: any) => game.name === 'Backgammon (Declarative)');
  if (known) return known;
  const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../games/declarative/backgammon.json'), 'utf8'));
  data.game_addition_request_id_and_secret = uniqueName('immersive-backgammon');
  let response = await request.post('/games/declarative', {data, timeout: 210000});
  for (let attempt = 0; response.status() === 429 && attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    response = await request.post('/games/declarative', {data, timeout: 210000});
  }
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function camera(page: Page) {
  return page.locator('#game-box .declarative-stage').evaluate((stage: SVGSVGElement) => {
    const view = stage.viewBox.baseVal;
    return {x: view.x, y: view.y, width: view.width, height: view.height};
  });
}

async function screenPoint(page: Page, x: number, y: number) {
  return page.locator('#game-box .declarative-stage').evaluate((stage: SVGSVGElement, point) => {
    const p = stage.createSVGPoint();
    p.x = point.x; p.y = point.y;
    const transformed = p.matrixTransform(stage.getScreenCTM()!);
    return {x: transformed.x, y: transformed.y};
  }, {x, y});
}

test('Portal Backgammon fills portrait and short landscape with only the board and keeps native gestures playable', async ({page, request}, testInfo) => {
  test.setTimeout(120000);
  const game = await backgammon(request);
  const account = await createUser(request, uniqueName('Immersive player'));
  await page.setViewportSize({width: 1024, height: 430});
  await loginAs(page, account);
  await page.goto(`/static/portal.html#game=${game.id}`);
  await page.locator('#practice').click();

  const host = page.locator('#game-box');
  const stage = host.locator('.declarative-stage');
  await expect(stage).toBeVisible();
  // New matches use the same Options screen as the reference. Start the
  // actual pass-and-play game before measuring the playable presentation.
  await expect(host.locator('[data-ui-id="options_panel"]')).toBeVisible();
  await host.locator('[data-ui-id="start_game"] > g[opacity]').click();
  await expect(host.locator('[data-ui-id="options_panel"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => state.match.state.configured)).toBe(true);
  const configuredCount = await page.evaluate(() => state.match.move_count);
  await expect(page.locator('body')).toHaveClass(/match-immersive/);
  await expect(host.locator('.declarative-piece[data-ui-id^="checker_"]')).toHaveCount(30);
  await expect(host.locator('.declarative-zoom-controls')).toHaveCount(0);
  await expect(host.locator('.declarative-zoom-hint')).toHaveCount(0);
  await expect(stage.locator('text').filter({hasText: /Highlights show|Pinch to zoom|Zoom:|Backgammon \(Declarative\)/})).toHaveCount(0);
  await expect(page.locator('.match-toolbar')).toBeHidden();
  await expect(page.locator('#match-title')).toBeHidden();
  await expect(page.locator('#match-toolbar-title')).toBeEmpty();
  await expect(page.locator('#match-menu-toggle')).toBeVisible();

  for (const skin of ['classic', 'sunset', 'arcade', 'immersive']) {
    await page.evaluate(skin => {
      document.documentElement.dataset.skin = skin;
      document.dispatchEvent(new CustomEvent('portal-skin-change', {detail: {key: skin}}));
    }, skin);
    for (const viewport of [{width: 1024, height: 430}, {width: 390, height: 844}]) {
      await page.setViewportSize(viewport);
      await expect(page.locator('body > .topbar')).toBeHidden();
      await expect(page.locator('.portal-sidebar')).toBeHidden();
      await expect(page.locator('.match-toolbar')).toBeHidden();
      await testInfo.attach(`board-only-${skin}-${viewport.width}x${viewport.height}`, {
        body: await page.screenshot({path: testInfo.outputPath(`board-only-${skin}-${viewport.width}x${viewport.height}.png`)}),
        contentType: 'image/png',
      });
      // The fixed presentation includes felt, player cards and tools around
      // the wooden board. Verify its complete 800×600 scene fills the panel,
      // while both corners of the wooden board and bear-off tray remain visible.
      try {
        await expect.poll(async () => {
          const sceneTop = await screenPoint(page, 0, 0);
          const sceneBottom = await screenPoint(page, 800, 600);
          const top = await screenPoint(page, 20, 105);
          const bottom = await screenPoint(page, 784, 545);
          return sceneTop.x >= -1 && sceneTop.y >= -1 &&
            sceneBottom.x <= viewport.width + 1 && sceneBottom.y <= viewport.height + 1 &&
            top.x >= -1 && top.y >= -1 &&
            bottom.x <= viewport.width + 1 && bottom.y <= viewport.height + 1 &&
            Math.max((sceneBottom.x - sceneTop.x) / viewport.width,
              (sceneBottom.y - sceneTop.y) / viewport.height) > .98;
        }, `${skin} ${viewport.width}x${viewport.height}: full board must fit and fill the available screen`).toBe(true);
      } catch (error) {
        const layout = await page.evaluate(() => Array.from(document.querySelectorAll('body,.portal-shell,.portal-main,#match,#game-box,.declarative-stage')).map(node => {
          const element = node as HTMLElement, style = getComputedStyle(element), rect = element.getBoundingClientRect();
          return {selector: element.id || element.getAttribute('class') || element.tagName,
            rect: {x:rect.x,y:rect.y,width:rect.width,height:rect.height},
            height:style.height,minHeight:style.minHeight,flex:style.flex,
            overflow:style.overflow,padding:style.padding,border:style.border,
            gap:style.gap,gridTemplateRows:style.gridTemplateRows,
            before:getComputedStyle(element,'::before').content,
            after:getComputedStyle(element,'::after').content};
        }));
        fs.writeFileSync(testInfo.outputPath(`layout-${skin}-${viewport.width}x${viewport.height}.json`),JSON.stringify(layout,null,2));
        throw error;
      }
      const top = await screenPoint(page, 20, 105);
      const bottom = await screenPoint(page, 784, 545);
      const sceneTop = await screenPoint(page, 0, 0);
      const sceneBottom = await screenPoint(page, 800, 600);
      expect(top.x).toBeGreaterThanOrEqual(-1);
      expect(top.y).toBeGreaterThanOrEqual(-1);
      expect(bottom.x).toBeLessThanOrEqual(viewport.width + 1);
      expect(bottom.y).toBeLessThanOrEqual(viewport.height + 1);
      expect(Math.max((sceneBottom.x - sceneTop.x) / viewport.width,
        (sceneBottom.y - sceneTop.y) / viewport.height)).toBeGreaterThan(.98);
    }
  }

  const before = await camera(page);
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5});
  const touch = (id: number, x: number, y: number) => ({id, x, y, radiusX: 1, radiusY: 1, force: 1});
  const center = await screenPoint(page, 402, 325);
  await client.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [
    touch(1, center.x - 30, center.y), touch(2, center.x + 30, center.y),
  ]});
  await client.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [
    touch(1, center.x - 60, center.y), touch(2, center.x + 60, center.y),
  ]});
  await client.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  expect(await camera(page)).toEqual(before);
  const empty = await screenPoint(page, 400, 325);
  await client.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [touch(3, empty.x, empty.y)]});
  await client.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [touch(3, empty.x + 20, empty.y)]});
  await client.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  expect(await camera(page)).toEqual(before);

  const bounds = (await stage.boundingBox())!;
  const midpoint = {x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2};
  await client.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [
    touch(4, midpoint.x - 60, midpoint.y), touch(5, midpoint.x + 60, midpoint.y),
  ]});
  await client.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [
    touch(4, midpoint.x - 30, midpoint.y), touch(5, midpoint.x + 30, midpoint.y),
  ]});
  await client.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  expect(await camera(page)).toEqual(before);
  expect(await page.evaluate(() => state.match.move_count)).toBe(configuredCount);

  // Gesture-end synthetic clicks are deliberately suppressed briefly. Once
  // that guard expires, each local player rolls their own opening die. Ties
  // reroll through the same real authority; no test result values are injected.
  await page.waitForTimeout(500);
  let count = configuredCount;
  for (let roll = 0; roll < 12 && await page.evaluate(() => state.match.state.opening); roll++) {
    const rollButton = host.locator('.declarative-piece.actionable[data-ui-id="roll"] > g[opacity]');
    await expect(rollButton).toBeVisible();
    await rollButton.click();count++;
    await expect.poll(() => page.evaluate(() => state.match.move_count)).toBe(count);
    await expect.poll(() => page.evaluate(() => frame.lastMessage?.move_count)).toBe(count);
  }
  expect(await page.evaluate(() => state.match.state.opening)).toBe(false);
  const checker = host.locator('.declarative-piece.actionable[data-actions="move"]').first();
  await expect(checker).toBeVisible();
  const from = (await checker.locator(':scope > g[opacity]').boundingBox())!;
  await client.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [
    touch(6, from.x + from.width / 2, from.y + from.height / 2),
  ]});
  const target = host.locator('.declarative-target[data-drop-state="allowed"]').first();
  await expect(target).toBeVisible();
  const to = (await target.boundingBox())!;
  await client.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [
    touch(6, to.x + to.width / 2, to.y + to.height / 2),
  ]});
  await client.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await expect.poll(() => page.evaluate(() => state.match.move_count)).toBe(count + 1);
  expect(await camera(page)).toEqual(before);
  await expect(host.locator('.declarative-error:visible')).toHaveCount(0);

  await page.locator('#match-menu-toggle').click();
  await expect(page.locator('.match-toolbar')).toBeVisible();
  await page.locator('#match-back').click();
  await expect(page.locator('body')).not.toHaveClass(/match-immersive/);
  await expect(page.locator('#match')).toBeHidden();
  await expect(page.locator('#practice')).toBeVisible();
});
