const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto, createHash} = require('node:crypto');

const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'static/declarative-presentation.js'), 'utf8');
const legacy = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/declarative/backgammon-v1-ui.json'), 'utf8'));
const rules = fs.readFileSync(path.join(root, 'games/declarative/backgammon.server.js'), 'utf8');
const repaired = () => JSON.parse(fs.readFileSync(path.join(root, 'static/backgammon-declarative-ui.json'), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const game = () => ({id: '5f5293c3-2a3a-4eec-b631-9debf59be0ca', version: 1,
  server_code: rules, game_schemas: {move: {type: 'object'}}, declarative_ui: clone(legacy)});
const response = spec => ({ok: true, json: async () => clone(spec)});

function setup(fetch = async () => response(repaired()), crypto = webcrypto) {
  const calls = [];
  const context = vm.createContext({crypto, TextEncoder, Uint8Array,
    fetch: (...args) => {calls.push(args); return fetch(...args);}});
  vm.runInContext(source, context);
  return {forGame: context.DeclarativePresentation.forGame, calls};
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

test('the exact original Backgammon package receives the reviewed presentation without changing its pinned game', async () => {
  const input = freeze(game()), before = JSON.stringify(input);
  const {forGame, calls} = setup();
  const result = await forGame(input);
  assert.notEqual(result, input.declarative_ui);
  assert.deepEqual(clone(result), repaired());
  assert.equal(JSON.stringify(input), before);
  assert.equal(input.version, 1);
  assert.equal(input.server_code, rules);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/static/backgammon-declarative-ui.json?v=2');
  assert.equal(calls[0][1].credentials, 'omit');
});

test('the exact second Backgammon presentation receives the same repair with its original rules and version pinned', async () => {
  const input = game(); input.version = 2;
  input.declarative_ui = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/declarative/backgammon-v2-ui.json'), 'utf8'));
  const original = JSON.stringify(input), {forGame, calls} = setup();
  assert.deepEqual(clone(await forGame(freeze(input))), repaired());
  assert.equal(JSON.stringify(input), original);
  assert.equal(calls.length, 1);
});

test('the replacement asset matches the hardcoded reviewed content hash', () => {
  const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
  const digest = createHash('sha256').update(canonical(repaired())).digest('hex');
  assert.match(source, new RegExp(`REPAIRED_UI_SHA256 = "${digest}"`));
});

for (const [name, change] of [
  ['another game', input => {input.id = 'another-backgammon';}],
  ['different pinned rules', input => {input.server_code += '\n// changed rules';}],
  ['different presentation source', input => {input.declarative_ui.ui_code += '\n// owner edit';}],
  ['different board geometry', input => {input.declarative_ui.boards[0].width += 1;}],
  ['different artwork', input => {input.declarative_ui.assets.board_art.uri += 'changed';}],
  ['different viewport', input => {input.declarative_ui.viewport.width += 1;}],
]) test(`${name} retains its original package without fetching a replacement`, async () => {
  const input = game();
  change(input);
  const {forGame, calls} = setup();
  assert.equal(await forGame(input), input.declarative_ui);
  assert.equal(calls.length, 0);
});

test('missing games, packages and browser cryptography retain the original presentation', async () => {
  const ordinary = setup();
  assert.equal(await ordinary.forGame(null), undefined);
  assert.equal(await ordinary.forGame({id: game().id}), undefined);
  for (const crypto of [null, {}]) {
    const input = game(), {forGame, calls} = setup(undefined, crypto);
    assert.equal(await forGame(input), input.declarative_ui);
    assert.equal(calls.length, 0);
  }
});

test('the legacy fingerprint is independent of JSON object key order', async () => {
  const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]))
    : value;
  const input = game();
  input.declarative_ui = reverseKeys(input.declarative_ui);
  const {forGame} = setup();
  assert.deepEqual(clone(await forGame(input)), repaired());
});

for (const [name, failure] of [
  ['network failure', async () => {throw new Error('Offline');}],
  ['HTTP failure', async () => ({ok: false})],
  ['invalid JSON', async () => ({ok: true, json: async () => {throw new SyntaxError('Invalid JSON');}})],
  ['missing package', async () => response(null)],
  ['unsupported package', async () => response({...repaired(), version: 2})],
  ['corrupted replacement source', async () => response({...repaired(), ui_code: 'changed'})],
  ['corrupted replacement board', async () => {
    const spec = repaired(); spec.boards[0].width += 1; return response(spec);
  }],
]) test(`${name} keeps the original UI and can retry later`, async () => {
  let fail = true;
  const input = game(), {forGame, calls} = setup((...args) => fail ? failure(...args) : response(repaired()));
  assert.equal(await forGame(input), input.declarative_ui);
  fail = false;
  assert.deepEqual(clone(await forGame(input)), repaired());
  assert.equal(calls.length, 2);
});

test('concurrent matches share one validated fetch and receive independent presentation copies', async () => {
  let started, release;
  const requested = new Promise(resolve => {started = resolve;});
  const pendingResponse = new Promise(resolve => {release = resolve;});
  const {forGame, calls} = setup(() => {started(); return pendingResponse;});
  const first = forGame(game()), second = forGame(game());
  await requested;
  release(response(repaired()));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls.length, 1);
  assert.notEqual(a, b);
  a.ui_code = 'host-local mutation';
  assert.deepEqual(clone(b), repaired());
  assert.deepEqual(clone(await forGame(game())), repaired());
  assert.equal(calls.length, 1);
});
