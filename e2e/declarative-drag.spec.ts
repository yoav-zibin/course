import fs from 'node:fs';
import path from 'node:path';
import {expect, test, type Locator, type Page} from '@playwright/test';

type Point = {x: number, y: number};

async function center(art: Locator): Promise<Point> {
  const box = (await art.boundingBox())!;
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

async function mountBackgammon(page: Page) {
  const game = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../games/declarative/backgammon.json'), 'utf8'));
  const vectors = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tests/fixtures/declarative/backgammon-combined-cases.json'), 'utf8'));
  const vector = vectors.find((item: any) => item.name === 'Combined four ones');
  const seat = vector.ctx.players.findIndex((player: any) => player.id === vector.player_id);
  await page.goto('/static/declarative-test.html');
  await page.evaluate(async ({spec, vector, seat}) => {
    const w = window as any, box = document.createElement('div');
    box.id = 'drag-board';
    box.style.cssText = 'position:fixed;inset:24px;width:auto;height:auto;z-index:9999;background:#102330';
    document.body.append(box);
    w.dragCommands = [];
    box.addEventListener('pointerdown', event => { w.dragPointerId = event.pointerId; });
    w.dragHost = w.DeclarativeUI.mount(box, spec, {immersive: true,
      onMove: (move: any) => w.dragCommands.push(move), onScene: (scene: any) => { w.dragScene = scene; }});
    await w.dragHost.send({type: 'state_changed', view: vector.view_of_mover, state: vector.view_of_mover,
      status: 'ongoing', move_count: vector.ctx.move_count, my_player_index: seat, acting_for_player_index: seat,
      turn_of_player_indices: [seat], players: vector.ctx.players.map((player: any, index: number) =>
        ({player_index: index, name: player.display_name, kind: player.kind}))});
  }, {spec: game.declarative_ui, vector, seat});
  const id = await page.evaluate(() => (window as any).dragScene.pieces.find((piece: any) =>
    piece.move_targets?.includes('to_5')).id);
  const host = page.locator('#drag-board');
  const checker = host.locator(`.declarative-piece[data-ui-id="${id}"]`);
  await expect(checker).toBeVisible();
  return {host, checker, art: checker.locator('.declarative-piece-art'), stage: host.locator('.declarative-stage')};
}

async function pointer(page: Page, touch: boolean) {
  const client = touch ? await page.context().newCDPSession(page) : null;
  if (client) await client.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5});
  return async (type: 'down' | 'move' | 'up' | 'cancel', point: Point) => {
    if (client) {
      await client.send('Input.dispatchTouchEvent', {
        type: {down: 'touchStart', move: 'touchMove', up: 'touchEnd', cancel: 'touchCancel'}[type],
        touchPoints: type === 'up' || type === 'cancel' ? [] : [{id: 1, ...point, radiusX: 1, radiusY: 1, force: 1}],
      });
    } else if (type === 'down') {
      await page.mouse.move(point.x, point.y); await page.mouse.down();
    } else if (type === 'move') await page.mouse.move(point.x, point.y);
    else if (type === 'up') await page.mouse.up();
    else {
      await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', {
        pointerId: (window as any).dragPointerId, pointerType: 'mouse', bubbles: true,
      })));
      await page.mouse.up();
    }
  };
}

test('Backgammon highlights destinations immediately and keeps a held touch checker above and inward from either edge', async ({page}, testInfo) => {
  const {host, checker, art, stage} = await mountBackgammon(page);
  const touch = testInfo.project.name === 'mobile', send = await pointer(page, touch);
  const start = await center(art), camera = await stage.getAttribute('viewBox');
  const bounds = (await stage.boundingBox())!;
  await send('down', start);
  await expect(stage).toHaveClass(/show-drop-hints/);
  await expect(host.locator('.declarative-target[data-drop-state="allowed"]')).toHaveCount(4);
  for (const target of await host.locator('.declarative-target[data-drop-state="allowed"]').all())
    await expect(target.locator('.declarative-target-area')).toHaveCSS('opacity', '1');
  // No eligible destination occupies the upper part of this generated board.
  // These positions exercise free movement without engaging target snapping.
  for (const edge of ['left', 'right']) {
    const finger = {x: edge === 'left' ? bounds.x + 24 : bounds.x + bounds.width - 24,
      y: bounds.y + bounds.height * .3};
    await send('move', finger);
    await expect(checker).toHaveClass(/dragging/);
    await expect(host.locator('.declarative-target.snapped')).toHaveCount(0);
    const held = await center(art);
    if (touch) {
      expect(held.y).toBeLessThan(finger.y - 35);
      if (edge === 'left') expect(held.x).toBeGreaterThan(finger.x + 10);
      else expect(held.x).toBeLessThan(finger.x - 10);
      const visible = (await art.boundingBox())!;
      expect(visible.x).toBeGreaterThanOrEqual(bounds.x - 1);
      expect(visible.x + visible.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    } else expect(Math.hypot(held.x - finger.x, held.y - finger.y)).toBeLessThan(3);
  }
  expect(await stage.getAttribute('viewBox')).toBe(camera);
  expect(await page.evaluate(() => (window as any).dragCommands)).toEqual([]);
  await testInfo.attach('backgammon-held-checker', {body: await host.screenshot(), contentType: 'image/png'});
  await send('cancel', start);
  await expect(checker).not.toHaveClass(/dragging/);
  await expect(stage).not.toHaveClass(/show-drop-hints/);
  const restored = await center(art);
  expect(restored.x).toBeCloseTo(start.x, 0); expect(restored.y).toBeCloseTo(start.y, 0);
  expect(await page.evaluate(() => (window as any).dragCommands)).toEqual([]);
});

test('Backgammon snaps a nearby drag to its highlighted target and submits that destination on release', async ({page}, testInfo) => {
  const {host, checker, art} = await mountBackgammon(page);
  const send = await pointer(page, testInfo.project.name === 'mobile');
  const target = host.locator('.declarative-target[data-ui-id="to_8"]');
  const hit = (await target.locator('.declarative-target-hit').boundingBox())!;
  const marker = await target.evaluate(node => {
    const point = new DOMPoint(0, 0).matrixTransform((node as SVGGraphicsElement).getScreenCTM()!);
    return {x: point.x, y: point.y};
  });
  const finger = {x: hit.x - 10, y: marker.y + 48};
  await send('down', await center(art));
  await send('move', finger);
  await expect(checker).toHaveClass(/dragging/);
  await expect(target).toHaveClass(/snapped/);
  await expect(target).toHaveAttribute('data-drop-state', 'allowed');
  const held = await center(art);
  expect(Math.hypot(held.x - marker.x, held.y - marker.y)).toBeLessThan(3);
  expect(await page.evaluate(() => (window as any).dragCommands)).toEqual([]);
  await testInfo.attach('backgammon-snapped-target', {body: await host.screenshot(), contentType: 'image/png'});
  await send('up', finger);
  await expect.poll(() => page.evaluate(() => (window as any).dragCommands)).toEqual([{action: 'move', from: 9, to: 8}]);
  await expect(host.locator('.declarative-piece.dragging, .declarative-target.snapped')).toHaveCount(0);
  await expect(host.locator('.declarative-error:visible')).toHaveCount(0);
});

test('Backgammon rejects a release outside the stage and restores the checker after leaving a snapped destination', async ({page}, testInfo) => {
  const {host, checker, art, stage} = await mountBackgammon(page);
  const send = await pointer(page, testInfo.project.name === 'mobile');
  const start = await center(art), bounds = (await stage.boundingBox())!;
  const target = host.locator('.declarative-target[data-ui-id="to_5"]');
  const marker = await target.evaluate(node => {
    const point = new DOMPoint(0, 0).matrixTransform((node as SVGGraphicsElement).getScreenCTM()!);
    return {x: point.x, y: point.y};
  });
  await send('down', start); await send('move', marker);
  await expect(target).toHaveClass(/snapped/);
  const outside = {x: bounds.x - 10, y: bounds.y + bounds.height / 2};
  await send('move', outside);
  await expect(host.locator('.declarative-target.snapped')).toHaveCount(0);
  await send('up', outside);
  await expect(checker).not.toHaveClass(/dragging/);
  const restored = await center(art);
  expect(restored.x).toBeCloseTo(start.x, 0); expect(restored.y).toBeCloseTo(start.y, 0);
  expect(await page.evaluate(() => (window as any).dragCommands)).toEqual([]);
});

test('Backgammon aims with the lifted checker when the finger overlaps an adjacent legal point', async ({page}) => {
  const {host, checker, art} = await mountBackgammon(page);
  // Exercise a native touch gesture on both viewport sizes. Point 8 is the
  // leftmost legal target, so the inward lift carries the checker to point 7.
  const send = await pointer(page, true);
  const underFinger = host.locator('.declarative-target[data-ui-id="to_8"]');
  const destination = host.locator('.declarative-target[data-ui-id="to_7"]');
  const hit = (await underFinger.locator('.declarative-target-hit').boundingBox())!;
  const finger = {x: hit.x + hit.width - 2, y: hit.y + hit.height * .75};
  await send('down', await center(art));
  await expect(underFinger).toHaveAttribute('data-drop-state', 'allowed');
  await expect(destination).toHaveAttribute('data-drop-state', 'allowed');
  await send('move', finger);
  await expect(checker).toHaveClass(/dragging/);
  await expect(destination).toHaveClass(/snapped/);
  await expect(underFinger).not.toHaveClass(/snapped/);
  const marker = await destination.evaluate(node => {
    const point = new DOMPoint(0, 0).matrixTransform((node as SVGGraphicsElement).getScreenCTM()!);
    return {x: point.x, y: point.y};
  });
  const held = await center(art);
  expect(Math.hypot(held.x - marker.x, held.y - marker.y)).toBeLessThan(3);
  await send('up', finger);
  await expect.poll(() => page.evaluate(() => (window as any).dragCommands)).toEqual([{action: 'move', from: 9, to: 7}]);
});
