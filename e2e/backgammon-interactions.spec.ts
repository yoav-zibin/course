import fs from 'node:fs';
import path from 'node:path';
import {expect, test, type APIRequestContext, type Page} from '@playwright/test';
import {createUser, loginAs, uniqueName} from './helpers';
import {backgammonAction,clickBackgammonTarget,ordinaryBackgammonView,spentDice} from './backgammon-helpers';

declare const state: any;
declare const frame: any;
declare function pollActiveMatch(): Promise<void>;

const packageFile = path.resolve(__dirname, '../games/declarative/backgammon.json');
const payload = () => JSON.parse(fs.readFileSync(packageFile, 'utf8'));
const auth = (user: any) => ({'X-User-Id': user.id, 'X-User-Password': user.password});

async function backgammon(request: APIRequestContext) {
  const games = await (await request.get('/games')).json();
  const known = (Array.isArray(games) ? games : games.items || [])
    .find((game: any) => game.name === 'Backgammon (Declarative)');
  if (known) return known;
  const data = payload();
  data.game_addition_request_id_and_secret = uniqueName('backgammon-interactions');
  let response = await request.post('/games/declarative', {data, timeout: 210000});
  for (let attempt = 0; response.status() === 429 && attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    response = await request.post('/games/declarative', {data, timeout: 210000});
  }
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function observeRolls(page: Page) {
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    (window as any).rollAnimations = [];
    Element.prototype.animate = function (...args: any[]) {
      if (this.classList.contains('declarative-roll') || this.classList.contains('declarative-roll-artwork'))
        (window as any).rollAnimations.push({id: this.closest('[data-ui-id]')?.getAttribute('data-ui-id'),
          duration: typeof args[1] === 'number' ? args[1] : args[1]?.duration});
      return original.apply(this, args as any);
    };
  });
}

async function diceFaces(page: Page) {
  const spec = payload().declarative_ui;
  const assets = Object.fromEntries(Object.entries(spec.assets).map(([key, asset]: [string, any]) => [asset.uri, key]));
  return page.locator('#game-box .declarative-piece[data-ui-id^="die_"] image')
    .evaluateAll((images, assets) => images.map(image => assets[image.getAttribute('href')!]), assets);
}

async function playNext(page: Page, matchId: string) {
  const response = page.waitForResponse(response => response.request().method() === 'POST' &&
    new URL(response.url()).pathname === `/matches/${matchId}/moves`);
  await backgammonAction(page);
  const accepted = await response;
  expect(accepted.ok(), await accepted.text()).toBeTruthy();
  return accepted.json();
}

test('a complete computer turn between polls keeps its rolled faces, ready highlight and reload recovery', async ({page, request}, testInfo) => {
  test.setTimeout(120000);
  const game = await backgammon(request), user = await createUser(request, uniqueName('Computer dice observer'));
  const created = await request.post('/matches', {headers: auth(user), data: {game_id: game.id, num_computer_opponents: 1}});
  expect(created.ok(), await created.text()).toBeTruthy();
  const match = await created.json();
  expect((await request.post(`/matches/${match.id}/start`, {headers: auth(user), data: {first_turn_player_indices: [0]}})).ok()).toBeTruthy();
  await observeRolls(page); await loginAs(page, user);
  await page.goto(`/static/portal.html#match=${match.id}`);
  const dice = page.locator('#game-box .declarative-piece[data-ui-id^="die_"]');
  await playNext(page,match.id); // Goal-one setup through the real UI.
  for(let attempt=0;attempt<15;attempt++) {
    await expect.poll(()=>page.evaluate(()=>state.match.turn_of_player_indices?.[0]===0),{timeout:30000}).toBe(true);
    if(await page.evaluate(()=>!state.match.state.opening))break;
    const accepted=await playNext(page,match.id); // Each tied opening asks both sides to roll again.
    await expect.poll(()=>page.evaluate(count=>state.match.move_count>count,accepted.move_count),{timeout:30000}).toBe(true);
  }
  expect(await page.evaluate(()=>state.match.state.opening)).toBe(false);
  await expect(page.locator('#game-box .declarative-piece.actionable[data-ui-id="roll"], #game-box .declarative-piece.actionable[data-actions="move"]')).not.toHaveCount(0,{timeout:30000});

  // Keep all browser polls pending. The real authority and its computer worker
  // still run; this observer receives only the completed computer turn later.
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let heldPollStarted!: () => void;
  const heldPoll = new Promise<void>(resolve => { heldPollStarted = resolve; });
  await page.route(`**/matches/${match.id}`, async route => {
    if (route.request().method() === 'GET') { heldPollStarted(); await held; }
    await route.continue().catch(() => {});
  });
  let current: any;
  try {
    await page.evaluate(() => { void pollActiveMatch(); });
    await heldPoll;
    for (let move = 0; move < 6; move++) {
      current = await playNext(page, match.id);
      if (current.turn_of_player_indices?.[0] !== 0) break;
    }
    expect(current.turn_of_player_indices).toEqual([1]);
    const ownCount = current.move_count;
    const beforeComputerAnimations = await page.evaluate(() => (window as any).rollAnimations.length);
    await expect.poll(async () => {
      current = await (await request.get(`/matches/${match.id}`, {headers: auth(user)})).json();
      return current.move_count > ownCount && current.turn_of_player_indices?.[0] === 0 && current.state.needRoll;
    }, {timeout: 30000}).toBe(true);
    const history = await (await request.get(`/matches/${match.id}/moves`, {headers: auth(user)})).json();
    const roll = history.find((move: any) => move.move_number > ownCount && move.player_index === 1 &&
      (move.new_state.last_roll?.seat === 1 || !move.new_state.needRoll && move.new_state.moves.length >= 2));
    expect(roll, 'the real filtered history contains the computer roll').toBeTruthy();
    const values = roll.new_state.last_roll?.values || roll.new_state.moves.slice(0, 2);
    release();
    await expect.poll(() => page.evaluate(() => state.match.move_count),{timeout:30000}).toBe(current.move_count);
    // Consecutive identical rolls can already match the old dice artwork.
    // Wait for the accepted timeline to reach its final rendered state and
    // finish physical playback before asserting that the next player can act.
    await expect.poll(() => page.evaluate(() => frame.lastMessage?.move_count),{timeout:30000}).toBe(current.move_count);
    await page.evaluate(() => frame.declarative.whenIdle());
    await expect.poll(() => diceFaces(page), {timeout: 30000}).toEqual(spentDice(values));
    await expect(page.locator('#game-box .declarative-piece.actionable[data-ui-id^="die_"]')).toHaveCount(spentDice(values).length);
    await expect.poll(() => page.evaluate(() => (window as any).rollAnimations.length),{timeout:30000}).toBeGreaterThan(beforeComputerAnimations);
    const animationCount = await page.evaluate(() => (window as any).rollAnimations.length);
    await page.evaluate(async () => { await pollActiveMatch(); await pollActiveMatch(); });
    expect(await page.evaluate(() => (window as any).rollAnimations.length)).toBe(animationCount);
    await testInfo.attach('computer-dice-ready', {body: await page.screenshot(), contentType: 'image/png'});
    await page.reload();
    await expect.poll(() => diceFaces(page), {timeout: 30000}).toEqual(spentDice(values));
    await expect(page.locator('#game-box .declarative-piece.actionable[data-ui-id^="die_"]')).toHaveCount(spentDice(values).length);
    const pinned = await (await request.get(`/games/${game.id}/versions/${match.game_version}`)).json();
    expect(pinned.version).toBe(match.game_version);
    expect(pinned.server_code).toBe(payload().server_code);
  } finally { release(); }
});

test('native checker dragging follows the pointer, invalid drops revert, and tap selection remains usable', async ({page, request}, testInfo) => {
  test.setTimeout(120000);
  const game = await backgammon(request), user = await createUser(request, uniqueName('Checker drag player'));
  await loginAs(page, user); await page.goto(`/static/portal.html#game=${game.id}`);
  await page.locator('#practice').click();
  const host = page.locator('#game-box'), stage = host.locator('.declarative-stage');
  await expect(stage).toBeVisible();
  // Complete setup and each human opening roll on the shared device.
  for(let step=0;step<15;step++) {
    const view=await page.evaluate(()=>state.match.state);
    if(view.configured&&!view.opening)break;
    const before=await page.evaluate(()=>state.match.move_count);
    await backgammonAction(page);
    await expect.poll(()=>page.evaluate(()=>state.match.move_count),{timeout:30000}).toBeGreaterThan(before);
  }
  const initialCount=await page.evaluate(()=>state.match.move_count);
  let checker = host.locator('.declarative-piece.actionable[data-actions="move"]').first();
  await expect(checker).toBeVisible({timeout:30000});
  checker = host.locator(`.declarative-piece[data-ui-id="${await checker.getAttribute('data-ui-id')}"]`);
  await checker.locator('g[opacity]').first().click();
  const target = host.locator('.declarative-target[data-drop-state="allowed"]').first();
  const from = (await checker.locator('g[opacity]').first().boundingBox())!, to = (await target.boundingBox())!;
  const start = {x: from.x + from.width / 2, y: from.y + from.height / 2};
  const end = {x: to.x + to.width / 2, y: to.y + to.height / 2};
  const middle = {x: start.x + (end.x - start.x) * .55, y: start.y + (end.y - start.y) * .55};
  const touch = testInfo.project.name === 'mobile' ? await page.context().newCDPSession(page) : null;
  if (touch) await touch.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5});
  const pointer = async (type: 'down' | 'move' | 'up', point: {x: number, y: number}) => {
    if (touch) await touch.send('Input.dispatchTouchEvent', {type: {down: 'touchStart', move: 'touchMove', up: 'touchEnd'}[type],
      touchPoints: type === 'up' ? [] : [{id: 1, ...point, radiusX: 1, radiusY: 1, force: 1}]});
    else if (type === 'down') { await page.mouse.move(point.x, point.y); await page.mouse.down(); }
    else if (type === 'move') await page.mouse.move(point.x, point.y, {steps: 4});
    else await page.mouse.up();
  };
  const camera = await stage.getAttribute('viewBox');
  await pointer('down', start); await pointer('move', middle);
  await expect(checker).toHaveClass(/dragging/);
  await expect.poll(async () => {
    const bounds = (await checker.locator('g[opacity]').first().boundingBox())!;
    return Math.hypot(bounds.x + bounds.width / 2 - middle.x, bounds.y + bounds.height / 2 - middle.y);
  }).toBeLessThan(3);
  expect(await stage.getAttribute('viewBox')).toBe(camera);
  expect(await page.evaluate(() => state.match.move_count)).toBe(initialCount);
  await pointer('move', end); await pointer('up', end);
  await expect.poll(() => page.evaluate(() => state.match.move_count),{timeout:30000}).toBe(initialCount+1);
  await expect(host.locator('.declarative-piece.dragging')).toHaveCount(0);

  // Continue on the next offered checker. An ordinary tap is still sufficient
  // for selecting a piece and a destination; dragging is optional.
  await expect.poll(async()=>await host.locator('.declarative-piece.actionable[data-actions="move"]').count()+
    await host.locator('.declarative-piece.actionable[data-ui-id="roll"]').count()).toBeGreaterThan(0);
  if(await host.locator('.declarative-piece.actionable[data-ui-id="roll"]').count()) {
    const count=await page.evaluate(()=>state.match.move_count);
    await backgammonAction(page);await expect.poll(()=>page.evaluate(()=>state.match.move_count),{timeout:30000}).toBeGreaterThan(count);
  }
  const nextCount=await page.evaluate(()=>state.match.move_count);
  let next = host.locator('.declarative-piece.actionable[data-actions="move"]').first();
  await expect(next).toBeVisible({timeout:30000});
  next = host.locator(`.declarative-piece[data-ui-id="${await next.getAttribute('data-ui-id')}"]`);
  const nextBody = next.locator('g[opacity]').first();
  const saved = (await nextBody.boundingBox())!, source = {x: saved.x + saved.width / 2, y: saved.y + saved.height / 2};
  await pointer('down', source); await pointer('move', {x: 5, y: 5}); await pointer('up', {x: 5, y: 5});
  await expect(host.locator('.declarative-piece.dragging')).toHaveCount(0);
  expect(await page.evaluate(() => state.match.move_count)).toBe(nextCount);
  const restored = (await nextBody.boundingBox())!;
  expect(restored.x).toBeCloseTo(saved.x, 0); expect(restored.y).toBeCloseTo(saved.y, 0);
  const nextTarget = host.locator('.declarative-target[data-drop-state="allowed"]').first();
  if (touch) await nextBody.tap();else await nextBody.click();
  await clickBackgammonTarget(nextTarget,Boolean(touch));
  await expect.poll(() => page.evaluate(() => state.match.move_count),{timeout:30000}).toBe(nextCount+1);
  await expect(host.locator('.declarative-error:visible')).toHaveCount(0);
});

for (const version of [1, 2]) test(`pinned Backgammon v${version} recovers spent dice from bounded public observations after remount`, async ({page}) => {
  const original = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../tests/fixtures/declarative/backgammon-v${version}-ui.json`), 'utf8'));
  const rules = fs.readFileSync(path.resolve(__dirname, '../games/declarative/backgammon.server.js'), 'utf8');
  const example = payload().unit_tests.cases[0];
  const rolled = {...ordinaryBackgammonView(example.view_of_mover),cur:0,n:0,needRoll:false,dice:[2,5],moves:[2,5]};
  const values = rolled.moves.slice(), count = 3;
  const ready = {...rolled, cur: 1, n: 1, needRoll: true, dice: [], moves: []};
  await page.goto('/static/declarative-test.html');
  await page.addScriptTag({url: '/static/declarative-presentation.js'});
  const result = await page.evaluate(async ({original, rules, rolled, ready, count, version}) => {
    const w = window as any, game = {id: '5f5293c3-2a3a-4eec-b631-9debf59be0ca', version, server_code: rules, declarative_ui: original};
    const before = JSON.stringify(game), spec = await w.DeclarativePresentation.forGame(game);
    const box = document.createElement('div'); box.id = 'pinned-dice'; document.body.append(box);
    const message = {type: 'state_changed', status: 'ongoing', view: ready, state: ready, move_count: count,
      my_player_index: ready.cur, acting_for_player_index: ready.cur, turn_of_player_indices: [ready.cur],
      presentation_history: [{view: rolled, move_count: 1, last_move_player_index: rolled.cur}], players: []};
    const mount = () => w.DeclarativeUI.mount(box, spec, {onScene: (scene: any) => { w.pinnedDice = scene.pieces.filter((piece: any) => piece.type === 'die').map((piece: any) => piece.asset); }});
    const first = mount(); await first.send(message); first.destroy();
    const second = mount(); await second.send(message);
    w.pinnedHost = second; w.pinnedMessage = message;
    return {unchanged: JSON.stringify(game) === before, assets: w.pinnedDice};
  }, {original, rules, rolled, ready, count, version});
  expect(result.unchanged).toBe(true);
  expect(result.assets).toEqual(spentDice(values));
  await expect(page.locator('#pinned-dice .declarative-piece.actionable[data-ui-id^="die_"]')).toHaveCount(2);
  // A backward replay must not borrow the current pair from local memory or
  // observations that belong to a later move in this match.
  await page.evaluate(async () => {
    const w = window as any, before = {...w.pinnedMessage.view, n: 0, needRoll: true, dice: [], moves: []};
    await w.pinnedHost.send({...w.pinnedMessage, view: before, state: before, move_count: 0,
      replay: {index: 0, total: w.pinnedMessage.move_count}});
  });
  expect(await page.evaluate(() => (window as any).pinnedDice)).toEqual(['die_0_used_0', 'die_0_used_0']);
  await expect(page.locator('#pinned-dice .declarative-piece.actionable')).toHaveCount(0);
});
