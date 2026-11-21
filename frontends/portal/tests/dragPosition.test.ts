import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dragPosition} from '../src/game/dragPosition';

test('touch artwork hovers above the finger and all four canvas edges remain reachable',()=>{
  const size={width:48,height:48},canvas={width:390,height:600};
  assert.ok(dragPosition({x:195,y:300},{x:0,y:0},size,canvas,true).y<270);
  for(const touch of [false,true])for(const grab of [{x:0,y:0},{x:20,y:18},{x:-20,y:-18}]){
    let previousX=-1,previousY=-1;
    for(let fraction=0;fraction<=100;fraction++){
      const x=canvas.width*fraction/100,y=canvas.height*fraction/100;
      const at=dragPosition({x,y},grab,size,canvas,touch);
      assert.ok(at.x>=previousX&&at.y>=previousY,'edge compensation must not reverse a drag');
      assert.ok(at.x>=0&&at.x<=canvas.width&&at.y>=0&&at.y<=canvas.height);
      previousX=at.x;previousY=at.y;
    }
    assert.deepEqual(dragPosition({x:0,y:0},grab,size,canvas,touch),{x:0,y:0});
    assert.deepEqual(dragPosition({x:390,y:600},grab,size,canvas,touch),{x:390,y:600});
  }
});

test('mouse dragging preserves the grab point without applying finger lift',()=>{
  assert.deepEqual(dragPosition({x:200,y:300},{x:0,y:0},{width:50,height:50},{width:500,height:600},false),{x:200,y:300});
  assert.deepEqual(dragPosition({x:200,y:300},{x:18,y:-12},{width:50,height:50},{width:500,height:600},false),{x:218,y:288});
});
