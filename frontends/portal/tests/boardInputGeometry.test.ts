import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boardHit,boardInputGeometry,projectCanvas,projectPiece,scenePoint,tapChoice} from '../src/game/boardInputGeometry';
import type {GameSpec,Scene} from '../src/game/types';

const spec:GameSpec={
  format:'buildplay-ui',version:1,viewport:{width:200,height:200},
  boards:[{id:'board',kind:'free',width:200,height:200}],
  piece_types:{token:{shape:'rect',width:40,height:20},group:{shape:'group',width:2,height:2}},
  ui_code:'fixture',
};

const scene:Scene={
  pieces:[
    {id:'source',type:'group',board:'board',position:{x:20,y:50},actions:[],move_targets:['line','destination']},
    {id:'member',parent:'source',type:'token',board:'board',position:{x:50,y:50},rotation:90,actions:[],move_targets:['line','destination']},
    {id:'occupied',type:'token',board:'board',position:{x:100,y:100}},
  ],
  targets:[
    {id:'line',board:'board',position:{x:0,y:0},hit_shape:{kind:'line',from:{x:4,y:20},to:{x:196,y:20},width:8}},
    {id:'destination',board:'board',position:{x:100,y:100},hit_area:{x:-10,y:-10,width:20,height:20}},
    {id:'other',board:'board',position:{x:100,y:100},hit_area:{x:-10,y:-10,width:20,height:20}},
  ],
};
const geometry=boardInputGeometry(spec,scene,new Map());

test('native hit geometry selects a rotated group member and prefers a selected legal target over an occupant',()=>{
  const member=boardHit(geometry,{x:50,y:67},null,true);
  assert.equal(member.piece?.id,'source');
  assert.equal(boardHit(geometry,{x:67,y:50},null,true).piece,undefined);

  const at={x:100,y:100};
  const selected=boardHit(geometry,at,'source',true);
  assert.equal(selected.piece?.id,'occupied');
  assert.equal(selected.target?.id,'destination');
  assert.deepEqual(tapChoice(selected,selected,'source'),{kind:'target',id:'destination'});
  const unselected=boardHit(geometry,at,null,true);
  assert.deepEqual(tapChoice(unselected,unselected,null),{kind:'piece',id:'occupied'});
  assert.equal(tapChoice(selected,boardHit(geometry,{x:180,y:180},'source',true),'source'),undefined);
});

test('native drop projection fits the SVG view and snaps lifted artwork to an eligible shape',()=>{
  const canvas=projectCanvas(300,200,{x:0,y:0,width:200,height:200});
  assert.deepEqual(scenePoint(canvas,{x:50,y:0}),{x:0,y:0});
  const piece=geometry.pieces.source;
  const touch=projectPiece(canvas,{x:150,y:46},{x:0,y:0},piece,true);
  assert.equal(touch.target?.id,'line');
  assert.equal(touch.x,-20);
  assert.equal(touch.y,-50);
  assert.equal(projectPiece(canvas,{x:150,y:100},{x:0,y:0},piece,false).target?.id,'destination');
});

test('full-frame landscape maps touch and drop coordinates on both axes',()=>{
  const canvas=projectCanvas(800,400,{x:0,y:0,width:200,height:200},true);
  const offCenter={x:200,y:40};
  assert.deepEqual(scenePoint(canvas,offCenter),{x:50,y:20});
  assert.equal(projectPiece(canvas,offCenter,{x:0,y:0},geometry.pieces.source,false).target?.id,'line');
  const point=scenePoint(canvas,{x:400,y:200});
  assert.deepEqual(point,{x:100,y:100});
  assert.equal(boardHit(geometry,point,'source',true).target?.id,'destination');
  assert.equal(projectPiece(canvas,{x:400,y:200},{x:0,y:0},geometry.pieces.source,false).target?.id,'destination');
});
