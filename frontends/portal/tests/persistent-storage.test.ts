import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPersistentStorage, DELETED_VALUE, type LegacyStorage, type PersistentBackend } from '../src/platform/persistent-storage';
function fixture() {
  const oldValues = new Map<string,string>(), values = new Map<string,string>(); let legacyWrites = 0; let failNativeWrite = false;
  const legacy: LegacyStorage = { async getItem(key) { return oldValues.get(key) ?? null; }, async setItem(key,value) { legacyWrites++; oldValues.set(key,value); }, async removeItem(key) { oldValues.delete(key); }, async getAllKeys() { return [...oldValues.keys()]; } };
  const native: PersistentBackend = { async getPersistentItem(key) { return values.get(key) ?? null; }, async setPersistentItem(key,value) { if (failNativeWrite) throw new Error('atomic write failed'); values.set(key,value); }, async removePersistentItem(key) { values.delete(key); }, async getPersistentKeys() { return [...values.keys()]; } };
  return { oldValues, values, legacy, native, adapter: createPersistentStorage(legacy,native), legacyWrites:()=>legacyWrites, fail:()=>{failNativeWrite=true;} };
}
test('native read atomically imports legacy value and leaves the old bytes intact', async () => {
  const f=fixture(); f.oldValues.set('account','legacy JSON'); assert.equal(await f.adapter.getItem('account'),'legacy JSON'); assert.equal(f.values.get('account'),'legacy JSON'); assert.equal(f.oldValues.get('account'),'legacy JSON');
  f.values.set('account','newer native JSON'); assert.equal(await f.adapter.getItem('account'),'newer native JSON');
});
test('failed migration copy rejects and preserves the complete original', async () => {
  const f=fixture(); f.oldValues.set('queue','original pending moves'); f.fail(); await assert.rejects(f.adapter.getItem('queue'),/atomic write failed/); assert.equal(f.oldValues.get('queue'),'original pending moves'); assert.equal(f.values.has('queue'),false);
});
test('large native account/archive writes bypass AsyncStorage entirely', async () => {
  const f=fixture(); const value=JSON.stringify({ archives:['x'.repeat(3_000_000)] }); await f.adapter.setItem('large',value); assert.equal(await f.adapter.getItem('large'),value); assert.equal(f.legacyWrites(),0); assert.equal(f.oldValues.has('large'),false);
});
test('native deletion writes a tombstone and never resurrects retained AsyncStorage bytes', async () => {
  const f=fixture(); f.oldValues.set('current','old-account'); await f.adapter.removeItem('current'); assert.equal(f.values.get('current'),DELETED_VALUE); assert.equal(await f.adapter.getItem('current'),null); assert.equal(f.oldValues.get('current'),'old-account'); assert.deepEqual(await f.adapter.keys(),[]);
  await f.adapter.setItem('current','new-account'); assert.equal(await f.adapter.getItem('current'),'new-account');
});
test('key enumeration unites both stores without deleting or eagerly copying originals', async () => {
  const f=fixture(); f.oldValues.set('old','one'); f.values.set('new','two'); assert.deepEqual((await f.adapter.keys()).sort(),['new','old']); assert.equal(f.values.has('old'),false);
});
test('Expo Go without the native module retains the small AsyncStorage fallback', async () => {
  const f=fixture(); const adapter=createPersistentStorage(f.legacy,null); await adapter.setItem('layout','top'); assert.equal(await adapter.getItem('layout'),'top'); assert.deepEqual(await adapter.keys(),['layout']); await adapter.removeItem('layout'); assert.equal(await adapter.getItem('layout'),null);
});
test('a concurrent write cannot be overwritten by a slow legacy migration read', async () => {
  const f=fixture(); let resume!:()=>void; const gate=new Promise<void>(resolve=>{resume=resolve;});
  f.legacy.getItem=async()=>{await gate;return 'legacy';}; const reading=f.adapter.getItem('account'); const writing=f.adapter.setItem('account','latest'); resume(); await reading; await writing; assert.equal(f.values.get('account'),'latest');
});
