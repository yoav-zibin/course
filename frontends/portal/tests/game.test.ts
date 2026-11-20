import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateSpec, validateScene, position, pieceActions, assetURI, contentBounds, targetBounds } from '../src/game/validation';
import { canMove, historyChanges, hitPiece, hitTarget, pieceName, validEvent, animateUpdate, presentationSteps } from '../src/game/interactions';
import { presentationSource, rulesSource } from '../src/game/runtimeSource';
import type { GameSpec, Json, Scene, StateMessage } from '../src/game/types';

const repo=resolve(import.meta.dirname,'../../..');
const spec=():GameSpec=>({format:'buildplay-ui',version:1,viewport:{width:300,height:300},boards:[{id:'board',kind:'grid',x:0,y:0,width:300,height:300,rows:3,columns:3}],piece_types:{token:{shape:'circle',width:60,height:60}},ui_code:'const gameUI={reduce(){return {scene:{}}}}'});
const scene=():Scene=>({pieces:[{id:'token',type:'token',board:'board',position:{cell:'0'},move_targets:['destination'],actions:['move','rotate','flip','scale']}],targets:[{id:'destination',board:'board',position:{cell:'1'}}]});
const message=(extra:Partial<StateMessage>={}):StateMessage=>({type:'state_changed',status:'ongoing',move_count:1,my_player_index:0,acting_for_player_index:0,...extra});

test('portable schema fixtures and example packages retain validation and coordinate parity',()=>{
  for(const name of ['tictactoe','connect4','reversi','nim','mancala','gomoku','hex','domineering','memory','pig','backgammon']){
    const pkg=JSON.parse(readFileSync(join(repo,`games/declarative/${name}.json`),'utf8'));
    if(pkg.ui_code)validateSpec(pkg);else if(pkg.declarative_ui)validateSpec(pkg.declarative_ui);
  }
  assert.deepEqual(position(spec(),scene().pieces![0]),{x:50,y:50,board:spec().boards[0]});
  const motion=JSON.parse(readFileSync(join(repo,'tests/fixtures/declarative/motion-cases.json'),'utf8'));
  for(const item of motion){if(item.valid)assert.doesNotThrow(()=>validateSpec({...spec(),motion:item.value}));else assert.throws(()=>validateSpec({...spec(),motion:item.value}));}
  const targets=JSON.parse(readFileSync(join(repo,'tests/fixtures/declarative/target-hit-area-cases.json'),'utf8'));
  for(const item of targets){const data=scene();data.targets![0].hit_area=item.value;if(item.valid)assert.doesNotThrow(()=>validateScene(spec(),data));else assert.throws(()=>validateScene(spec(),data));}
});

test('hit testing respects transformed artwork, expanded legal destinations and passive pieces',()=>{
  const pkg=spec(),data=scene();
  assert.equal(hitPiece(pkg,data,{x:50,y:50})?.id,'token');
  assert.equal(hitPiece(pkg,data,{x:100,y:100}),undefined);
  assert.equal(hitTarget(pkg,data,{x:150,y:50},data.pieces![0])?.id,'destination');
  data.targets![0].hit_area={x:-100,y:-50,width:200,height:100};
  assert.equal(hitTarget(pkg,data,{x:240,y:50},data.pieces![0])?.id,'destination');
  data.pieces![0].hidden=true;assert.equal(hitPiece(pkg,data,{x:50,y:50}),undefined);
  assert.deepEqual(pieceActions({actions:[],rotation:90,scale:2}),[]);
});

test('hit shape cases validate like the server and line or polygon zones hit by true geometry',()=>{
  const cases=JSON.parse(readFileSync(join(repo,'tests/fixtures/declarative/target-hit-shape-cases.json'),'utf8'));
  for(const item of cases){
    const data=scene();Object.assign(data.targets![0],item.target);
    if(item.valid)assert.doesNotThrow(()=>validateScene(spec(),data));else assert.throws(()=>validateScene(spec(),data));
  }
  // Cell 1 is centred at (150,50). A horizontal 20-wide line through it.
  const pkg=spec(),data:Scene={targets:[
    {id:'bar',board:'board',position:{cell:'1'},hit_shape:{kind:'line',from:{x:-40,y:0},to:{x:40,y:0},width:20}},
    {id:'tri',board:'board',position:{cell:'7'},hit_shape:{kind:'polygon',points:[{x:0,y:-40},{x:40,y:40},{x:-40,y:40}]}},
    {id:'diag',board:'board',position:{cell:'4'},hit_shape:{kind:'line',from:{x:-40,y:-40},to:{x:40,y:40},width:20}},
  ]};
  validateScene(pkg,data);
  const at=(x:number,y:number,margin=0)=>hitTarget(pkg,data,{x,y},undefined,margin)?.id;
  assert.equal(at(150,50),'bar');assert.equal(at(188,55),'bar');       // along the line, round end included
  assert.equal(at(150,65),undefined);assert.equal(at(150,65,6),'bar'); // beside it, only with margin
  assert.equal(at(205,50),undefined);                                  // past the round end (10 beyond the 190 cap)
  assert.equal(at(150,230),'tri');assert.equal(at(140,280),'tri');assert.equal(at(150,185),undefined);assert.equal(at(100,270),undefined);
  assert.equal(at(150,150),'diag');assert.equal(at(130,132),'diag');   // on the diagonal
  assert.equal(at(190,110),undefined);                                  // the bounding box corner, off the line
  assert.equal(at(190,110,60),'diag');                                  // within a drag margin of it
  const far:Scene={targets:[{id:'far',board:'board',position:{x:250,y:250},hit_shape:{kind:'line',from:{x:0,y:0},to:{x:80,y:0},width:20}}]};
  validateScene(pkg,far);
  assert.deepEqual(targetBounds(pkg,far.targets![0]),{x:240,y:240,width:100,height:20});
});

test('camera fitting preserves the declared instruction viewport and complete offset target bodies',()=>{
  const pkg=spec();pkg.viewport={width:400,height:500};pkg.boards=[{id:'board',kind:'zone',x:20,y:20,width:180,height:180}];
  assert.deepEqual(contentBounds(pkg),{x:0,y:0,width:400,height:500});
  const data:Scene={targets:[{id:'outside',board:'board',position:{x:350,y:480},hit_area:{x:-20,y:-10,width:100,height:80}}]};
  validateScene(pkg,data);assert.deepEqual(contentBounds(pkg,data),{x:0,y:0,width:450,height:570});
});

test('move gates prohibit replay, spectators, passive transforms, stale choices and duplicate sends',()=>{
  assert.equal(canMove(message()),true);
  for(const patch of [{acting_for_player_index:null},{acting_for_player_index:-1},{acting_for_player_index:10},{replay:{index:0}},{status:'over'}])assert.equal(canMove(message(patch)),false);
  assert.equal(canMove(message(),true),false);
  const data=scene();
  assert.equal(validEvent(data,{type:'drop',id:'token',piece_id:'token',target_id:'destination'}),true);
  assert.equal(validEvent(data,{type:'drop',id:'token',piece_id:'other',target_id:'destination'}),false);
  assert.equal(validEvent(data,{type:'drop',id:'token',piece_id:'token',target_id:'forged'}),false);
  assert.equal(validEvent(data,{type:'rotate',id:'token',delta:90}),true);
  assert.equal(validEvent(data,{type:'rotate',id:'token',delta:361}),false);
  assert.equal(validEvent(data,{type:'scale',id:'token',factor:0}),false);
  data.pieces![0].actions=[];delete data.pieces![0].move_targets;
  assert.equal(validEvent(data,{type:'rotate',id:'token',delta:90}),false);
});

test('covered identities and remote image schemes never appear as display names or images',()=>{
  assert.equal(pieceName({...scene().pieces![0],face:'back',text:'Ace of spades',aria_label:'Secret card'}),'Covered piece');
  for(const uri of ['https://tracker.example/ace.png','javascript:alert(1)','file:///secrets','data:text/html;base64,AAAA'])assert.equal(assetURI({uri}),null);
});

test('history processing retains accepted order and grants no permissions to intermediate scenes',()=>{
  const previous=message({move_count:1}),next=message({move_count:4,last_move_player_index:1,presentation_history:[
    {view:{n:2},move_count:2,last_move_player_index:0},{view:{n:3},move_count:3,last_move_player_index:1} ]});
  assert.deepEqual(presentationSteps(previous,next).map(step=>[step.move_count,step.acting_for_player_index]),[[2,null],[3,null]]);
  assert.equal(animateUpdate(previous,message({move_count:2,last_move_player_index:0})),false);
  assert.equal(animateUpdate(previous,message({move_count:2,last_move_player_index:1})),true);
  assert.equal(animateUpdate(message({replay:{index:1}}),message({move_count:0,replay:{index:0}})),true);
  assert.deepEqual(presentationSteps(previous,{...next,presentation_history:[{view:{n:3},move_count:3}]}),[]);
  assert.equal(animateUpdate(message({move_count:1,replay:{index:1}}),message({move_count:3,replay:{index:3}})),false);
  assert.equal(animateUpdate(message({move_count:1,replay:{index:1}}),message({move_count:2,replay:null,last_move_player_index:1})),false);
  for(const viewer of [1,null])assert.equal(animateUpdate(message({move_count:1,replay:{index:1}}),message({my_player_index:viewer,move_count:2,replay:{index:2}})),false);
});

test('history effects distinguish new placements, counter changes and inert removed artwork',()=>{
  const before=scene(),counter={...before.pieces![0],text:'1',actions:[]};
  const added=historyChanges({}, {pieces:[counter]});assert.equal(added.effects.get('token'),'enter');
  const changed=historyChanges({pieces:[counter]},{pieces:[{...counter,text:'2'}]});assert.equal(changed.effects.get('token'),'change');
  const removed=historyChanges({pieces:[counter]},{});assert.deepEqual(removed.removed,[counter]);
  assert.deepEqual(historyChanges({pieces:[{...counter,hidden:true}]},{}).removed,[]);
});

test('native QuickJS executes portable rules with fresh bounded JSON-only contexts', {timeout:60000},()=>{
  if(process.platform==='win32')return;
  const temporary=mkdtempSync(join(tmpdir(),'buildplay-vm-'));
  try{
    const base=resolve(import.meta.dirname,'../modules/game-runtime/cpp'),binary=join(temporary,'runtime');
    const compilation=spawnSync(process.env.CC||'cc',['-O1','-std=gnu11','-D_GNU_SOURCE','-DCONFIG_VERSION="2025-09-13"','-I',base,
      resolve(import.meta.dirname,'native/runtime_cli.c'),join(base,'buildplay_runtime.c'),...['quickjs','cutils','libregexp','libunicode','dtoa'].map(name=>join(base,'quickjs',`${name}.c`)),'-lm','-o',binary],{encoding:'utf8',timeout:45000});
    assert.equal(compilation.status,0,compilation.stderr);
    const run=(source:string)=>{
      const response=spawnSync(binary,{input:source,encoding:'utf8',timeout:5000});assert.equal(response.status,0,response.stderr);
      const boundary=response.stdout.indexOf('\n');return {failed:response.stdout.slice(0,boundary)==='1',text:response.stdout.slice(boundary+1)};
    };
    const code='var counter=0;const gameUI={reduce(m,s){counter++;return {scene:{},local_state:{counter,secret:m.view,previous:s,io:[typeof fetch,typeof XMLHttpRequest,typeof document]}}}}';
    const result=run(presentationSource(code,message({view:{emoji:'🎲 שלום'}}),null));assert.equal(result.failed,false);
    const parsed=JSON.parse(result.text);assert.equal(parsed.local_state.counter,1);assert.deepEqual(parsed.local_state.secret,{emoji:'🎲 שלום'});
    assert.deepEqual(parsed.local_state.io,['undefined','undefined','undefined']);
    const paths='const gameUI={reduce(){return {scene:{pieces:[]}}},getLastMoveAnimations(view,scene){return view.paths}}';
    const declared:Json=[{piece_id:'disc',path:[{board:'board',position:{x:50,y:0}},{board:'board',position:{cell:'0'}}]}];
    assert.deepEqual(JSON.parse(run(presentationSource(paths,message({view:{paths:declared}}),null)).text).last_move_animations,declared);
    assert.equal(JSON.parse(run(presentationSource(code,message(),null)).text).local_state.counter,1);
    assert.equal(run(presentationSource('const gameUI={reduce(){while(true){}}}',message(),null)).failed,true);
    assert.equal(run(presentationSource('const gameUI={reduce(){return {scene:{},local_state:Math.random()}}}',message(),null)).failed,true);
    assert.equal(run(presentationSource('const gameUI={reduce(){return {scene:{},local_state:Date.now()}}}',message(),null)).failed,true);
    assert.equal(run('let values=[];while(true)values.push(new Array(100000).fill("memory"));JSON.stringify(values)').failed,true);
    const hugeError=run('throw "private diagnostic ".repeat(200000)');
    assert.equal(hugeError.failed,true);
    assert.equal(hugeError.text,'Game error exceeds its size limit');
    assert.ok(Buffer.byteLength(hugeError.text,'utf8')<=500);
    const game={server_code:'const game={newMatch(ctx){return {state:{dice:Math.floor(ctx.random()*6)+1,time:Date.now()},turn:[ctx.players[0].id]}}}',game_schemas:{}};
    const source=rulesSource(game,'newMatch',[],{players:[{id:'player'}]},123,1000),a=run(source),b=run(source);
    assert.equal(a.failed,false);assert.equal(a.text,b.text);assert.equal(JSON.parse(a.text).result.state.time,1000);
  }finally{rmSync(temporary,{recursive:true,force:true});}
});
