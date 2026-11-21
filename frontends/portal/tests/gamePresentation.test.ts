import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {canonical,reviewedPresentation} from '../src/game/presentationCore';
import {presentationSource} from '../src/game/runtimeSource';
import {validateMoveAnimations,validateScene,validateSpec} from '../src/game/validation';
import replacement from '../src/game/reviewedBackgammon.json';
import connectFourReplacement from '../src/game/reviewedConnectFour.json';

const root=resolve(import.meta.dirname,'../../..');
const read=(name:string)=>JSON.parse(readFileSync(resolve(root,name),'utf8'));
const digest=async(source:string)=>createHash('sha256').update(source).digest('hex');
const game=()=>({id:'5f5293c3-2a3a-4eec-b631-9debf59be0ca',version:1,
  server_code:readFileSync(resolve(root,'games/declarative/backgammon.server.js'),'utf8'),
  declarative_ui:read('tests/fixtures/declarative/backgammon-v1-ui.json')});

test('exact reviewed historical Backgammon UIs receive bundled repair while rules and version remain pinned',async()=>{
  for(const version of [1,2,3]){
    const input={...game(),version,declarative_ui:read(`tests/fixtures/declarative/backgammon-v${version}-ui.json`)};
    const before=JSON.stringify(input),result=await reviewedPresentation(input,digest);
    assert.deepEqual(result,replacement);assert.notEqual(result,replacement);assert.equal(JSON.stringify(input),before);
  }
});
test('presentation repair is scoped by game identity, authoritative rule hash and complete authored UI bytes',async()=>{
  for(const change of [(g:ReturnType<typeof game>)=>{g.id='another';},(g:ReturnType<typeof game>)=>{g.server_code+='\n// changed rules';},
    (g:ReturnType<typeof game>)=>{g.declarative_ui.viewport.width+=1;},(g:ReturnType<typeof game>)=>{g.declarative_ui.ui_code+='\n// changed source';}]){
    const input=game();change(input);assert.equal(await reviewedPresentation(input,digest),input.declarative_ui);
  }
});
test('bundled repair hash, independent result copies and fail-safe cryptography behavior remain stable',async()=>{
  assert.equal(await digest(canonical(replacement)),'666936dafaf8b31d82caecad96e94e4f3d40a83b1c3071687148de36e37a25e3');
  const input=game(),first=await reviewedPresentation(input,digest),second=await reviewedPresentation(input,digest);
  assert.notEqual(first,second);assert.deepEqual(first,second);
  assert.equal(await reviewedPresentation(input,async()=>{throw new Error('unavailable');}),input.declarative_ui);
  assert.equal(await reviewedPresentation(null,digest),undefined);
  assert.equal(canonical({'9':'nine','10':'ten'}),'{"10":"ten","9":"nine"}');
});

test('exact modern Backgammon opening repair preserves saved rules and package pins and rejects other hashes',async()=>{
  const modern=()=>({...game(),version:7,
    server_code:read('games/declarative/backgammon.json').server_code,
    declarative_ui:read('tests/fixtures/declarative/backgammon-v7-ui.json')});
  const input=modern(),before=JSON.stringify(input);
  const result=await reviewedPresentation(input,digest);
  assert.deepEqual(result,replacement);assert.notEqual(result,replacement);
  assert.equal(JSON.stringify(input),before);
  assert.equal(input.version,7);
  assert.equal(await digest(input.server_code),'f7044be96b2a162fe084edc82fedc7d0451d8856121be19bf31cfa69aa12e4e8');
  for(const change of [(g:ReturnType<typeof modern>)=>{g.id='another-game';},
    (g:ReturnType<typeof modern>)=>{g.server_code+='\n// different rules';},
    (g:ReturnType<typeof modern>)=>{g.declarative_ui.ui_code+='\n// different authored UI';},
    (g:ReturnType<typeof modern>)=>{g.declarative_ui=read('tests/fixtures/declarative/backgammon-v1-ui.json');}]){
    const changed=modern();change(changed);
    assert.equal(await reviewedPresentation(changed,digest),changed.declarative_ui);
  }
  assert.equal(await reviewedPresentation(input,async()=>{throw new Error('digest unavailable');}),input.declarative_ui);
});

test('the exact saved Backgammon version9 receives only its dice action cue',async()=>{
  const pkg=read('games/declarative/backgammon.json');
  const original=structuredClone(pkg.declarative_ui);original.piece_types.die.action_outline='none';
  const input={...game(),version:9,server_code:pkg.server_code,declarative_ui:original};
  const before=JSON.stringify(input),expected=structuredClone(original);
  expected.piece_types.die.action_outline='rect';
  const first=await reviewedPresentation(input,digest),second=await reviewedPresentation(input,digest);
  assert.deepEqual(first,expected);assert.deepEqual(second,expected);assert.notEqual(first,second);
  assert.equal(JSON.stringify(input),before);
  for(const change of [(g:typeof input)=>{g.id='other-game';},(g:typeof input)=>{g.version=8;},
    (g:typeof input)=>{g.server_code+='\n// changed authority';},
    (g:typeof input)=>{g.declarative_ui.viewport.width+=1;},
    (g:typeof input)=>{g.declarative_ui.ui_code+='\n// changed presentation';}]){
    const changed=structuredClone(input);change(changed);
    assert.equal(await reviewedPresentation(changed,digest),changed.declarative_ui);
  }
  assert.equal(await reviewedPresentation(input,async()=>{throw new Error('digest unavailable');}),original);
});

test('exact rich Connect Four presentation adds game-authored falling paths while preserving pinned packages',async()=>{
  const fixture=read('tests/fixtures/declarative/connect4-native-package.json').game;
  for(const version of [3,4]){
    const input={...fixture,version},before=JSON.stringify(input);
    const result=await reviewedPresentation(input,digest);
    assert.deepEqual(result,connectFourReplacement);assert.notEqual(result,connectFourReplacement);
    assert.equal(JSON.stringify(input),before);
  }
  const original=fixture.declarative_ui;
  const helper=readFileSync(resolve(root,'games/declarative/connect4-move-animations.js'),'utf8');
  assert.deepEqual(connectFourReplacement,{...original,ui_code:original.ui_code+'\n'+helper});
  assert.equal(await digest(canonical(connectFourReplacement)),'1450713baa36d87bdd7b6aa23fba1263c0db48912bbc3bfec9b55f35a9da4d75');
  const board=Array(42).fill(-1),disc_ids=Array(42).fill(-1);board[35]=0;disc_ids[35]=0;
  const message={type:'state_changed',status:'ongoing',my_player_index:0,acting_for_player_index:null,
    view:{board,disc_ids,turns:1,turn:1,over:false,winner:-1}};
  const result=JSON.parse(runInNewContext(presentationSource(connectFourReplacement.ui_code,message,null)));
  const spec=validateSpec(connectFourReplacement),scene=validateScene(spec,result.scene);
  const animations=validateMoveAnimations(spec,scene,result.last_move_animations)!;
  assert.deepEqual(animations,[{piece_id:'disc_0',duration_ms:600,path:[
    {board:'main',position:{x:25,y:-28}},{board:'main',position:{x:25,y:284}}]}]);
});

test('Connect Four repair fails safely for changes to identity, rules, presentation or digest',async()=>{
  for(const change of [(game:any)=>{game.id='other';},(game:any)=>{game.server_code+='\n// changed';},
    (game:any)=>{game.declarative_ui.viewport.width++;},(game:any)=>{game.declarative_ui.ui_code+='\n// changed';}]){
    const input=read('tests/fixtures/declarative/connect4-native-package.json').game;change(input);
    assert.equal(await reviewedPresentation(input,digest),input.declarative_ui);
  }
  const input=read('tests/fixtures/declarative/connect4-native-package.json').game;
  assert.equal(await reviewedPresentation(input,async()=>{throw new Error('unavailable');}),input.declarative_ui);
  const first=await reviewedPresentation(input,digest),second=await reviewedPresentation(input,digest);
  assert.notEqual(first,second);assert.deepEqual(first,second);
});
