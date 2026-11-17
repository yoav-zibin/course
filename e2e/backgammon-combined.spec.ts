import fs from 'node:fs';
import path from 'node:path';
import {expect, test, type Page} from '@playwright/test';

// These portable vectors are generated and checked against the authoritative
// QuickJS rules. The browser must emit the exact accepted command, including
// when one gesture consumes several dice, without accepting a client path.
const packageData = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../games/declarative/backgammon.json'), 'utf8'));

async function mountVector(page: Page, name: string, legacy = false) {
  const game = packageData();
  const vectors = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tests/fixtures/declarative/backgammon-combined-cases.json'), 'utf8'));
  const vector = vectors.find((item: any) => item.name === name);
  expect(vector, `authoritative generated vector ${name}`).toBeTruthy();
  const seat = vector.ctx.players.findIndex((player: any) => player.id === vector.player_id);
  await page.goto('/static/declarative-test.html');
  await page.evaluate(async ({spec, vector, seat, legacy}) => {
    const w = window as any, box = document.createElement('div');
    box.id = 'combined-board'; box.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#102330';
    document.body.append(box);
    const view = structuredClone(vector.view_of_mover);
    if (legacy) {
      for(const key of ['last_roll','combinedMoves','configured','opening','opening_roll','can_undo','cube','can_double',
        'difficulty','goal','scores','round_winner','cube_enabled']) delete view[key];
    }
    w.combinedCommands = [];
    w.combinedMessage = {type: 'state_changed', view, state: view, status: 'ongoing',
      move_count: vector.ctx.move_count, my_player_index: seat, acting_for_player_index: seat,
      turn_of_player_indices: [seat], players: vector.ctx.players.map((player: any, index: number) =>
        ({player_index: index, name: player.display_name, kind: player.kind}))};
    w.combinedHost = w.DeclarativeUI.mount(box, spec, {immersive: true,
      onMove: (move: any) => w.combinedCommands.push(move), onScene: (scene: any) => { w.combinedScene = scene; }});
    await w.combinedHost.send(w.combinedMessage);
  }, {spec: game.declarative_ui, vector, seat, legacy});
  return {vector, seat};
}

async function acceptVector(page: Page, vector: any, seat: number) {
  await page.evaluate(async ({vector, seat}) => {
    const w = window as any;
    const turn = vector.expected_turn === null ? null : vector.expected_turn.map((id: string) =>
      vector.ctx.players.findIndex((player: any) => player.id === id));
    await w.combinedHost.send({...w.combinedMessage, view: vector.expected_view_of_mover,
      state: vector.expected_view_of_mover, move_count: vector.ctx.move_count + 1,
      status: turn === null ? 'over' : 'ongoing', turn_of_player_indices: turn,
      acting_for_player_index: turn?.includes(seat) ? seat : null, last_move_player_index: seat});
  }, {vector, seat});
}

async function offeredChecker(page: Page, destination: number | string) {
  const id = await page.evaluate(destination => (window as any).combinedScene.pieces.find((piece: any) =>
    piece.actions?.includes('move') && piece.move_targets?.includes(`to_${destination}`))?.id, destination);
  expect(id, `a movable checker offers destination ${destination}`).toBeTruthy();
  return page.locator(`#combined-board .declarative-piece[data-ui-id="${id}"]`);
}

async function expectCommand(page: Page, vector: any) {
  await expect.poll(() => page.evaluate(() => (window as any).combinedCommands)).toEqual([vector.move]);
}

for (const name of ['Combined one and four', 'Forced combined hit']) {
  test(`${name} accepts a destination click as one authoritative move`, async ({page}) => {
    const {vector, seat} = await mountVector(page, name);
    const checker = await offeredChecker(page, vector.move.to);
    await checker.locator('g[opacity]').first().click();
    const target = page.locator(`#combined-board .declarative-target[data-ui-id="to_${vector.move.to}"]`);
    await expect(target).toHaveAttribute('data-drop-state', 'allowed');
    await target.click();
    await expectCommand(page, vector);
    await acceptVector(page, vector, seat);
    const assets = await page.evaluate(() => (window as any).combinedScene.pieces.filter((piece: any) => piece.type === 'die').map((piece: any) => piece.asset));
    expect(assets).toEqual(vector.state.moves.map((value: number) => `die_${value}_used_2`));
    await expect(page.locator('#combined-board .declarative-error:visible')).toHaveCount(0);
  });
}

test('four ones offer two, three and four steps and a native drag spends all four', async ({page}, testInfo) => {
  const {vector, seat} = await mountVector(page, 'Combined four ones');
  const checker = await offeredChecker(page, vector.move.to);
  const offered = await page.evaluate(id => (window as any).combinedScene.pieces.find((piece: any) => piece.id === id).move_targets,
    await checker.getAttribute('data-ui-id'));
  const direction = seat === 0 ? -1 : 1;
  for (let used = 1; used <= 4; used++) expect(offered).toContain(`to_${vector.move.from + direction * used}`);
  await checker.locator('g[opacity]').first().click();
  const target = page.locator(`#combined-board .declarative-target[data-ui-id="to_${vector.move.to}"]`);
  const from = (await checker.locator('g[opacity]').first().boundingBox())!;
  const to = (await target.boundingBox())!;
  const start = {x: from.x + from.width / 2, y: from.y + from.height / 2};
  const end = {x: to.x + to.width / 2, y: to.y + to.height / 2};
  const halfway = {x: (start.x + end.x) / 2, y: (start.y + end.y) / 2};
  if (testInfo.project.name === 'mobile') {
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5});
    const finger = (point: {x: number, y: number}) => ({id: 1, ...point, radiusX: 1, radiusY: 1, force: 1});
    await client.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [finger(start)]});
    await client.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [finger(halfway)]});
    await expect(checker).toHaveClass(/dragging/);
    await client.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [finger(end)]});
    await client.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  } else {
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(halfway.x, halfway.y);
    await expect(checker).toHaveClass(/dragging/);
    await page.mouse.move(end.x, end.y); await page.mouse.up();
  }
  await expectCommand(page, vector);
  await acceptVector(page, vector, seat);
  expect(await page.evaluate(() => (window as any).combinedScene.pieces.filter((piece: any) => piece.type === 'die').map((piece: any) => piece.asset)))
    .toEqual(Array(4).fill('die_1_used_2'));
  await expect(page.locator('#combined-board .declarative-piece.dragging')).toHaveCount(0);
});

test('different intermediate hits suppress the summed destination while preserving single moves', async ({page}) => {
  const {vector, seat} = await mountVector(page, 'Ambiguous combined hit stays single');
  const destination = vector.move.from + (seat === 0 ? -1 : 1) * vector.state.moves.reduce((sum: number, value: number) => sum + value, 0);
  const combined = vector.view_of_mover.combinedMoves || [];
  expect(combined.some((move: any) => move.from === vector.move.from && move.to === destination)).toBe(false);
  await expect(page.locator(`#combined-board [data-ui-id="to_${destination}"]`)).toHaveCount(0);
  const checker = await offeredChecker(page, vector.move.to);
  await checker.locator('g[opacity]').first().click();
  await page.locator(`#combined-board [data-ui-id="to_${vector.move.to}"]`).click();
  await expectCommand(page, vector);
});

test('a pinned view without combined-move metadata offers only its canonical single moves', async ({page}) => {
  const {vector} = await mountVector(page, 'Combined one and four', true);
  const view = await page.evaluate(() => (window as any).combinedMessage.view);
  expect(view).not.toHaveProperty('combinedMoves'); expect(view).not.toHaveProperty('last_roll');
  const targets = await page.locator('#combined-board .declarative-target').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-ui-id')));
  expect(targets.sort()).toEqual([...new Set(vector.view_of_mover.legalMoves.map((move: any) => `to_${move.to}`))].sort());
  expect(targets).not.toContain(`to_${vector.move.to}`);
});

test('a blank board click cancels checker selection while the fitted camera stays fixed',async({page})=>{
  const {vector}=await mountVector(page,'Combined one and four');
  const checker=await offeredChecker(page,vector.move.to);
  const stage=page.locator('#combined-board .declarative-stage');
  const camera=await stage.getAttribute('viewBox');
  await checker.locator('g[opacity]').first().click();
  await expect(stage).toHaveClass(/show-drop-hints/);
  const blank=await stage.evaluate(node=>{
    const point=new DOMPoint(356,325).matrixTransform((node as SVGSVGElement).getScreenCTM()!);
    return {x:point.x,y:point.y};
  });
  await page.mouse.click(blank.x,blank.y);
  await expect(stage).not.toHaveClass(/show-drop-hints/);
  expect(await stage.getAttribute('viewBox')).toBe(camera);
  expect(await page.evaluate(()=>(window as any).combinedCommands)).toEqual([]);
  await checker.locator('g[opacity]').first().click();
  await page.locator(`#combined-board .declarative-target[data-ui-id="to_${vector.move.to}"]`).click();
  await expectCommand(page,vector);
});
