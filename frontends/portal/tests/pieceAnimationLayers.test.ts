import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pieceAnimation,DEFAULT_ANIMATION_Z} from '../src/game/pieceAnimations';
import {moveTracks} from '../src/game/moveAnimations';
import {sceneTracks} from '../src/game/sceneAnimations';
import {validateScene,validateMoveAnimations,validateSceneAnimations} from '../src/game/validation';
import {hitPiece} from '../src/game/interactions';
import type {GameSpec,Piece} from '../src/game/types';

const spec:GameSpec={format:'buildplay-ui',version:1,viewport:{width:300,height:300},
  boards:[{id:'main',kind:'zone',x:0,y:0,width:300,height:300}],
  piece_types:{token:{shape:'circle',width:30,height:30}},ui_code:''};
const from:Piece={id:'token',type:'token',board:'main',position:{x:10,y:20},z:1};
const to:Piece={...from,position:{x:150,y:20}};
const path=[{board:'main',position:{x:10,y:20}},{board:'main',position:{x:150,y:20}}];

test('legacy movement raises during playback and respects explicit zero and custom animation layers',()=>{
  assert.equal(pieceAnimation(spec,to,from,{animate:true}).z,DEFAULT_ANIMATION_Z);
  assert.equal(pieceAnimation(spec,to,from,{animate:false}).needsAnimation,false);
  const moves=moveTracks(spec,[{piece_id:'token',path,z:0}]);
  assert.equal(pieceAnimation(spec,to,from,{animate:true,moveTrack:moves.get('token')}).z,0);
  const explicit=sceneTracks(spec,{pieces:[to]},[{piece_id:'token',key:'one',from:{position:from.position},z:999999}],new Map());
  assert.equal(pieceAnimation(spec,to,from,{animate:true,sceneTrack:explicit.get('token')}).z,999999);
  const roll:Piece={...from,animation:{kind:'roll',key:'roll:2',z:-4}};
  assert.equal(pieceAnimation(spec,roll,from,{animate:true}).z,-4);
  assert.equal(pieceAnimation(spec,roll,roll,{animate:true}).needsAnimation,false,'a repeated roll does not raise again');
});

test('all animation contracts accept bounded layers without adding a field to older entries',()=>{
  for(const z of [-1000000,0,1000000]){
    assert.doesNotThrow(()=>validateScene(spec,{pieces:[{...to,animation:{kind:'roll',key:'a',z}}]}));
    assert.doesNotThrow(()=>validateMoveAnimations(spec,{pieces:[to]},[{piece_id:'token',path,z}]));
    assert.doesNotThrow(()=>validateSceneAnimations(spec,{pieces:[to]},[{piece_id:'token',key:'a',from:{rotation:0},z}]));
  }
  const legacy=[{piece_id:'token',path}];
  assert.equal(validateMoveAnimations(spec,{pieces:[to]},legacy),legacy);
  assert.equal(Object.hasOwn(legacy[0],'z'),false);
  for(const z of [-1000001,1000001,true,null,'5',Infinity,NaN]){
    assert.throws(()=>validateScene(spec,{pieces:[{...to,animation:{kind:'roll',key:'a',z}}]}));
    assert.throws(()=>validateMoveAnimations(spec,{pieces:[to]},[{piece_id:'token',path,z}]));
    assert.throws(()=>validateSceneAnimations(spec,{pieces:[to]},[{piece_id:'token',key:'a',from:{rotation:0},z}]));
  }
});

test('only the active sequential segment is raised, with each repeated path keeping its own z',()=>{
  const a={...to,id:'a'},b={...to,id:'b'};
  const tracks=moveTracks(spec,[
    {piece_id:'a',path,duration_ms:100,z:900000},
    {piece_id:'b',path,duration_ms:100},
    {piece_id:'a',path:[path[1],path[0]],duration_ms:100,z:-10},
  ]);
  const motion=(piece:Piece,elapsed:number)=>pieceAnimation(spec,piece,from,{animate:true,moveTrack:tracks.get(piece.id),elapsed});
  assert.equal(motion(a,0).layerActive,true);
  assert.equal(motion(a,0).z,900000);
  assert.equal(motion(b,0).layerActive,false);
  assert.equal(motion(b,0).layerTransition,100);
  assert.equal(motion(a,100).layerActive,false);
  assert.equal(motion(a,100).layerTransition,200);
  assert.equal(motion(b,100).layerActive,true);
  assert.equal(motion(b,100).z,DEFAULT_ANIMATION_Z);
  assert.equal(motion(a,200).layerActive,true);
  assert.equal(motion(a,200).z,-10);
  assert.equal(motion(b,200).layerActive,false);
  assert.equal(motion(a,300).layerActive,false);
  assert.equal(motion(a,300).layerTransition,Infinity);
});

test('parallel scene animations stay in their resting layers during delay and after their own end',()=>{
  const tracks=sceneTracks(spec,{pieces:[to]},[{piece_id:'token',key:'delayed',from:{rotation:0},duration_ms:100,delay_ms:80,z:800000}],new Map());
  const motion=(elapsed:number)=>pieceAnimation(spec,to,from,{animate:true,sceneTrack:tracks.get('token'),elapsed});
  assert.equal(motion(0).layerActive,false);
  assert.equal(motion(0).layerTransition,80);
  assert.equal(motion(80).layerActive,true);
  assert.equal(motion(80).z,800000);
  assert.equal(motion(80).layerTransition,180);
  assert.equal(motion(180).layerActive,false);
});

test('pointer hits follow temporary painter order while legacy callers retain static stacking',()=>{
  const low:Piece={...from,id:'low',actions:['tap'],z:1};
  const high:Piece={...from,id:'high',actions:['tap'],z:10};
  const scene={pieces:[low,high]},at={x:10,y:20};
  assert.equal(hitPiece(spec,scene,at)?.id,'high');
  assert.equal(hitPiece(spec,scene,at,new Map([['low',1],['high',0]]))?.id,'low');
  assert.equal(hitPiece(spec,scene,at,new Map([['low',0],['high',1]]))?.id,'high');
  assert.equal(hitPiece(spec,scene,at,new Map([['low',1]]))?.id,'high','an incomplete paint map uses one consistent static comparator');
  const hidden:Piece={...from,id:'hidden',actions:['tap'],hidden:true,z:5};
  for(const pieces of [[low,hidden,high],[hidden,high,low],[high,low,hidden]])
    assert.equal(hitPiece(spec,{pieces},at,new Map([['low',1],['high',0]]))?.id,'low');
});
