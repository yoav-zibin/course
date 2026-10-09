// Real course backend + independent browser contexts; AI replies are deterministic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { EXAMPLES } = require('../src/examples.js');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
const example = EXAMPLES[0];
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const contexts = [];
  const errors = [];
  async function device(user) {
    const context = await browser.newContext(); contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/builder');
    if (user) await page.evaluate(user => Auth.upsert({ ...user, user_id: user.id }), user);
    await page.waitForFunction(() => document.querySelector('#cloudStatus').textContent.includes('Cloud connected'));
    return page;
  }
  async function call(page, method, route, body) {
    return page.evaluate(({ method, route, body }) => apiRequest(method, route, { body, user: Auth.current() }), { method, route, body });
  }
  try {
    const response = await fetch(base + '/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: 'Builder test' }) });
    const user = await response.json();
    const a = await device(user);
    assert.equal(await a.locator('nav a[href="/builder"]').count(), 1);
    assert.equal(await a.locator('nav a[href="/static/gamebuilder/index.html"]').count(), 0);
    const legacy = await a.request.get(base + '/static/gamebuilder/code-editor.html');
    assert.equal(legacy.status(), 200);
    assert.ok((await legacy.text()).includes('/static/builder.js'));
    // Test the actual generation and save flow; no real provider call or key.
    let generation = 0;
    await a.route('https://api.openai.com/v1/responses', route => {
      generation++;
      const title = generation === 1 ? 'Shared Tic-Tac-Toe' : 'Refined Tic-Tac-Toe';
      const text = '<game_meta>' + JSON.stringify({ title, description: 'A shared game', rules: 'Three in a row wins.', tutorial: ['Pick a square.'], allowedPlayers: [2], hiddenInformation: false }) + '</game_meta>\n<game_code>\n' + example.code + '\n</game_code>\n<notes>Ready to play.</notes>';
      return route.fulfill({ json: { status: 'completed', output: [{ content: [{ type: 'output_text', text }] }] } });
    });
    await a.locator('#aiKey').fill('test-key-never-persist');
    await a.locator('#aiSettings').getByRole('button', { name: 'Use this key' }).click();
    await a.locator('#newPrompt').fill('Make Tic-Tac-Toe.');
    await a.locator('#buildBtn').click();
    await a.waitForFunction(() => document.querySelector('#cloudStatus').textContent.includes('Saved to cloud') && document.querySelector('#gTitle').textContent === 'Shared Tic-Tac-Toe');
    assert.equal(await a.locator('#gTitle').textContent(), 'Shared Tic-Tac-Toe');
    let games = await call(a, 'GET', '/games?owner_user_id=' + user.id);
    assert.equal(games.length, 1);
    assert.ok(games[0].code.includes('state_changed'));
    assert.ok(!games[0].code.includes('test-key-never-persist'));
    assert.equal(await a.evaluate(() => JSON.stringify(localStorage).includes('test-key-never-persist')), false);
    const gameId = games[0].id;
    const b = await device(user);
    await b.locator('#myList button').click();
    await b.waitForFunction(() => document.querySelector('#gTitle').textContent === 'Shared Tic-Tac-Toe');
    assert.ok(await b.locator('#gRules').textContent());
    assert.equal(await b.evaluate(() => GameBuilderCloud.configured()), false);
    await a.locator('#chatInput').fill('Rename this game.');
    await a.locator('#sendBtn').click();
    await a.waitForFunction(() => document.querySelector('#gTitle').textContent === 'Refined Tic-Tac-Toe' && document.querySelector('#cloudStatus').textContent.includes('Saved to cloud'));
    await b.locator('#refreshCloud').click();
    await b.waitForFunction(() => document.querySelector('#myList').textContent.includes('Refined Tic-Tac-Toe'));
    await b.locator('#myList button').click();
    await b.waitForFunction(() => document.querySelector('#versions').textContent.includes('Version 2'));
    games = await call(a, 'GET', '/games?owner_user_id=' + user.id);
    assert.equal(games.length, 1);
    assert.equal(games[0].id, gameId);
    assert.equal(games[0].version, 2);
    // A second student's library must not list this user's games.
    const other = await call(a, 'POST', '/users', { display_name: 'Opponent test' });
    const c = await device(other);
    assert.equal(await c.locator('#myList button').count(), 0);
    const denied = await c.evaluate(async id => {
      try { await apiRequest('PATCH', '/games/' + id, { body: { name: 'Unauthorized' }, user: Auth.current() }); return false; }
      catch (error) { return error.status === 403; }
    }, gameId);
    assert.equal(denied, true);
    // Load the exported package in the unmodified shared portal on both devices.
    let match = await call(a, 'POST', '/matches', { game_id: gameId, num_computer_opponents: 0 });
    await call(c, 'POST', '/matches/' + match.id + '/join');
    await call(a, 'POST', '/matches/' + match.id + '/start');
    await a.goto(base + '/portal#match=' + match.id);
    await c.goto(base + '/portal#match=' + match.id);
    const boardA = a.frameLocator('.game-frame'), boardC = c.frameLocator('.game-frame');
    await boardA.locator('[data-move]').first().waitFor();
    await boardA.locator('[data-move]').first().click();
    await c.waitForFunction(() => state.match?.move_count >= 2);
    assert.equal((await call(c, 'GET', '/matches/' + match.id)).state.board[0], 'X');
    await boardC.locator('[data-move]').first().click();
    await a.waitForFunction(() => state.match?.move_count >= 3);
    assert.equal((await call(a, 'GET', '/matches/' + match.id)).state.board[1], 'O');
    // Computers are computed by the exported package when the portal delegates a turn.
    const computer = await call(a, 'POST', '/matches', { game_id: gameId, num_computer_opponents: 1 });
    await call(a, 'POST', '/matches/' + computer.id + '/start');
    await a.goto(base + '/portal#match=' + computer.id);
    await a.frameLocator('.game-frame').locator('[data-move]').first().click();
    await a.waitForFunction(() => state.match?.move_count >= 3);
    assert.ok((await call(a, 'GET', '/matches/' + computer.id)).state.board.includes('O'));
    // Saving after a fresh tab resolves the same backend game, not a duplicate.
    await b.evaluate(async () => {
      const doc = (await GameBuilderCloud.list())[0];
      await GameBuilderCloud.save(doc.id, { ...doc, description: 'Edited on the second device' });
    });
    assert.equal((await call(b, 'GET', '/games?owner_user_id=' + user.id)).length, 1);
    // Delete uses the shared backend's soft deletion, keeping old matches playable.
    await b.evaluate(async () => { const doc = (await GameBuilderCloud.list())[0]; await GameBuilderCloud.remove(doc.id); });
    assert.equal((await call(b, 'GET', '/games?owner_user_id=' + user.id)).length, 0);
    assert.ok(await call(a, 'GET', '/matches/' + match.id));
    assert.deepEqual(errors, []);
    console.log('PASS: generation, cross-device load/refinement, account isolation, portal human/computer moves, stable ids, soft deletion, no AI key in saved games');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
