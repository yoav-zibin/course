import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apiOrigin,createCredentialVault,credentialKeys,LEGACY_ACCOUNTS_KEY,LEGACY_CURRENT_KEY} from '../src/platform/credential-vault';

class Values {
  values=new Map<string,string>();reads:string[]=[];failWrites=false;
  async getItem(key:string){this.reads.push(key);return this.values.get(key)??null;}
  async setItem(key:string,value:string){if(this.failWrites)throw new Error('Device locked');this.values.set(key,value);}
}
const alice={id:'alice',display_name:'Alice',password:'production-only-password'};
const oldPasswordKey='buildplay.account.61-6c-69-63-65';
function fixture(){
  const metadata=new Values(),secure=new Values();
  metadata.values.set(LEGACY_ACCOUNTS_KEY,JSON.stringify([{id:alice.id,display_name:alice.display_name}]));
  metadata.values.set(LEGACY_CURRENT_KEY,alice.id);
  secure.values.set(oldPasswordKey,alice.password);
  return {metadata,secure};
}

test('production adopts the former secure login without deleting any old credential or metadata',async()=>{
  const {metadata,secure}=fixture(),beforeMetadata=new Map(metadata.values),beforeSecure=new Map(secure.values);
  const production=createCredentialVault('https://buildplay.fun',metadata,secure);
  assert.deepEqual(await production.loadAccounts(),[alice]);assert.equal(await production.loadCurrentAccount(),alice.id);
  await production.saveAccounts(await production.loadAccounts());
  assert.deepEqual(await createCredentialVault('https://BUILDPLAY.fun:443/',metadata,secure).loadAccounts(),[alice]);
  assert.equal(secure.values.get(production.keys.password(alice.id)),alice.password);
  assert.doesNotMatch(metadata.values.get(production.keys.accounts)!,/production-only-password|"password"/);
  for(const [key,value]of beforeMetadata)assert.equal(metadata.values.get(key),value);
  for(const [key,value]of beforeSecure)assert.equal(secure.values.get(key),value);
  await metadata.setItem(production.keys.current,'another-account');assert.equal(await production.loadCurrentAccount(),'another-account');
});

test('a different API origin never loads production legacy accounts, passwords or selection',async()=>{
  const {metadata,secure}=fixture(),foreign=createCredentialVault('https://different.test',metadata,secure);
  assert.deepEqual(await foreign.loadAccounts(),[]);assert.equal(await foreign.loadCurrentAccount(),null);
  assert.equal(metadata.reads.includes(LEGACY_ACCOUNTS_KEY),false);assert.equal(metadata.reads.includes(LEGACY_CURRENT_KEY),false);assert.deepEqual(secure.reads,[]);
  const other={...alice,password:'different-server-password'};await foreign.saveAccounts([other]);
  assert.deepEqual(await foreign.loadAccounts(),[other]);
  assert.deepEqual(await createCredentialVault('https://buildplay.fun',metadata,secure).loadAccounts(),[alice]);
  assert.notEqual(foreign.keys.password(alice.id),credentialKeys().password(alice.id));
});

test('an explicit empty scoped account index does not resurrect retained legacy logins',async()=>{
  const {metadata,secure}=fixture(),production=createCredentialVault(undefined,metadata,secure);
  await production.saveAccounts([alice]);await production.saveAccounts([]);
  assert.deepEqual(await createCredentialVault(undefined,metadata,secure).loadAccounts(),[]);
  assert.equal(secure.values.get(oldPasswordKey),alice.password);
  assert.equal(secure.values.get(production.keys.password(alice.id)),alice.password);
});

test('failed migration preserves the old index and its usable secure password',async()=>{
  const {metadata,secure}=fixture(),production=createCredentialVault(undefined,metadata,secure);
  metadata.failWrites=true;await assert.rejects(production.saveAccounts([alice]),/Device locked/);
  assert.equal(metadata.values.has(production.keys.accounts),false);
  assert.deepEqual(await production.loadAccounts(),[alice]);assert.equal(secure.values.get(oldPasswordKey),alice.password);
});

test('credential slots use canonical HTTP origins and reject opaque or embedded-credential URLs',()=>{
  assert.equal(apiOrigin('https://BUILDPLAY.fun:443/path'),'https://buildplay.fun');
  assert.equal(credentialKeys('https://buildplay.fun').accounts,credentialKeys('https://buildplay.fun/').accounts);
  assert.notEqual(credentialKeys('https://buildplay.fun').accounts,credentialKeys('http://buildplay.fun').accounts);
  assert.notEqual(credentialKeys('http://127.0.0.1:8000').accounts,credentialKeys('http://127.0.0.1:8001').accounts);
  for(const url of ['file:///private','javascript:void(0)','https://user:password@buildplay.fun'])assert.throws(()=>credentialKeys(url));
});


test('retired codes are scrubbed from saved and legacy metadata without touching credentials',async()=>{
  const {metadata,secure}=fixture();
  metadata.values.set(LEGACY_ACCOUNTS_KEY,JSON.stringify([{id:alice.id,display_name:alice.display_name,referral_code:'12345'}]));
  const production=createCredentialVault(undefined,metadata,secure);
  assert.deepEqual(await production.loadAccounts(),[alice]);
  assert.equal(JSON.parse(metadata.values.get(LEGACY_ACCOUNTS_KEY)!)[0].referral_code,undefined);
  await production.saveAccounts([{...alice,referral_code:'67890'}]);
  assert.equal(JSON.parse(metadata.values.get(production.keys.accounts)!)[0].referral_code,undefined);
  assert.equal(secure.values.get(oldPasswordKey),alice.password);
});

test('denied metadata cleanup still loads a usable account without retired codes',async()=>{
  const {metadata,secure}=fixture();metadata.values.set(LEGACY_ACCOUNTS_KEY,JSON.stringify([{id:alice.id,display_name:alice.display_name,referral_code:'12345'}]));metadata.failWrites=true;
  assert.deepEqual(await createCredentialVault(undefined,metadata,secure).loadAccounts(),[alice]);
});
