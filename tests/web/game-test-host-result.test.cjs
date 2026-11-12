const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../static/game-test-host.js'), 'utf8',
);

function host(schemas, pot = 0) {
  const context = { postMessage() {} };
  vm.createContext(context);
  vm.runInContext(source, context);
  vm.runInContext(`__gameSchemas = ${JSON.stringify(schemas)}`, context);
  return (fn, result) => vm.runInContext('validateResult', context)(
    fn, result,
    { players: [{ id: 'p0', kind: 'human' }], pot },
    [{}, 'p0'],
  );
}

test('game-defined view and move fields do not become result envelopes', () => {
  const validate = host({
    view: { type: 'object', required: ['turn'], properties: { turn: { type: 'integer' } } },
    move: { type: 'object', required: ['turn'], properties: { turn: { type: 'integer' } } },
  });
  assert.doesNotThrow(() => validate('viewFor', { turn: 0, payouts: 'display only' }));
  assert.doesNotThrow(() => validate('computerMove', { turn: 1, payout: 'display only' }));
  assert.doesNotThrow(() => validate('randomMove', { turn: 2 }));
});

test('view and move schemas still reject invalid game-defined values', () => {
  const validate = host({
    view: { type: 'object', required: ['turn'], properties: { turn: { type: 'integer' } } },
    move: { type: 'object', required: ['turn'], properties: { turn: { type: 'integer' } } },
  });
  assert.throws(() => validate('viewFor', { turn: 'wrong' }), /invalid view/);
  assert.throws(() => validate('computerMove', { turn: 'wrong' }), /invalid move/);
});

test('state-changing results still enforce platform turns', () => {
  const validate = host({});
  assert.throws(
    () => validate('applyMove', { state: {}, turn: 0 }),
    /empty or non-list turn/,
  );
});

for (const fn of ['newMatch', 'applyMove', 'playerJoined', 'playerLeft']) {
  test(`${fn} must distribute a terminal match's pot`, () => {
    const validate = host({}, 10);
    assert.throws(
      () => validate(fn, { state: {}, turn: null }),
      /ended without payouts for the pot/,
    );
    assert.throws(
      () => validate(fn, { state: {}, turn: null, payouts: { p0: 9 } }),
      /not the pot of 10/,
    );
    assert.doesNotThrow(
      () => validate(fn, { state: {}, turn: null, payouts: { p0: 10 } }),
    );
  });
}
