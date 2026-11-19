import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BUG_HEIGHT,BUG_WIDTH,bugBounds,clampBugPoint,isBugDrag,normalizedBugPoint,resolveBugPoint} from '../src/ui/bugPosition';

test('a floating bug control starts inside the safe top-left corner and clamps every edge',()=>{
  const bounds=bugBounds(390,797,{top:44,right:0,bottom:34,left:0});
  assert.deepEqual(resolveBugPoint(null,bounds),{x:5,y:46});
  assert.deepEqual(clampBugPoint({x:-200,y:-100},bounds),{x:5,y:46});
  const edge=clampBugPoint({x:900,y:1200},bounds);
  assert.equal(edge.x+BUG_WIDTH,385);
  assert.equal(edge.y+BUG_HEIGHT,761);
});

test('a moved control stays in view across orientation, keyboard and modal viewport changes',()=>{
  const portrait=bugBounds(390,797,{top:44,right:0,bottom:34,left:0});
  const saved=normalizedBugPoint({x:1000,y:1000},portrait);
  assert.deepEqual(saved,{x:1,y:1});
  for(const [width,height] of [[844,390],[320,250]]){
    const bounds=bugBounds(width,height,{top:24,right:16,bottom:21,left:16});
    const point=resolveBugPoint(saved,bounds);
    assert.ok(point.x>=16&&point.y>=24);
    assert.ok(point.x+BUG_WIDTH<=width-16&&point.y+BUG_HEIGHT<=height-21);
  }
  const visual=bugBounds(320,250,{top:0,right:0,bottom:0,left:0},{x:35,y:60});
  assert.deepEqual(resolveBugPoint(null,visual),{x:40,y:62});
});

test('minor tap movement does not become a drag and collapsed bounds do not produce NaN',()=>{
  assert.equal(isBugDrag(2,3),false);
  assert.equal(isBugDrag(4,4),true);
  const bounds=bugBounds(36,32,{top:44,right:20,bottom:34,left:20});
  assert.deepEqual(normalizedBugPoint({x:200,y:400},bounds),{x:0,y:0});
  assert.deepEqual(resolveBugPoint({x:1,y:1},bounds),{x:0,y:0});
});
