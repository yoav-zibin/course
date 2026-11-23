import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {compileTimeline, inferredGroupTracks, resolveScene} from '../src/game/composition';
import {hitPiece, pieceName, validEvent} from '../src/game/interactions';
import {pieceAnimation} from '../src/game/pieceAnimations';
import {position, validateScene, validateSpec, validateTimeline} from '../src/game/validation';
import type {GameSpec, Piece, Scene, Timeline} from '../src/game/types';

const spec:GameSpec={format:'buildplay-ui',version:1,viewport:{width:600,height:600},
  boards:[{id:'board',kind:'free',x:10,y:20,width:500,height:500}],
  piece_types:{plate:{shape:'group'},card:{shape:'card',width:10,height:10},pile:{shape:'card_pile'}},
  motion:{easing:'ease-in-out-quad'},ui_code:'const gameUI={reduce(){return {scene:{}}}}'};
const plate:Piece={id:'plate',board:'board',type:'plate',position:{x:100,y:100},rotation:90,actions:['rotate']};
const card:Piece={id:'card',board:'board',type:'card',parent:'plate',position:{x:40,y:0},actions:[]};
const after:Scene={pieces:[plate,card]},before:Scene={pieces:[{...plate,rotation:0},card]};
const close=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);

test('a nested reflected group rotates around its pivot and actions belong to the root',()=>{
  const root={...plate,pivot:{x:10,y:0},scale:2,mirror_x:true,opacity:.5};
  const nested={...card,rotation:90,opacity:.4};
  const tip={...card,id:'tip',parent:'card',position:{x:5,y:0}};
  const scene=resolveScene(spec,{pieces:[root,nested,tip]});
  const leaf=scene.pieces![2], at=position(spec,leaf);
  close(at.x,100);close(at.y,60);close(leaf.rotation!,0);close(leaf.opacity!,.2);
  assert.equal(leaf.mirror_x,true);assert.equal(hitPiece(spec,scene,at)?.id,'plate');
  const hidden=resolveScene(spec,{pieces:[{...root,hidden:true},nested,tip]});
  assert.equal(hitPiece(spec,hidden,at),undefined);
});

test('children follow a circular arc in explicit, inferred and reverse motion',()=>{
  const timeline={key:'turn',steps:[[{piece_id:'plate',from:{rotation:0},duration_ms:600}]]};
  const expected=40/Math.sqrt(2);
  for(const tracks of [compileTimeline(spec,before,after,timeline).tracks,
      compileTimeline(spec,before,after,timeline,true).tracks,inferredGroupTracks(spec,before,after)]) {
    const mid=tracks.get('card')!.sample!(.5);
    close(mid.x,110+expected);close(mid.y,120+expected);close(mid.rotation,45);
  }
});

test('parallel clips share a clock, later keyframes hold during gaps, and exits use filtered artwork',()=>{
  const old={...card,id:'old',parent:undefined,face:'back' as const,text:'private'};
  const timeline:Timeline={key:'deal',steps:[
    [{piece_id:'plate',from:{rotation:0},to:{rotation:45},duration_ms:100,z:30},
     {piece_id:'old',exit:true,duration_ms:200}],
    [{piece_id:'plate',delay_ms:100,duration_ms:100,z:50}]]};
  const start={pieces:[...before.pieces!,old]};
  const plan=compileTimeline(spec,start,after,timeline),turn=plan.tracks.get('card')!;
  assert.equal(plan.duration,400);assert.deepEqual(plan.ghosts.map(p=>pieceName(p)),['Covered piece']);
  close(turn.sample!(.6).rotation,45);close(turn.sample!(1).rotation,90);
  close(plan.tracks.get('old')!.sample!(.5).opacity,.5);
  for(const [elapsed,active,z] of [[50,true,30],[150,false,0],[320,true,50]] as const){
    const m=pieceAnimation(spec,card,card,{animate:true,sceneTrack:turn,elapsed});
    assert.equal(m.layerActive,active);if(active)assert.equal(m.z,z);
  }
  assert.equal(compileTimeline(spec,before,after,timeline).tracks.has('old'),false);
  const reverse=compileTimeline(spec,start,after,timeline,true);
  assert.equal(reverse.tracks.get('old')!.delay,200);close(reverse.tracks.get('old')!.sample!(1).opacity,1);
});

test('rows center independently and number, scale and text events respect contract limits',()=>{
  const base={...plate,rotation:0,position:{x:30,y:40}};
  const cards=[0,1,2,3,4].map(index=>({...base,hand:{index,count:5,columns:3,spacing:10,row_spacing:15}}));
  assert.deepEqual(cards.map(p=>{const {x,y}=position(spec,p);return [x,y]}),[[30,60],[40,60],[50,60],[35,75],[45,75]]);
  const scene:Scene={controls:[{id:'n',kind:'number',label:'Value',min:.1,step:.2,max:.9},{id:'t',kind:'text',label:'Name'}],
    pieces:[{...plate,actions:['scale']}]};
  const number=(value:number)=>validEvent(scene,{id:'n',type:'change',value});
  assert.ok(number(.3));assert.ok(!number(.4));assert.ok(!number(.10000000001));assert.ok(!number(1.1));
  assert.ok(validEvent(scene,{type:'scale',id:'plate',factor:100}));assert.ok(!validEvent(scene,{type:'scale',id:'plate',factor:101}));
  assert.ok(validEvent(scene,{type:'change',id:'t',value:'😀'.repeat(4000)}));
  assert.ok(!validEvent(scene,{type:'change',id:'t',value:'😀'.repeat(4001)}));
});

const cases=JSON.parse(readFileSync(resolve(__dirname,'../../../tests/fixtures/declarative/composition-validation.json'),'utf8'));
for(const c of cases) test('portable contract: '+c.name,()=>{
  const check=()=>{validateScene(spec,c.scene);if(c.timeline)validateTimeline(spec,c.scene,c.timeline);};
  if(c.valid)assert.doesNotThrow(check);else assert.throws(check);
});


test('host rejects ambiguous board IDs, unsupported shapes, and unresolved artwork',()=>{
  for(const value of [
    {...spec,boards:[spec.boards[0],spec.boards[0]]},
    {...spec,piece_types:{tile:{shape:'square'}}},
    {...spec,piece_types:{tile:{shape:'card',asset:'missing'}}},
    {...spec,boards:[{...spec.boards[0],background_asset:'missing'}]},
    {...spec,boards:[{...spec.boards[0],kind:'track',cells:[]}]},
    {...spec,viewport:{width:100001,height:100}}
  ]) assert.throws(()=>validateSpec(value));
});
