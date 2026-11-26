import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apiOrigin,createCredentialVault,credentialKeys} from '../src/platform/credential-vault';

class Values {
  values=new Map<string,string>();reads:string[]=[];failWrites=false;
  async getItem(key:string){this.reads.push(key);return this.values.get(key)??null;}
  async setItem(key:string,value:string){if(this.failWrites)throw new Error('Device locked');this.values.set(key,value);}
}
const alice={id:'alice',display_name:'Alice',password:'production-only-password'};
function fixture(){
  const metadata=new Values(),secure=new Values(),production=createCredentialVault(undefined,metadata,secure);
  return {metadata,secure,production};
}

test('a fresh native vault checks only its origin-scoped index and selection',async()=>{
  const {metadata,secure,production}=fixture();
  metadata.values.set('game-platform.accounts.v1','unread prototype data');
  assert.deepEqual(await production.loadAccounts(),[]);
  assert.equal(await production.loadCurrentAccount(),null);
  assert.deepEqual(metadata.reads,[production.keys.accounts,production.keys.current]);
  assert.deepEqual(secure.reads,[]);
});

test('credentials are restored from secure storage only for their API origin',async()=>{
  const {metadata,secure,production}=fixture();
  await production.saveAccounts([alice]);await metadata.setItem(production.keys.current,alice.id);
  const restored=createCredentialVault('https://BUILDPLAY.fun:443/',metadata,secure);
  assert.deepEqual(await restored.loadAccounts(),[alice]);assert.equal(await restored.loadCurrentAccount(),alice.id);
  assert.doesNotMatch(metadata.values.get(production.keys.accounts)!,/production-only-password|"password"/);
  const foreign=createCredentialVault('https://different.test',metadata,secure);
  assert.deepEqual(await foreign.loadAccounts(),[]);assert.equal(await foreign.loadCurrentAccount(),null);
  await foreign.saveAccounts([{...alice,password:'separate-password'}]);
  assert.deepEqual(await production.loadAccounts(),[alice]);
  await production.saveAccounts([]);assert.deepEqual(await production.loadAccounts(),[]);
});

test('failed index writes leave the previous account index readable',async()=>{
  const {metadata,production}=fixture();await production.saveAccounts([alice]);
  metadata.failWrites=true;await assert.rejects(production.saveAccounts([]),/Device locked/);
  assert.deepEqual(await production.loadAccounts(),[alice]);
});

test('credential slots use canonical HTTP origins and reject opaque or embedded-credential URLs',()=>{
  assert.equal(apiOrigin('https://BUILDPLAY.fun:443/path'),'https://buildplay.fun');
  assert.equal(credentialKeys('https://buildplay.fun').accounts,credentialKeys('https://buildplay.fun/').accounts);
  assert.notEqual(credentialKeys('https://buildplay.fun').accounts,credentialKeys('http://buildplay.fun').accounts);
  assert.notEqual(credentialKeys('http://127.0.0.1:8000').accounts,credentialKeys('http://127.0.0.1:8001').accounts);
  for(const url of ['file:///private','javascript:void(0)','https://user:password@buildplay.fun'])assert.throws(()=>credentialKeys(url));
});


test('retired codes are omitted from scoped account metadata',async()=>{
  const {metadata,secure,production}=fixture();
  await production.saveAccounts([{...alice,referral_code:'12345'}]);
  assert.equal(JSON.parse(metadata.values.get(production.keys.accounts)!)[0].referral_code,undefined);
  const record={id:alice.id,display_name:alice.display_name,referral_code:'12345'};
  metadata.values.set(production.keys.accounts,JSON.stringify([record]));metadata.failWrites=true;
  assert.deepEqual(await production.loadAccounts(),[alice]);
  metadata.failWrites=false;assert.deepEqual(await production.loadAccounts(),[alice]);
  assert.equal(JSON.parse(metadata.values.get(production.keys.accounts)!)[0].referral_code,undefined);
  assert.equal(secure.values.get(production.keys.password(alice.id)),alice.password);
});
