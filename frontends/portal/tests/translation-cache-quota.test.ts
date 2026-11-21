import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configureI18n,setLocale,t} from '../src/platform/i18n';
import {diagnosticSnapshot,setDiagnosticScope} from '../src/core/diagnostics';
import {I18N_RECENCY_KEY,isTranslationCacheKey} from '../src/platform/recoverable-cache';

async function fixture(run:(saved:Record<string,string>,removed:string[])=>Promise<void>,failCleanup=false){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),fetch=globalThis.fetch;
  const saved:Record<string,string>={'game-platform.i18n-bundle.v1:fr':'oldest cache','game-platform.i18n-bundle.v1:de':'recent cache',
    [I18N_RECENCY_KEY]:JSON.stringify({clock:2,entries:[{key:'game-platform.i18n-bundle.v1:fr',at:1},{key:'game-platform.i18n-bundle.v1:de',at:2}]}),
    'buildplay.shared.v1.owner':JSON.stringify({queues:{pending:[{requestId:'keep-retry'}]},local:{pending:{moves:[{exact:true}]}}}),
    'game-platform.accounts.v1':'retained credentials'};
  const removed:string[]=[];
  Object.defineProperties(saved,{getItem:{value:(key:string)=>saved[key]??null},setItem:{value:(key:string,value:string)=>{
    if(key==='game-platform.i18n-bundle.v1:es'&&(failCleanup||Object.hasOwn(saved,'game-platform.i18n-bundle.v1:fr')))throw new DOMException('quota exceeded','QuotaExceededError');
    saved[key]=value;
  }},removeItem:{value:(key:string)=>{removed.push(key);if(failCleanup)throw new Error('cleanup denied: private-content-must-not-be-logged');delete saved[key];}}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:saved});
  globalThis.fetch=(async input=>new Response(JSON.stringify(String(input).endsWith('/i18n/locales')?{locales:[{code:'en'},{code:'es'}]}:{catalog:{messages:{'quota.fixture':'Still usable'}},games:{}}))) as typeof fetch;
  setDiagnosticScope(`translation-quota-${failCleanup}`);
  try{await configureI18n('https://translation-cache.test','en');await run(saved,removed);}
  finally{globalThis.fetch=fetch;if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete(globalThis as any).localStorage;}
}

test('translation quota retries after evicting only the oldest public cache',async()=>{
  await fixture(async(saved,removed)=>{
    const durable=saved['buildplay.shared.v1.owner'],credentials=saved['game-platform.accounts.v1'];
    assert.equal(await setLocale('es'),true);assert.equal(t('quota.fixture'),'Still usable');
    assert.deepEqual(removed,['game-platform.i18n-bundle.v1:fr']);assert.ok(saved['game-platform.i18n-bundle.v1:de']);
    assert.ok(saved['game-platform.i18n-bundle.v1:es']);assert.equal(saved['buildplay.shared.v1.owner'],durable);assert.equal(saved['game-platform.accounts.v1'],credentials);
  });
});

test('failed translation cleanup leaves the downloaded language usable and logs no private values',async()=>{
  await fixture(async(saved,removed)=>{
    const durable=saved['buildplay.shared.v1.owner'],credentials=saved['game-platform.accounts.v1'];
    assert.equal(await setLocale('es'),true);assert.equal(t('quota.fixture'),'Still usable');
    assert.equal(removed.length,4);assert.ok(removed.every(isTranslationCacheKey));assert.equal(new Set(removed).size,4);
    assert.equal(saved['game-platform.i18n-bundle.v1:es'],undefined);
    assert.equal(saved['buildplay.shared.v1.owner'],durable);assert.equal(saved['game-platform.accounts.v1'],credentials);
    const logs=JSON.stringify(diagnosticSnapshot().logs);assert.match(logs,/Device cache could not be saved/);assert.match(logs,/translation-write/);
    assert.doesNotMatch(logs,/private-content-must-not-be-logged|retained credentials|keep-retry/);
  },true);
});
