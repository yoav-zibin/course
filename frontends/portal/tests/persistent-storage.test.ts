import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPersistentStorage, type StorageFallback, type PersistentBackend } from '../src/platform/persistent-storage';
function fixture() {
  const oldValues = new Map<string,string>(), values = new Map<string,string>(); let legacyWrites = 0;
  const legacy: StorageFallback = { async getItem(key) { return oldValues.get(key) ?? null; }, async setItem(key,value) { legacyWrites++; oldValues.set(key,value); }, async removeItem(key) { oldValues.delete(key); }, async getAllKeys() { return [...oldValues.keys()]; } };
  const native: PersistentBackend = { async getPersistentItem(key) { return values.get(key) ?? null; }, async setPersistentItem(key,value) { values.set(key,value); }, async removePersistentItem(key) { values.delete(key); }, async getPersistentKeys() { return [...values.keys()]; } };
  return { oldValues, values, legacy, native, adapter: createPersistentStorage(legacy,native), legacyWrites:()=>legacyWrites };
}
test('a native miss reads only the current store',async()=>{
  const f=fixture();f.oldValues.set('account','old');
  f.legacy.getItem=async()=>{throw new Error('Unexpected fallback read');};
  f.legacy.getAllKeys=async()=>{throw new Error('Unexpected fallback enumeration');};
  assert.equal(await f.adapter.getItem('account'),null);
  assert.deepEqual(await f.adapter.keys(),[]);
  await f.adapter.setItem('account','current');
  assert.equal(await f.adapter.getItem('account'),'current');
  await f.adapter.removeItem('account');
  assert.equal(f.values.has('account'),false);
  assert.deepEqual(await f.adapter.keys(),[]);
});
test('only request metadata skips repeated native reads and writes invalidate cached values',async()=>{
  const f=fixture(),key='request-metadata',reads:string[]=[];
  const read=f.native.getPersistentItem;
  f.native.getPersistentItem=async item=>{reads.push(item);return read(item);};
  const adapter=createPersistentStorage(f.legacy,f.native,new Set([key]));
  assert.deepEqual(await Promise.all([adapter.getItem(key),adapter.getItem(key)]),[null,null]);
  await adapter.setItem(key,'current');
  assert.equal(await adapter.getItem(key),'current');
  assert.equal(await adapter.getItem(key),'current');
  await adapter.removeItem(key);
  assert.equal(await adapter.getItem(key),null);
  assert.equal(await adapter.getItem('match'),null);
  assert.equal(await adapter.getItem('match'),null);
  assert.deepEqual(reads,[key,key,key,'match','match']);
});
test('a failed request metadata read can be retried',async()=>{
  const f=fixture(),key='request-metadata',adapter=createPersistentStorage(f.legacy,f.native,new Set([key]));
  const read=f.native.getPersistentItem;
  f.native.getPersistentItem=async()=>{ throw new Error('Read failed'); };
  await assert.rejects(adapter.getItem(key),/Read failed/);
  f.native.getPersistentItem=read;f.values.set(key,'current');
  assert.equal(await adapter.getItem(key),'current');
});
test('an unreadable native record never falls back to a potentially retired legacy copy', async () => {
  const f=fixture();f.oldValues.set('current','retired legacy value');f.native.getPersistentItem=async()=>{throw new Error('native read unavailable');};
  await assert.rejects(f.adapter.getItem('current'),/native read unavailable/);assert.equal(f.values.has('current'),false);assert.equal(f.oldValues.get('current'),'retired legacy value');
});
test('large native account/archive writes bypass AsyncStorage entirely', async () => {
  const f=fixture(); const value=JSON.stringify({ archives:['x'.repeat(3_000_000)] }); await f.adapter.setItem('large',value); assert.equal(await f.adapter.getItem('large'),value); assert.equal(f.legacyWrites(),0); assert.equal(f.oldValues.has('large'),false);
});
test('native deletion removes the file and ignores older AsyncStorage bytes', async () => {
  const f=fixture(); f.oldValues.set('current','old-account'); await f.adapter.removeItem('current'); assert.equal(f.values.has('current'),false); assert.equal(await f.adapter.getItem('current'),null); assert.equal(f.oldValues.get('current'),'old-account'); assert.deepEqual(await f.adapter.keys(),[]);
  await f.adapter.setItem('current','new-account'); assert.equal(await f.adapter.getItem('current'),'new-account');
});
test('key enumeration lists the active native files', async () => {
  const f=fixture(); f.oldValues.set('old','one'); f.values.set('new','two'); assert.deepEqual((await f.adapter.keys()).sort(),['new']); assert.equal(f.values.has('old'),false);
});
test('Expo Go without the native module retains the small AsyncStorage fallback', async () => {
  const f=fixture(); const adapter=createPersistentStorage(f.legacy,null); await adapter.setItem('layout','top'); assert.equal(await adapter.getItem('layout'),'top'); assert.deepEqual(await adapter.keys(),['layout']); await adapter.removeItem('layout'); assert.equal(await adapter.getItem('layout'),null);
});
test('a write queued behind an active native read owns the final value',async()=>{
  const f=fixture();let resume!:()=>void,started!:()=>void;
  const blocked=new Promise<void>(resolve=>{resume=resolve;});
  const reading=new Promise<void>(resolve=>{started=resolve;});
  f.native.getPersistentItem=async()=>{started();await blocked;return 'first';};
  const read=f.adapter.getItem('current');await reading;
  const write=f.adapter.setItem('current','latest');resume();
  assert.equal(await read,'first');await write;
  assert.equal(f.values.get('current'),'latest');
});
test('concurrent account reads share a snapshot until a write or read completion',async()=>{
  const f=fixture(),key='account';f.values.set(key,'first');
  let calls=0;
  f.native.getPersistentItem=async item=>{calls++;return f.values.get(item)??null;};
  const first=f.adapter.getItem(key),same=f.adapter.getItem(key);
  const write=f.adapter.setItem(key,'second'),after=f.adapter.getItem(key);
  assert.deepEqual(await Promise.all([first,same,write,after]),['first','first',undefined,'second']);
  assert.equal(calls,2);
  f.values.set(key,'external update');
  assert.equal(await f.adapter.getItem(key),'external update');
  assert.equal(calls,3);
});
