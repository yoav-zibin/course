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
import {configureI18n,copyText,gameTexts,getDirection,t,localizeGame,playerText} from '../src/platform/i18n';

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

test('player copy removes internal renderer names and markers without changing ordinary copy',()=>{
  for(const name of ['Chess (Declarative)','Chess [DECLARATIVE]','Chess — declarative','Declarative: Chess'])assert.equal(playerText(name),'Chess');
  assert.equal(playerText('Unsupported declarative UI format'),'Unsupported UI format');
  assert.equal(playerText('A declarative game.\nUse highlighted destinations.'),'A game.\nUse highlighted destinations.');
  assert.equal(playerText('  {name} ·\n'), '  {name} ·\n');
});

test('cached catalogs and pinned game translations hide renderer terminology while source packages stay intact',async()=>{
  const values=new Map<string,string>();
  values.set('game-platform.i18n-bundle.v1:es',JSON.stringify({data:{messages:{'test.error':'Cannot open Declarative game {name}.'},games:{'internal-name':{version:2,name:'Ajedrez (Declarative)',description:'Juego declarative.'}}}}));
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});
  const game={id:'internal-name',version:2,name:'Chess (Declarative)',description:'A declarative game.',game_logic_rules:'Declarative: take turns.',game_ui_rules:'Use the declarative board.',tutorial_text:'Play declarative chess.',server_code:'const engine="declarative";',renderer_type:'declarative',declarative_ui:{strings:{title:'Declarative Chess'}},translations:{es:{display_name:'Ajedrez [Declarative]',short_description:'Juego declarative.',game_logic_rules:'Declarative: turnos.',game_ui_rules:'Tablero declarative.',tutorial_strings:{'Play declarative chess.':'Juega declarative ajedrez.'}}}};
  const original=JSON.stringify(game);
  try{
    await configureI18n('','es',true);
    const localized=localizeGame(game);
    assert.equal(localized.name,'Ajedrez');assert.equal(localized.description,'Juego.');
    assert.equal(t('test.error',{name:'Chess (Declarative)'},'Unavailable'),'Cannot open game Chess.');
    assert.equal(copyText('Play {v0}',{v0:'Chess (Declarative)'}),'Jugar a Chess');
    for(const key of ['name','description','game_logic_rules','game_ui_rules','tutorial_text'] as const)assert.doesNotMatch(localized[key],/declarative/i);
    const pinned=localizeGame({...game,version:1});assert.equal(pinned.name,'Ajedrez');
    await configureI18n('','en',true);
    const restored=localizeGame(localized);assert.equal(restored.name,'Chess');assert.equal(restored.description,'A game.');
    assert.equal(Reflect.get(restored,'_sourceText').name,game.name);assert.equal(restored.server_code,game.server_code);assert.equal(restored.renderer_type,'declarative');assert.deepEqual(restored.declarative_ui,game.declarative_ui);
    assert.equal(JSON.stringify(game),original);
  }finally{await configureI18n('','en',true);}
});
