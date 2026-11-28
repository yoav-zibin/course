import {test} from 'node:test';
import assert from 'node:assert/strict';
import {animateSceneUpdate,sceneTracks,sceneTransform} from '../src/game/sceneAnimations';
import type {GameSpec,Scene,SceneAnimation,StateMessage} from '../src/game/types';

const spec:GameSpec={format:'buildplay-ui',version:1,viewport:{width:400,height:300},boards:[
  {id:'board',kind:'grid',width:300,height:300,x:20,y:10,rows:3,columns:3},
  {id:'tray',kind:'zone',width:60,height:300,x:340,y:10}],piece_types:{token:{shape:'circle'}},ui_code:''};
const scene:Scene={pieces:[
  {id:'plate',type:'token',board:'board',position:{cell:'0'},rotation:90,scale:2,opacity:.8},
  {id:'marble',type:'token',board:'board',position:{cell:'0'},rotation:90},
]};
const animations:SceneAnimation[]=[
  {piece_id:'plate',key:'turn:1',from:{rotation:0},duration_ms:600},
  {piece_id:'marble',key:'turn:1',from:{rotation:0},duration_ms:600},
];
const message=(move_count:number,extra:Partial<StateMessage>={}):StateMessage=>
  ({type:'state_changed',status:'ongoing',move_count,my_player_index:0,last_move_player_index:0,...extra});

test('parallel rotations use declared starting angles and leave unspecified transforms at final values',()=>{
  const tracks=sceneTracks(spec,scene,animations,new Map());
  assert.equal(tracks.get('plate')!.duration,600);
  assert.equal(tracks.get('marble')!.delay,0);
  assert.deepEqual(sceneTransform(tracks.get('plate')!,0),{x:70,y:60,rotation:0,scale:2,opacity:.8});
  assert.equal(sceneTransform(tracks.get('plate')!,.5).rotation,45);
  assert.equal(sceneTransform(tracks.get('marble')!,.5).rotation,45);
  assert.deepEqual(sceneTransform(tracks.get('plate')!,1),{x:70,y:60,rotation:90,scale:2,opacity:.8});
});

test('cross-board origins, opacity, scale, delay and zero duration are explicit',()=>{
  const tracks=sceneTracks(spec,scene,[{piece_id:'plate',key:'origin',from:{board:'tray',position:{x:5,y:15},rotation:-90,scale:.5,opacity:0},delay_ms:200,duration_ms:0}],new Map());
  const track=tracks.get('plate')!;
  assert.equal(track.delay,200);assert.equal(track.duration,0);
  assert.deepEqual(sceneTransform(track,0),{x:345,y:25,rotation:-90,scale:.5,opacity:0});
  assert.deepEqual(sceneTransform(track,1),{x:70,y:60,rotation:90,scale:2,opacity:.8});
});

test('suppressed initial/reduced-motion keys are consumed and duplicates do not replay',()=>{
  const keys=new Map<string,string>();
  assert.equal(sceneTracks(spec,scene,animations,keys).size,2);
  assert.equal(sceneTracks(spec,scene,animations,keys).size,0);
  assert.equal(sceneTracks(spec,scene,[{...animations[0],key:'turn:2'}],keys).size,1);
  sceneTracks(spec,{},[],keys);assert.equal(keys.size,0);
});

test('explicit accepted transitions allow own actors but skip remounts, jumps, reversals and viewer changes',()=>{
  assert.equal(animateSceneUpdate(message(1),message(2)),true);
  assert.equal(animateSceneUpdate(message(1),message(2,{last_move_player_index:1})),true);
  assert.equal(animateSceneUpdate(message(1),message(2,{my_player_index:1}),true),true);
  for(const previous of [null,message(0),message(2),message(3),message(1,{my_player_index:1}),message(1,{replay:{index:1}})])
    assert.equal(animateSceneUpdate(previous,message(2)),false);
});
