import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMatchHistoryController} from '../src/ui/matchHistory';

function fixture(total=3){
  const calls:(number|null)[]=[],errors:Error[]=[];
  let scope='match-one:account-one:en',ready=true,replayIndex:number|null=null,clock=0;
  let reply:(index:number|null)=>Promise<number|void>=async index=>{
    replayIndex=index;history.onScene(scope,null,{replay:index===null?null:{index}});
    return index===null?undefined:index;
  };
  let delay:(milliseconds:number)=>Promise<void>=async milliseconds=>{clock+=milliseconds;};
  const history=createMatchHistoryController({
    snapshot:()=>({scope,total,replayIndex,ready,replay:async index=>{calls.push(index);return reply(index);}}),
    onChange:()=>{},onError:error=>errors.push(error),wait:milliseconds=>delay(milliseconds),now:()=>clock,
  });
  return {history,calls,errors,scope:()=>scope,setScope:(value:string)=>{scope=value;},setReady:(value:boolean)=>{ready=value;},
    setIndex:(value:number|null)=>{replayIndex=value;history.onScene(scope,null,{replay:value===null?null:{index:value}});},
    setReply:(value:typeof reply)=>{reply=value;},setDelay:(value:typeof delay)=>{delay=value;},advance:(milliseconds:number)=>{clock+=milliseconds;}};
}

test('fresh boards disable empty history and live end controls; forward and end restore live play',async()=>{
  const empty=fixture(0);
  assert.deepEqual(empty.history.state(),{atStart:true,atEnd:true,playing:false,disabled:true,position:0,total:0});
  await empty.history.seek('previous');await empty.history.playPause();assert.deepEqual(empty.calls,[]);
  const f=fixture();
  assert.equal(f.history.state().atEnd,true);
  await f.history.seek('next');await f.history.seek('end');assert.deepEqual(f.calls,[]);
  await f.history.seek('start');assert.equal(f.history.state().atStart,true);
  await f.history.seek('start');await f.history.seek('previous');assert.deepEqual(f.calls,[0]);
  await f.history.seek('next');await f.history.seek('end');assert.deepEqual(f.calls,[0,1,null]);
  await f.history.seek('previous');assert.equal(f.history.state().position,2);
  await f.history.seek('next');assert.deepEqual(f.calls,[0,1,null,2,null]);
  assert.equal(f.history.state().atEnd,true);assert.equal(f.errors.length,0);
});

test('one in-flight request blocks repeated transport presses until it finishes',async()=>{
  const f=fixture();let complete!:(index:number)=>void;
  f.setReply(()=>new Promise<number>(resolve=>{complete=resolve;}));
  const pending=f.history.seek('previous');
  assert.equal(f.history.state().disabled,true);
  await f.history.seek('start');await f.history.seek('end');await f.history.playPause();
  assert.deepEqual(f.calls,[2]);complete(2);await pending;
  assert.equal(f.history.state().disabled,false);
});

test('autoplay from live restarts at the beginning, waits for motion, then returns to the live board',async()=>{
  const f=fixture(2);let waits=0;
  f.setDelay(async milliseconds=>{
    f.advance(milliseconds);waits++;
    if(milliseconds===40)f.history.onAnimationStateChange(f.scope(),false);
  });
  f.setReply(async index=>{
    f.setIndex(index);f.history.onAnimationStateChange(f.scope(),index!==null);
    return index===null?undefined:index;
  });
  await f.history.playPause();
  assert.deepEqual(f.calls,[0,1,2,null]);assert.ok(waits>=6);
  assert.deepEqual(f.history.state(),{atStart:false,atEnd:true,playing:false,disabled:false,position:2,total:2});
  assert.deepEqual(f.errors,[]);
});

test('autoplay continues a paused frame and pause cancels without another replay request',async()=>{
  const f=fixture();f.setIndex(1);
  let resume!:()=>void,reached!:()=>void;
  const waiting=new Promise<void>(resolve=>{reached=resolve;});
  f.setDelay(()=>new Promise<void>(resolve=>{resume=resolve;reached();}));
  const playback=f.history.playPause();
  await waiting;
  assert.equal(f.history.state().playing,true);
  assert.deepEqual(f.calls,[1]);
  await f.history.playPause();resume();await playback;
  assert.equal(f.history.state().playing,false);assert.deepEqual(f.calls,[1]);
});

test('changing match, account or locale while loading a frame cannot advance the new board',async()=>{
  for(const nextScope of ['match-two:account-one:en','match-one:account-two:en','match-one:account-one:fr']){
    const f=fixture();let complete!:(index:number)=>void;
    f.setReply(()=>new Promise<number>(resolve=>{complete=resolve;}));
    const playback=f.history.playPause();assert.deepEqual(f.calls,[0]);
    f.setScope(nextScope);assert.equal(f.history.state().playing,false);assert.equal(f.history.state().disabled,false);
    complete(0);await playback;assert.deepEqual(f.calls,[0]);
    assert.deepEqual(f.errors,[]);
  }
});

test('missing renderer frames time out once without an unhandled rejection, and unavailable boards stay disabled',async()=>{
  const f=fixture();
  f.setReply(async index=>index===null?undefined:index);
  await f.history.playPause();
  assert.equal(f.errors.length,1);assert.match(f.history.error()!,/history frame could not finish rendering/);
  assert.equal(f.history.state().playing,false);assert.deepEqual(f.calls,[0]);
  f.setReady(false);await f.history.seek('previous');await f.history.playPause();
  assert.equal(f.history.state().disabled,true);assert.deepEqual(f.calls,[0]);
});

test('unmounting or a superseded core request stops playback without restoring a different live board',async()=>{
  const f=fixture();let complete!:(index:number)=>void;
  f.setReply(()=>new Promise<number>(resolve=>{complete=resolve;}));
  const playback=f.history.playPause();f.history.dispose();complete(0);await playback;
  assert.deepEqual(f.calls,[0]);
  const superseded=fixture();superseded.setReply(async()=>undefined);
  await superseded.history.playPause();assert.deepEqual(superseded.calls,[0]);assert.equal(superseded.history.state().playing,false);
});

test('a private handoff appearing during playback cancels the loop before advancing again',async()=>{
  const f=fixture();
  f.setDelay(async()=>{f.setReady(false);});
  await f.history.playPause();
  assert.deepEqual(f.calls,[0]);assert.equal(f.history.state().playing,false);assert.equal(f.history.state().disabled,true);
});

test('an unavailable legacy initial frame cannot leave the latest board stuck in replay',async()=>{
  const f=fixture(1);
  f.setReply(async index=>{f.setIndex(index===0?1:index);return index===null?undefined:index===0?1:index;});
  await f.history.seek('previous');
  assert.deepEqual(f.calls,[0,null]);assert.equal(f.history.state().atEnd,true);assert.equal(f.history.state().disabled,true);
  await f.history.seek('start');await f.history.seek('previous');await f.history.playPause();
  assert.deepEqual(f.calls,[0,null]);
});

test('a learned legacy first frame disables no-op backward controls and becomes the playback start',async()=>{
  const f=fixture(3);
  f.setReply(async index=>{const actual=index===0?1:index;f.setIndex(actual);return actual===null?undefined:actual;});
  await f.history.seek('start');
  assert.equal(f.history.state().position,1);assert.equal(f.history.state().atStart,true);assert.equal(f.history.state().disabled,false);
  await f.history.seek('previous');await f.history.seek('start');assert.deepEqual(f.calls,[0]);
  await f.history.seek('end');await f.history.playPause();
  assert.deepEqual(f.calls,[0,null,1,2,3,null]);assert.equal(f.history.state().atEnd,true);
  f.setScope('another-match');f.history.state();await f.history.seek('start');
  assert.equal(f.calls.at(-1),0);
});
