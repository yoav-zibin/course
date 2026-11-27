const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {source} = require('./device-storage-fixture.cjs');

function fixture() {
  const persisted = new Map([['current', 'first']]);
  const reads = [];
  let notify;
  const store = {
    getItem(key) { reads.push(key); return persisted.get(key) ?? null; },
    setItem(key, value) { persisted.set(key, value); },
    removeItem(key) { persisted.delete(key); },
  };
  const context = vm.createContext({localStorage: store, addEventListener(name, handler) {
    assert.equal(name, 'storage'); notify = handler;
  }});
  vm.runInContext(source, context);
  return {api: context.BuildPlayStorage, context, persisted, reads, store, notify};
}

test('classic pages and the web bundle share one live account snapshot', async () => {
  const {api, context, reads, persisted} = fixture();
  const current = api.watchItem('current');
  assert.equal(current(), 'first');
  const module = context.module = {exports: {}};
  vm.runInContext(source, context);
  assert.equal(module.exports, api);
  await module.exports.setItem('current', 'second');
  assert.equal(persisted.get('current'), 'second');
  assert.equal(api.watchItem('current')(), 'second');
  await api.removeItem('current');
  assert.equal(current(), null);
  assert.deepEqual(reads, ['current']);
});

test('account changes from another tab, including clear, update watched keys', () => {
  const {api, persisted, reads, store, notify} = fixture();
  const current = api.watchItem('current');
  persisted.set('current', 'another user');
  notify({storageArea: store, key: 'current'});
  assert.equal(current(), 'another user');
  persisted.clear();
  notify({storageArea: {}, key: 'current'});
  assert.equal(current(), 'another user');
  notify({storageArea: store, key: null});
  assert.equal(current(), null);
  assert.deepEqual(reads, ['current', 'current', 'current']);
});

test('failed durable writes reject while the current page can still sign in and out', async () => {
  const {api, store, persisted} = fixture();
  const current = api.watchItem('current');
  store.setItem = store.removeItem = () => { throw new Error('quota'); };
  await assert.rejects(api.setItem('current', 'session user'), /quota/);
  assert.equal(current(), 'session user');
  await assert.rejects(api.removeItem('current'), /quota/);
  assert.equal(current(), null);
  assert.equal(persisted.get('current'), 'first');
});
