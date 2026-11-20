import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { animateLastMove, moveTracks, trackPosition } from '../src/game/moveAnimations';
import { presentationSource } from '../src/game/runtimeSource';
import type { GameSpec, StateMessage } from '../src/game/types';

const spec: GameSpec = {format:'buildplay-ui', version:1, viewport:{width:400,height:300},
  boards:[{id:'main',kind:'zone',width:300,height:300,x:20,y:10},
    {id:'off',kind:'zone',width:60,height:300,x:340,y:10}],piece_types:{},ui_code:''};
const at = (x:number,y:number,board='main') => ({board,position:{x,y}});
const message = (move_count:number, extra:Partial<StateMessage> = {}):StateMessage =>
  ({type:'state_changed',status:'ongoing',move_count,my_player_index:0,last_move_player_index:1,...extra});

test('declared paths preserve sequential checker moves, waypoints, waits and cross-board coordinates',()=>{
  const tracks = moveTracks(spec,[
    {piece_id:'a',path:[at(10,20),at(30,20),at(30,40)],duration_ms:200},
    {piece_id:'b',path:[at(70,80),at(5,80,'off')],duration_ms:100},
    {piece_id:'a',path:[at(30,40),at(30,60)],duration_ms:100},
  ]);
  const a = tracks.get('a')!, b = tracks.get('b')!;
  assert.equal(a.duration,400);
  assert.deepEqual(trackPosition(a,0),{x:30,y:30});
  assert.deepEqual(trackPosition(a,100),{x:50,y:30});
  assert.deepEqual(trackPosition(a,200),{x:50,y:50});
  assert.deepEqual(trackPosition(a,275),{x:50,y:50});
  assert.deepEqual(trackPosition(a,400),{x:50,y:70});
  assert.deepEqual(trackPosition(b,0),{x:90,y:90});
  assert.deepEqual(trackPosition(b,199),{x:90,y:90});
  assert.deepEqual(trackPosition(b,300),{x:345,y:90});
  assert.deepEqual(trackPosition(b,400),{x:345,y:90});
});

test('fall paths never drift horizontally and zero-duration steps settle',()=>{
  const tracks=moveTracks(spec,[{piece_id:'disc',path:[at(150,-25),at(150,275)],duration_ms:600}]);
  for(const time of [0,1,100,300,599,600,700])assert.equal(trackPosition(tracks.get('disc')!,time).x,170);
  const instant=moveTracks(spec,[{piece_id:'disc',path:[at(0,0),at(10,10)],duration_ms:0}]);
  assert.deepEqual(trackPosition(instant.get('disc')!,0),{x:30,y:20});
});

test('game paths animate known opponent actors only on consecutive forward snapshots',()=>{
  assert.equal(animateLastMove(message(1),message(2)),true);
  assert.equal(animateLastMove(message(1),message(2,{last_move_player_index:0})),false);
  for(const previous of [null,message(0),message(2),message(3),message(1,{replay:{index:1}}),message(1,{my_player_index:1})])
    assert.equal(animateLastMove(previous,message(2)),false);
  for(const actor of [null,undefined])assert.equal(animateLastMove(message(1),message(2,{last_move_player_index:actor})),false);
  assert.equal(animateLastMove(message(1,{my_player_index:null}),message(2,{my_player_index:null})),true);
  assert.equal(animateLastMove(message(1,{replay:{index:1}}),message(2,{replay:{index:2},last_move_player_index:0})),false);
  assert.equal(animateLastMove(message(1,{replay:{index:1}}),message(2,{replay:{index:2}})),true);
});

test('isolated presentation invokes the optional hook with filtered view and final scene only for accepted snapshots',()=>{
  const code=`const gameUI={reduce(){return {scene:{pieces:[]},local_state:{selection:1}};},
    getLastMoveAnimations(view,scene){return [{piece_id:view.publicId,path:scene.pieces}];}};`;
  const next=message(2,{view:{publicId:'public-disc'}});
  const run=(code:string,input:unknown)=>JSON.parse(runInNewContext(presentationSource(code,input,null)));
  assert.deepEqual(run(code,next).last_move_animations,[{piece_id:'public-disc',path:[]}]);
  assert.equal(run(code,{type:'ui_event',event:{type:'tap',id:'a'},state_changed:next}).last_move_animations,undefined);
  assert.equal(run('const gameUI={reduce(){return {scene:{}}}};',next).last_move_animations,undefined);
  assert.equal(run('const gameUI={reduce(){return {scene:{}}},getLastMoveAnimations(){return null}};',next).last_move_animations,null);
  assert.deepEqual(run('const gameUI={reduce(){return {scene:{}}},getLastMoveAnimations(){return []}};',next).last_move_animations,[]);
});
