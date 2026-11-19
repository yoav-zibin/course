import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBugGestureProtection,type BugGestureProtectionResult} from '../src/ui/bugGestureProtection';

function scheduler(){
  const tasks:{phase:'frame'|'timer';callback:()=>void;cancelled:boolean}[]=[];
  const queue=(phase:'frame'|'timer')=>(callback:()=>void)=>{
    const task={phase,callback,cancelled:false};tasks.push(task);return()=>{task.cancelled=true;};
  };
  return {
    afterFrame:queue('frame'),later:queue('timer'),
    async next(){
      let task=tasks.shift();while(task?.cancelled)task=tasks.shift();
      if(!task)return false;
      task.callback();await Promise.resolve();await Promise.resolve();return task.phase;
    },
  };
}

test('native registration waits for frames and retries a missing or unmounted view',async()=>{
  const clock=scheduler(),results:BugGestureProtectionResult[]=[],calls:number[]=[];
  let tag:number|null=null;
  const registration=createBugGestureProtection({...clock,getTag:()=>tag,
    protect:async value=>{calls.push(value);return calls.length>1;},onResult:value=>results.push(value)});
  registration.register();assert.deepEqual(calls,[]);
  assert.equal(await clock.next(),'frame'); // The ref has not mounted yet.
  tag=42;
  while(await clock.next()){}
  assert.deepEqual(calls,[42,42]);
  assert.deepEqual(results,[{protected:true,attempts:3,reason:'protected'}]);
});

test('an unavailable native module or native error stops after eight attempts',async()=>{
  for(const fail of [false,true]){
    const clock=scheduler(),results:BugGestureProtectionResult[]=[];let calls=0;
    const registration=createBugGestureProtection({...clock,getTag:()=>42,
      protect:async()=>{calls++;if(fail)throw new Error('View not mounted');return false;},onResult:value=>results.push(value)});
    registration.register();while(await clock.next()){}
    assert.equal(calls,8);
    assert.deepEqual(results,[{protected:false,attempts:8,reason:fail?'native_error':'not_ready'}]);
  }
});

test('a replaced host tag cannot satisfy a later registration',async()=>{
  const clock=scheduler(),results:BugGestureProtectionResult[]=[],calls:number[]=[];
  let tag=42,resolveFirst:(ready:boolean)=>void=()=>{};
  const registration=createBugGestureProtection({...clock,getTag:()=>tag,
    protect:value=>{calls.push(value);return value===42?new Promise(resolve=>{resolveFirst=resolve;}):Promise.resolve(true);},
    onResult:value=>results.push(value)});
  registration.register();await clock.next();tag=43;
  resolveFirst(true);await Promise.resolve();await Promise.resolve();
  assert.deepEqual(results,[]);
  while(await clock.next()){}
  assert.deepEqual(calls,[42,43]);
  assert.deepEqual(results,[{protected:true,attempts:2,reason:'protected'}]);
});

test('new layouts and disposal cancel obsolete callbacks and in-flight results',async()=>{
  const clock=scheduler(),results:BugGestureProtectionResult[]=[];let calls=0,resolveFirst:(ready:boolean)=>void=()=>{};
  const registration=createBugGestureProtection({...clock,getTag:()=>42,
    protect:()=>{calls++;return new Promise(resolve=>{resolveFirst=resolve;});},onResult:value=>results.push(value)});
  registration.register();registration.register();await clock.next();assert.equal(calls,1);
  registration.dispose();resolveFirst(false);await Promise.resolve();await Promise.resolve();
  assert.equal(await clock.next(),false);assert.deepEqual(results,[]);
  registration.register();assert.equal(await clock.next(),false);
});
