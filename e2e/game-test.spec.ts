import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createUser, loginAs, TICTACTOE, TICTACTOE_SERVER } from './helpers';

test('matrix controls follow the selected language without losing entered code', async ({page}) => {
  await page.goto('/game-test');
  await page.locator('#client-code').fill('<p>draft</p>');
  await page.locator('#language-picker').selectOption('es');
  await expect(page.locator('main h1')).toHaveText('Matriz de pruebas de juegos');
  await expect(page.locator('#start')).toHaveText('Iniciar y grabar la matriz');
  await expect(page.locator('#client-code')).toHaveValue('<p>draft</p>');
  await page.locator('#language-picker').selectOption('en');
  await expect(page.locator('main h1')).toHaveText('Game test matrix');
});

test('sticky replay controls follow, pause, filter, and reopen saved events', async ({page, request}) => {
  const owner = await createUser(request, 'Replay controls tester');
  const headers = {'X-User-Id':owner.id, 'X-User-Password':owner.password};
  const scenarios = ['0', '1'].map((id, i) => ({
    id, mode:'pass', device:i ? 'Phone' : 'Laptop', orientation:'portrait',
    width:320, height:568, players:[{kind:'human', name:'Player 1', max_loss:0}], seed:1,
  }));
  const reply = (n: number) => ({
    state:{n}, views:{'human-1':{n}},
    players:[{id:'human-1', kind:'human', name:'Player 1', max_loss:0}],
    turn:['human-1'], status:'ongoing', move_count:n, pot:0, payouts:null, error:null,
  });
  const client = `<!doctype html><html><body><p id="value">Waiting</p><script>
    addEventListener('message', e => { if(e.data.type === 'state_changed')
      document.getElementById('value').textContent = String(e.data.view.n); });
  </script></body></html>`;
  const payload = {client_code:client, server_code:'const game = {};', scenarios, events:[
    {type:'state', at:0, scenario:'0', reply:reply(0)},
    {type:'state', at:4000, scenario:'1', reply:reply(1)},
    {type:'state', at:8000, scenario:'0', reply:reply(2)},
  ]};
  const created = await request.post('/game-test-sessions', {headers, data:{revision:0, recording:payload}});
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).id;
  await loginAs(page, owner);
  await page.goto('/game-test');
  await expect(page.locator(`#recordings option[value="${id}"]`)).toHaveCount(1);
  await page.locator('#recordings').selectOption(id);
  await page.locator('#follow-replay').uncheck();
  await page.locator('#replay').click();
  await expect(page.locator('#replay-progress')).toContainText('event 1/3');
  await page.locator('#pause-replay').click();
  await expect(page.locator('#pause-replay')).toHaveText('Resume');
  await page.waitForTimeout(500);
  await expect(page.locator('#replay-progress')).toContainText('event 1/3');
  await page.locator('#scenario-filter').selectOption('1');
  await expect(page.locator('.scenario:visible')).toHaveCount(1);
  await expect(page.locator('.scenario:visible h2')).toContainText('Phone');
  await page.locator('#previous-scenario').click();
  await expect(page.locator('.scenario:visible h2')).toContainText('Laptop');
  await page.locator('#next-scenario').click();
  await page.locator('.scenario:visible').scrollIntoViewIfNeeded();
  expect(await page.locator('.replay-toolbar').evaluate(node => node.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
  expect(await page.locator('.replay-toolbar').evaluate(node => node.getBoundingClientRect().top)).toBeLessThan(5);
  await page.locator('#speed').selectOption('100');
  await page.locator('#pause-replay').click();
  await expect(page.locator('#status')).toHaveText('Replay complete.', {timeout:15_000});
  await expect(page.locator('.scenario:visible').frameLocator('iframe').locator('#value')).toHaveText('1');
  await page.locator('#replay-selected').check();
  await page.locator('#replay').click();
  await expect(page.locator('#status')).toHaveText('Replay complete.', {timeout:15_000});
  await expect(page.locator('#replay-progress')).toContainText('event 2/3');
  await expect(page.locator('.scenario:visible').frameLocator('iframe').locator('#value')).toHaveText('1');
  await page.reload();
  await expect(page.locator(`#recordings option[value="${id}"]`)).toHaveCount(1);
  await page.locator('#recordings').selectOption(id);
  await page.locator('#speed').selectOption('100');
  await page.locator('#replay').click();
  await expect(page.locator('#status')).toHaveText('Replay complete.', {timeout:15_000});
  await expect(page.locator('.scenario').first().frameLocator('iframe').locator('#value')).toHaveText('2');
  expect((await (await request.get(`/game-test-sessions/${id}`, {headers})).json()).recording).toEqual(payload);
});

test('a browser-operated move is saved and replayed after reload', async ({page, request}) => {
  test.setTimeout(120_000);
  const owner = await createUser(request, 'Browser test operator');
  await loginAs(page, owner);
  await page.goto('/game-test');
  await page.locator('#client-code').fill(TICTACTOE);
  await page.locator('#server-code').fill(TICTACTOE_SERVER);
  await page.locator('#start').click();
  await expect(page.locator('#random-play')).toBeEnabled({timeout:90_000});
  const id = await page.locator('#recordings').inputValue();
  expect(id).toBeTruthy();
  const card = page.locator('.scenario').nth(1);
  await card.frameLocator('iframe').locator('#board button:enabled').first().click();
  await expect(card.locator('p')).toContainText('1 moves');
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText(`Recording saved · ${id}`);
  const headers = {'X-User-Id':owner.id, 'X-User-Password':owner.password};
  const saved = await request.get(`/game-test-sessions/${id}`, {headers});
  const events = (await saved.json()).recording.events;
  expect(events.some((e: {type:string, scenario:string}) => e.type === 'click' && e.scenario === '1')).toBeTruthy();
  expect(events.some((e: {type:string, scenario:string, action:string}) =>
    e.type === 'state' && e.scenario === '1' && e.action === 'move')).toBeTruthy();
  await page.reload();
  await expect(page.locator(`#recordings option[value="${id}"]`)).toHaveCount(1);
  await page.locator('#recordings').selectOption(id);
  await page.locator('#speed').selectOption('100');
  await page.locator('#replay').click();
  await expect(page.locator('#status')).toHaveText('Replay complete.', {timeout:30_000});
  await expect(page.locator('.scenario').nth(1).frameLocator('iframe').locator('#board button').first()).toHaveText('X');
});

test('plays the original Take Away game across the three-seat matrix', async ({page, request}) => {
  test.setTimeout(300_000);
  const owner = await createUser(request, 'Take Away tester');
  await loginAs(page, owner);
  await page.goto('/game-test');
  await page.locator('#client-code').fill(fs.readFileSync(path.resolve(__dirname, '../games/take-away.html'), 'utf8'));
  await page.locator('#server-code').fill(fs.readFileSync(path.resolve(__dirname, '../games/take-away.server.js'), 'utf8'));
  await page.locator('#counts').fill('2,3');
  await page.locator('#count').fill('3');
  await page.locator('#start').click();
  await expect(page.locator('#random-play')).toBeEnabled({timeout:120_000});
  await expect(page.locator('.scenario')).toHaveCount(40);
  await expect(page.locator('.scenario iframe')).toHaveCount(70);
  await expect(page.locator('.scenario h2').filter({hasText:'Mixed simulation'})).toHaveCount(10);
  await page.locator('#random-play').click();
  await expect(page.locator('#random-status')).toContainText('120 matches finished and recorded', {timeout:240_000});
  const headers = {'X-User-Id':owner.id, 'X-User-Password':owner.password};
  const list = await request.get('/game-test-sessions', {headers});
  const id = (await list.json()).items[0].id;
  const response = await request.get(`/game-test-sessions/${id}`, {headers});
  const recording = (await response.json()).recording;
  const finished = recording.events.filter((event: {type:string}) => event.type === 'random_match');
  expect(finished).toHaveLength(120);
  expect(new Set(finished.map((event: {scenario:string}) => event.scenario)).size).toBe(40);
  const clicks = recording.events.filter((event: {type:string}) => event.type === 'click');
  expect(clicks.length).toBeGreaterThan(120);
  for (const click of clicks) {
    expect(click.metrics.width).toBeGreaterThanOrEqual(30);
    expect(click.metrics.height).toBeGreaterThanOrEqual(30);
    expect(click.metrics.contrast).toBeGreaterThanOrEqual(click.metrics.minimumContrast);
  }
  const states = recording.events.filter((event: {type:string}) => event.type === 'state');
  expect(states.filter((event: {reply:{status:string}}) => event.reply.status === 'over')).toHaveLength(120);
  expect(recording.events.every((event: {at:number}) => Number.isFinite(event.at))).toBeTruthy();
  await page.locator('#recordings').selectOption(id);
  await page.locator('#replay').click();
  await expect(page.locator('#status')).toContainText('Replaying');
});

test('loads a guided Builder draft only when requested', async ({ page, request }) => {
  const owner = await createUser(request, 'Draft tester');
  const other = await createUser(request, 'Other tester');
  const response = await request.post('/game-drafts', {
    headers: {'X-User-Id': owner.id, 'X-User-Password': owner.password},
    data: {code: TICTACTOE, server_code: TICTACTOE_SERVER, allowed_player_counts: [2, 3]},
  });
  expect(response.ok()).toBeTruthy();
  const draft = await response.json();
  const forbidden = await request.get(`/game-drafts/${draft.id}`, {
    headers: {'X-User-Id': other.id, 'X-User-Password': other.password},
  });
  expect(forbidden.ok()).toBeFalsy();
  await loginAs(page, owner);
  await page.goto(`/game-test?draft=${draft.id}`);
  await expect(page.locator('#client-code')).toHaveValue('');
  await page.getByRole('button', {name:'Load the selected Builder draft'}).click();
  await expect(page.locator('#client-code')).toHaveValue(TICTACTOE);
  await expect(page.locator('#server-code')).toHaveValue(TICTACTOE_SERVER);
  await expect(page.locator('#counts')).toHaveValue('2,3');
  await expect(page.locator('#count')).toHaveValue('2');
});

test('random play completes and records three matches in every solo scenario', async ({ page, request }) => {
  test.setTimeout(180_000);
  const owner = await createUser(request, 'Random tester');
  await loginAs(page, owner);
  await page.goto('/game-test');
  await page.locator('#client-code').fill(`<!doctype html><html><head></head><body style="background:white">
    <button id="move" style="width:60px;height:60px;background:white;color:black">Move</button>
    <script>
      const button = document.getElementById('move');
      window.addEventListener('message', e => {
        if (e.source === parent && e.data.type === 'state_changed')
          button.disabled = e.data.acting_for_player_index === null;
      });
      button.onclick = () => parent.postMessage({type:'make_move', move:{add:1}}, '*');
    </script></body></html>`);
  await page.locator('#server-code').fill(`const game = {
    newMatch(ctx) { return {state:{n:0}, turn:[ctx.players[0].id]}; },
    applyMove(state, id, move, ctx) {
      if (!move || move.add !== 1) throw new InvalidMove('add must be 1');
      return {state:{n:1}, turn:null, payouts:{[id]:ctx.pot}};
    },
    randomMove() { return {add:1}; },
    computerMove() { return {add:1}; },
    viewFor(state) { return state; }
  };`);
  await page.locator('#counts').fill('1');
  await page.locator('#count').fill('1');
  await page.locator('#start').click();
  await expect(page.locator('#random-play')).toBeEnabled({timeout:120_000});
  await page.locator('#random-play').click();
  await expect(page.locator('#random-status')).toContainText('30 matches finished and recorded', {timeout:120_000});
  const list = await request.get('/game-test-sessions', {headers:{
    'X-User-Id':owner.id, 'X-User-Password':owner.password,
  }});
  const sessionId = (await list.json()).items[0].id;
  const response = await request.get(`/game-test-sessions/${sessionId}`, {headers:{
    'X-User-Id':owner.id, 'X-User-Password':owner.password,
  }});
  const recording = (await response.json()).recording;
  expect(recording.events.filter((event: {type:string}) => event.type === 'random_match')).toHaveLength(30);
  expect(recording.events.filter((event: {type:string}) => event.type === 'click')).toHaveLength(30);
  expect(new Set(recording.events.filter((event: {type:string}) => event.type === 'random_match')
    .map((event: {scenario:string}) => event.scenario)).size).toBe(10);
  await page.locator('.scenario').first().frameLocator('iframe').locator('#move')
    .evaluate(node => { (node as HTMLElement).style.width = '10px'; });
  await page.locator('#random-play').click();
  await expect(page.locator('#random-status')).toContainText('Random play incomplete', {timeout:20_000});
  await expect(page.locator('#random-status')).toContainText('Selected button:');
  await expect(page.locator('#status')).toContainText('Recording saved');
  await page.reload();
  await expect(page.locator(`#recordings option[value="${sessionId}"]`)).toHaveCount(1);
  await page.locator('#recordings').selectOption(sessionId);
  await page.locator('#speed').selectOption('100');
  await page.locator('#replay').click();
  await expect(page.locator('#status')).toHaveText('Replay complete.', {timeout:30_000});
  const savedAgain = await request.get(`/game-test-sessions/${sessionId}`, {headers:{
    'X-User-Id':owner.id, 'X-User-Password':owner.password,
  }});
  const persisted = (await savedAgain.json()).recording;
  expect(persisted.events.filter((event: {type:string}) => event.type === 'random_match')).toHaveLength(30);
  expect(persisted.events.some((event: {type:string}) => event.type === 'random_failure')).toBeTruthy();
});

test('random play finishes three tic-tac-toe matches in all two-player scenarios', async ({page, request}) => {
  test.setTimeout(180_000);
  const owner = await createUser(request, 'Tic tac toe tester');
  await loginAs(page, owner);
  await page.goto('/game-test');
  await page.locator('#client-code').fill(TICTACTOE);
  await page.locator('#server-code').fill(TICTACTOE_SERVER);
  await page.locator('#start').click();
  await expect(page.locator('#random-play')).toBeEnabled({timeout:120_000});
  await page.locator('#random-play').click();
  await expect(page.locator('#random-status')).toContainText('90 matches finished and recorded', {timeout:150_000});
});

test('records supported modes and replays completed matches at device dimensions', async ({ page, request }) => {
  test.setTimeout(180_000);
  const owner = await createUser(request, 'Matrix tester');
  await loginAs(page, owner);
  await page.goto('/game-test');
  await expect(page.locator('.topbar nav a')).toHaveCount(4);
  await expect(page.locator('.topbar a[aria-current="page"]')).toHaveAttribute('href', '/builder');
  await expect(page.locator('#account-menu')).toContainText('Matrix tester');
  await page.locator('#client-code').fill(TICTACTOE);
  await page.locator('#server-code').fill(TICTACTOE_SERVER);
  await page.locator('#start').click();
  await expect(page.locator('#start')).toBeEnabled({ timeout: 120_000 });
  await expect(page.locator('#status')).toContainText('Recording saved');
  await expect(page.locator('.scenario')).toHaveCount(30);
  await expect(page.locator('.scenario iframe')).toHaveCount(40);

  const card = (i: number) => page.locator('.scenario').nth(i);
  expect(await card(1).frameLocator('iframe').locator('html').evaluate(() => innerWidth)).toBe(768);
  expect(await card(1).frameLocator('iframe').locator('html').evaluate(() => innerHeight)).toBe(1366);
  expect(await card(1).frameLocator('iframe').locator('html').evaluate(() => document.compatMode)).toBe('CSS1Compat');

  await card(0).frameLocator('iframe').locator('html').evaluate(() =>
    parent.postMessage({type:'make_move', move:{cell:999}}, '*'));
  await expect(card(0).locator('p')).toContainText('Error:');
  await card(0).frameLocator('iframe').locator('#board button:not([disabled])').first().click();
  await expect(card(0).locator('p')).toContainText('ongoing');
  await card(0).getByRole('button', {name:'Restart match'}).click();
  await expect(card(0).locator('p')).toContainText('ongoing · 0 moves');

  for (const index of [0, 1, 2]) {
    const scenario = card(index);
    for (let match = 0; match < 3; match++) {
      if (match) {
        await scenario.getByRole('button', {name:'Restart match'}).click();
        await expect(scenario.locator('p')).toContainText('ongoing');
      }
      for (let move = 0; move < 12; move++) {
        if ((await scenario.locator('p').textContent())?.startsWith('over')) break;
        const count = index === 2 ? 2 : 1;
        let clicked = false;
        for (let seat = 0; seat < count; seat++) {
          const buttons = scenario.frameLocator('iframe').nth(seat).locator('#board button:not([disabled])');
          const n = await buttons.count();
          if (!n) continue;
          const before = await scenario.locator('p').textContent();
          await buttons.nth(Math.floor(Math.random() * n)).click();
          await expect(scenario.locator('p')).not.toHaveText(before || '', { timeout: 10_000 });
          clicked = true;
          break;
        }
        expect(clicked, `scenario ${index} has a playable human seat`).toBeTruthy();
      }
      await expect(scenario.locator('p')).toContainText('over');
    }
  }
  const boards = [];
  for (const index of [0, 1, 2]) boards.push(await card(index).frameLocator('iframe').first().locator('#board button').allTextContents());
  await expect(page.locator('#checks')).toContainText('72.0×72.0');
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('Recording saved');
  const options = page.locator('#recordings option');
  expect(await options.count()).toBeGreaterThan(1);
  await page.locator('#recordings').selectOption({ index: 1 });
  await page.locator('#speed').selectOption('100');
  await page.locator('#replay').click();
  await expect(page.locator('#status')).toHaveText('Replay complete.', { timeout: 30_000 });
  for (const index of [0, 1, 2]) {
    await expect(card(index).locator('p')).toContainText('over');
    await expect(card(index).frameLocator('iframe').first().locator('#board button')).toHaveText(boards[index]);
  }
});

test('supports solo games and one human against several computers', async ({ page, request }) => {
  test.setTimeout(180_000);
  const owner = await createUser(request, 'Solo matrix tester');
  await loginAs(page, owner);
  await page.goto('/game-test');
  await page.locator('#client-code').fill(`<!doctype html><html><head></head><body>
    <button id="move" style="width:40px;height:40px">Move</button>
    <script>
      const button = document.getElementById('move');
      window.addEventListener('message', e => {
        if (e.source === parent && e.data.type === 'state_changed')
          button.disabled = e.data.acting_for_player_index === null;
      });
      button.onclick = () => parent.postMessage({type:'make_move', move:{add:1}}, '*');
    </script></body></html>`);
  await page.locator('#server-code').fill(`
    const game = {
      newMatch(ctx) { return {state:{n:0}, turn:[ctx.players[0].id]}; },
      applyMove(state, id, move, ctx) {
        if (!move || move.add !== 1) throw new InvalidMove('add must be 1');
        const n = state.n + 1, humans = ctx.players.filter(p => p.kind === 'human');
        if (n >= 3) {
          const share = Math.floor(ctx.pot / humans.length);
          const payouts = Object.fromEntries(humans.map((p,i) => [p.id, share + (i < ctx.pot % humans.length ? 1 : 0)]));
          return {state:{n}, turn:null, payouts};
        }
        const index = ctx.players.findIndex(p => p.id === id);
        return {state:{n}, turn:[ctx.players[(index + 1) % ctx.players.length].id]};
      },
      randomMove() { return {add:1}; },
      computerMove() { return {add:1}; },
      viewFor(state) { return state; }
    };`);
  await page.locator('#counts').fill('1,3');
  await page.locator('#count').fill('3');
  await page.locator('#start').click();
  await expect(page.locator('#start')).toBeEnabled({timeout:120_000});
  await expect(page.locator('.scenario')).toHaveCount(40);
  await expect(page.locator('.scenario iframe')).toHaveCount(70);
  const computer = page.locator('.scenario').first();
  await computer.frameLocator('iframe').locator('#move').click();
  await expect(computer.locator('p')).toContainText('over · 3 moves');

  await page.locator('#count').fill('1');
  await page.locator('#start').click();
  await expect(page.locator('#start')).toBeEnabled({timeout:120_000});
  await expect(page.locator('.scenario')).toHaveCount(10);
  await expect(page.locator('.scenario iframe')).toHaveCount(10);
  const solo = page.locator('.scenario').first();
  for (let i = 1; i <= 3; i++) {
    await solo.frameLocator('iframe').locator('#move').click();
    await expect(solo.locator('p')).toContainText(`${i} moves`);
  }
  await expect(solo.locator('p')).toContainText('over');
});
