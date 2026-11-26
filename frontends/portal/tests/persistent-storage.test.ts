import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPersistentStorage, DELETED_VALUE, type LegacyStorage, type PersistentBackend } from '../src/platform/persistent-storage';
import {diagnosticSnapshot,setDiagnosticScope} from '../src/core/diagnostics';
function fixture() {
  const oldValues = new Map<string,string>(), values = new Map<string,string>(); let legacyWrites = 0; let nativeWriteFailure: Error | null = null;
  const legacy: LegacyStorage = { async getItem(key) { return oldValues.get(key) ?? null; }, async setItem(key,value) { legacyWrites++; oldValues.set(key,value); }, async removeItem(key) { oldValues.delete(key); }, async getAllKeys() { return [...oldValues.keys()]; } };
  const native: PersistentBackend = { async getPersistentItem(key) { return values.get(key) ?? null; }, async setPersistentItem(key,value) { if (nativeWriteFailure) throw nativeWriteFailure; values.set(key,value); }, async removePersistentItem(key) { values.delete(key); }, async getPersistentKeys() { return [...values.keys()]; } };
  return { oldValues, values, legacy, native, adapter: createPersistentStorage(legacy,native), legacyWrites:()=>legacyWrites, fail:(error:Error = new Error('atomic write failed'))=>{nativeWriteFailure=error;}, recover:()=>{nativeWriteFailure=null;} };
}
test('native read atomically imports legacy value and leaves the old bytes intact', async () => {
  const f=fixture(); f.oldValues.set('account','legacy JSON'); assert.equal(await f.adapter.getItem('account'),'legacy JSON'); assert.equal(f.values.get('account'),'legacy JSON'); assert.equal(f.oldValues.get('account'),'legacy JSON');
  f.values.set('account','newer native JSON'); assert.equal(await f.adapter.getItem('account'),'newer native JSON');
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
test('request metadata retries a legacy migration whose first copy failed',async()=>{
  const f=fixture(),key='legacy-request-metadata';
  f.oldValues.set(key,'old');
  const adapter=createPersistentStorage(f.legacy,f.native,new Set([key]));
  f.fail();
  assert.equal(await adapter.getItem(key),'old');
  f.recover();
  assert.equal(await adapter.getItem(key),'old');
  assert.equal(f.values.get(key),'old');
});
test('a full migration destination keeps original data readable and retries the copy later', async () => {
  const f=fixture(),key='private-retained-key',value='complete original pending moves';setDiagnosticScope('native-quota-copy');
  f.oldValues.set(key,value);f.fail(new DOMException('No space left on device','QuotaExceededError'));
  assert.equal(await f.adapter.getItem(key),value);assert.equal(f.oldValues.get(key),value);assert.equal(f.values.has(key),false);
  const logs=JSON.stringify(diagnosticSnapshot().logs);assert.match(logs,/migration/);assert.match(logs,/quota/);assert.doesNotMatch(logs,/private-retained-key|complete original pending moves/);
  // Read fallback does not make failed new writes or deletions appear durable.
  await assert.rejects(f.adapter.setItem(key,'unsaved replacement'),error=>(error as Error).name==='QuotaExceededError');
  await assert.rejects(f.adapter.removeItem(key),error=>(error as Error).name==='QuotaExceededError');
  assert.equal(f.oldValues.get(key),value);assert.equal(f.values.has(key),false);
  f.recover();assert.equal(await f.adapter.getItem(key),value);assert.equal(f.values.get(key),value);assert.equal(f.oldValues.get(key),value);
});
test('an unreadable native record never falls back to a potentially retired legacy copy', async () => {
  const f=fixture();f.oldValues.set('current','retired legacy value');f.native.getPersistentItem=async()=>{throw new Error('native read unavailable');};
  await assert.rejects(f.adapter.getItem('current'),/native read unavailable/);assert.equal(f.values.has('current'),false);assert.equal(f.oldValues.get('current'),'retired legacy value');
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
for(const action of ['write','delete'])test(`a failed migration copy finishes before a newer queued ${action}`,async()=>{
  const f=fixture();f.oldValues.set('current','retained old value');let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  let first=true;f.native.setPersistentItem=async(key,value)=>{if(first){first=false;entered();await gate;throw new Error('copy destination unavailable');}f.values.set(key,value);};
  const reading=f.adapter.getItem('current');await started;
  const mutation=action==='write'?f.adapter.setItem('current','newest value'):f.adapter.removeItem('current');release();
  assert.equal(await reading,'retained old value');await mutation;
  assert.equal(f.values.get('current'),action==='write'?'newest value':DELETED_VALUE);
  assert.equal(await f.adapter.getItem('current'),action==='write'?'newest value':null);assert.equal(f.oldValues.get('current'),'retained old value');
});
