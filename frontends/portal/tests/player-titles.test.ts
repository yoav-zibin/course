import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configureI18n,localizeGame} from '../src/platform/i18n';

const codes=['es','fr','de','pt','zh','hi','ar'];
test('all eight localized legacy player titles preserve their exact raw package',async()=>{
  const values=new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});
  const original=globalThis.fetch;globalThis.fetch=(async()=>{throw new Error('Offline test');}) as typeof fetch;
  const game={id:'legacy-title-fixture',version:2,name:'Connect Four (Declarative)',description:'Original package description.',server_code:'original rules',declarative_ui:{format:'buildplay-ui',version:1},translations:Object.fromEntries(['en',...codes].map(code=>[code,{display_name:`${code} title (Declarative)`,client_strings:{cell:`${code} cell`}}]))};
  const raw=JSON.stringify(game);
  try{
    for(const code of ['en',...codes]){
      await configureI18n('https://must-not-contact.test',code,true);
      const displayed=localizeGame(game);
      assert.equal(displayed.name,`${code} title`);
      assert.equal(displayed.version,2);assert.equal((displayed as any)._sourceText.name,game.name);
      assert.equal(displayed.server_code,game.server_code);assert.deepEqual(displayed.declarative_ui,game.declarative_ui);
      assert.deepEqual(displayed.translations,game.translations);assert.equal(JSON.stringify(game),raw);
      assert.equal(localizeGame(displayed).name,displayed.name);
    }
  }finally{globalThis.fetch=original;await configureI18n('','en',true);}
});
