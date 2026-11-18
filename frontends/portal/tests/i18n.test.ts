import {test} from 'node:test';
import assert from 'node:assert/strict';
import copy from '../src/platform/ui-copy.json';
import bundled from '../src/core/bundled-tictactoe.json';
import english from '../../../locales/en.json';
import spanish from '../../../locales/es.json';
import french from '../../../locales/fr.json';
import german from '../../../locales/de.json';
import portuguese from '../../../locales/pt.json';
import chinese from '../../../locales/zh.json';
import hindi from '../../../locales/hi.json';
import arabic from '../../../locales/ar.json';
import {configureI18n,copyText,gameTexts,getDirection,t,localizeGame} from '../src/platform/i18n';

const codes=['es','fr','de','pt','zh','hi','ar'];
const catalogs:Record<string,typeof english>={es:spanish,fr:french,de:german,pt:portuguese,zh:chinese,hi:hindi,ar:arabic};
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
      for(const key of ['ui.match.you_won','ui.match.you_lost','ui.match.draw','ui.match.ended_early','ui.match.result_unavailable','ui.match.won','ui.match.player_n','ui.match.awaiting_sync'] as const){
        const params={name:'Alice {number}',number:2};
        const expected=catalogs[code][key].replace(/\{(\w+)\}/g,(_,name)=>String(params[name as keyof typeof params]));
        assert.equal(t(key,params,english[key]),expected,`offline match outcome: ${key}`);
      }
      assert.notEqual(t('ui.language.label',{},'Language'),'Language');
      assert.equal(getDirection(),code==='ar'?'rtl':'ltr');
      const texts=gameTexts(bundled);assert.ok(texts?.strings?.cell);assert.notEqual(texts.strings.cell,'Cell {n}');
      const name='Alice {v1}';assert.ok(copyText('Play {v0}',{v0:name}).includes(name));
    }
    await configureI18n('https://must-not-contact.test','en',true);assert.equal(copyText('Play history'),'Play history');
  }finally{globalThis.fetch=original;}
});

test('authored rules and tutorial translate literally and restore source fields on the same game object',async()=>{
  const values=new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});
  const original=globalThis.fetch;globalThis.fetch=(async()=>{throw new Error('Offline test');}) as typeof fetch;
  const game={id:'instruction-fixture',version:1,name:'Source name',description:'Source description',game_logic_rules:'Rule $1 [row].',game_ui_rules:'Move (disc).',tutorial_text:'Rule $1 [row].\n\nMove (disc).',translations:Object.fromEntries(codes.map(code=>[code,{display_name:`${code} name`,short_description:`${code} description`,game_logic_rules:`${code} full rules`,game_ui_rules:`${code} controls`,tutorial_strings:{'Rule $1 [row].':`${code} translated rule`,'Move (disc).':'Rule $1 [row].'}}]))};
  try{
    for(const code of codes){
      await configureI18n('https://must-not-contact.test',code,true);const translated=localizeGame(game);
      assert.equal(translated.name,`${code} name`);assert.equal(translated.description,`${code} description`);
      assert.equal(translated.game_logic_rules,`${code} full rules`);assert.equal(translated.game_ui_rules,`${code} controls`);
      assert.equal(translated.tutorial_text,`${code} translated rule\n\nRule $1 [row].`);
      await configureI18n('https://must-not-contact.test','en',true);const restored=localizeGame(translated);
      for(const field of ['name','description','game_logic_rules','game_ui_rules','tutorial_text'] as const)assert.equal(restored[field],game[field]);
    }
    await configureI18n('','ar',true);const sparse=localizeGame({...game,game_logic_rules:undefined,game_ui_rules:undefined,tutorial_text:undefined});
    assert.equal(sparse.game_logic_rules,'ar full rules');await configureI18n('','en',true);
    assert.equal(localizeGame(sparse).game_logic_rules,undefined);assert.equal(localizeGame(sparse).game_ui_rules,undefined);
  }finally{globalThis.fetch=original;await configureI18n('','en',true);}
});
