import assert from 'node:assert/strict';
import test from 'node:test';
import {diagnosticSnapshot} from '../src/core/diagnostics';
import {createDragFrames} from '../src/core/dragFrames';

test('drag frames coalesce burst input and include only timing in the final diagnostic',()=>{
  let now=0, nextId=0;
  const callbacks=new Map<number,()=>void>();
  const drag=createDragFrames<string>('game_piece',()=>now,callback=>{
    callbacks.set(++nextId,callback);
    return nextId;
  },id=>{callbacks.delete(id);});
  const drawn:string[]=[];
  const draw=(position:string)=>{drawn.push(position);now+=2;};
  const frame=(at:number)=>{
    now=at;
    const [id,callback]=[...callbacks][0];
    callbacks.delete(id);
    callback();
  };
  drag.move('first position',draw);
  now=4;
  drag.move('latest position',draw);
  assert.equal(callbacks.size,1);
  frame(16);
  now=20;
  drag.move('next position',draw);
  frame(55);
  drag.move('cancelled position',draw);
  drag.finish('released');
  assert.equal(callbacks.size,0);
  assert.deepEqual(drawn,['latest position','next position']);
  const events=diagnosticSnapshot().events as {name:string;metadata:object}[];
  assert.deepEqual(events.filter(event=>event.name==='drag_performance').map(event=>event.metadata),[{
    surface:'game_piece',outcome:'released',input_events:4,js_updates:2,gaps_over_34ms:1,
    duration_ms:57,max_js_gap_ms:39,max_schedule_wait_ms:35,max_update_work_ms:2,
  }]);
});

test('native control motion does not wait for a JavaScript animation callback',()=>{
  let now=0;
  const drag=createDragFrames<number>('floating_controls',()=>now,()=>{
    assert.fail('an immediate transform must not request an animation callback');
  });
  const drawn:number[]=[];
  drag.moveImmediately(10,value=>drawn.push(value));
  now=16;
  drag.moveImmediately(12,value=>drawn.push(value));
  assert.deepEqual(drawn,[10,12]);
  drag.finish('released');
  const events=diagnosticSnapshot().events as {name:string;metadata:{surface:string;js_updates:number;max_schedule_wait_ms:number}}[];
  const trace=events.find(event=>event.name==='drag_performance'&&event.metadata.surface==='floating_controls');
  assert.equal(trace?.metadata.js_updates,2);
  assert.equal(trace?.metadata.max_schedule_wait_ms,0);
});
