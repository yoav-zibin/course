import {test} from 'node:test';
import assert from 'node:assert/strict';
import copy from '../src/platform/ui-copy.json';
import bundled from '../src/core/bundled-tictactoe.json';
import {configureI18n,copyText,gameTexts,getDirection,t} from '../src/platform/i18n';

const codes=['es','fr','de','pt','zh','hi','ar'];
test('shared interface dictionaries cover every locale with the same parameters',()=>{
  const parameters=(value:string)=>[...new Set([...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]))].sort();
  for(const [source,translations] of Object.entries(copy)){
    assert.deepEqual(Object.keys(translations).sort(),[...codes].sort(),source);
    for(const [locale,value] of Object.entries(translations)){
      assert.equal(typeof value,'string');assert.ok(value.trim(),`${source}:${locale}`);
      assert.deepEqual(parameters(value),parameters(source),`${source}:${locale}`);
    }
  }
  for(const identifier of ['buildplay.navigation.v2','https:','http:','buildplay:'])assert.ok(!Object.hasOwn(copy,identifier));
});
test('all seven translations work offline for missing catalog keys and the bundled game',async()=>{
  const values=new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});
  const original=globalThis.fetch;globalThis.fetch=(async()=>{throw new Error('Offline copy must not contact a server');}) as typeof fetch;
  try{
    for(const code of codes){
      await configureI18n('https://must-not-contact.test',code,true);
      assert.equal(copyText('Play history'),copy['Play history'][code as keyof typeof copy['Play history']]);
      assert.notEqual(t('ui.language.label',{},'Language'),'Language');
      assert.equal(getDirection(),code==='ar'?'rtl':'ltr');
      const texts=gameTexts(bundled);assert.ok(texts?.strings?.cell);assert.notEqual(texts.strings.cell,'Cell {n}');
      const name='Alice {v1}';assert.ok(copyText('Play {v0}',{v0:name}).includes(name));
    }
    await configureI18n('https://must-not-contact.test','en',true);assert.equal(copyText('Play history'),'Play history');
  }finally{globalThis.fetch=original;}
});
