import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exclusive} from '../src/platform/storage';

function deferred() {
  let resolve!:()=>void;
  const promise=new Promise<void>(done=>{resolve=done;});
  return {promise,resolve};
}

function browserLocks() {
  const tails=new Map<string,Promise<unknown>>();
  return {request<T>(name:string,run:()=>T|Promise<T>):Promise<T> {
    const previous=tails.get(name)||Promise.resolve();
    const next=previous.then(run,run);
    tails.set(name,next.catch(()=>{}));
    return next;
  }};
}

async function withBrowser(run:(locks:ReturnType<typeof browserLocks>)=>Promise<void>) {
  const original=Object.getOwnPropertyDescriptor(globalThis,'navigator'),locks=browserLocks();
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks}});
  try {await run(locks);}
  finally {if(original)Object.defineProperty(globalThis,'navigator',original);else Reflect.deleteProperty(globalThis,'navigator');}
}

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('a legacy Portal write completes before shared quota recovery can edit its cache',async()=>{
  await withBrowser(async locks=>{
    const entered=deferred(),release=deferred(),events:string[]=[];
    const legacy=locks.request('playroom-portal',async()=>{events.push('legacy starts');entered.resolve();await release.promise;events.push('legacy commits');});
    await entered.promise;
    const recovery=exclusive('buildplay.shared.v1.alice',async()=>{events.push('shared recovery');});
    await flush();
    try {assert.deepEqual(events,['legacy starts']);}
    finally {release.resolve();await Promise.all([legacy,recovery]);}
    assert.deepEqual(events,['legacy starts','legacy commits','shared recovery']);
  });
});

test('a previously open shared-app tab retains its account write lock during recovery',async()=>{
  await withBrowser(async locks=>{
    const entered=deferred(),release=deferred(),events:string[]=[];
    const older=locks.request('buildplay-buildplay.shared.v1.alice',async()=>{entered.resolve();await release.promise;events.push('old queue committed');});
    await entered.promise;
    const current=exclusive('buildplay.shared.v1.alice',async()=>{events.push('new snapshot read');});
    await flush();
    try {assert.deepEqual(events,[]);}
    finally {release.resolve();await Promise.all([older,current]);}
    assert.deepEqual(events,['old queue committed','new snapshot read']);
  });
});

test('two accounts cannot interleave origin cache recovery and restored snapshots',async()=>{
  await withBrowser(async()=>{
    const entered=deferred(),release=deferred(),events:string[]=[];
    const first=exclusive('buildplay.shared.v1.alice',async()=>{events.push('alice reads');entered.resolve();await release.promise;events.push('alice commits');});
    await entered.promise;
    const second=exclusive('buildplay.shared.v1.bob',async()=>{events.push('bob reads');});
    await flush();
    try {assert.deepEqual(events,['alice reads']);}
    finally {release.resolve();await Promise.all([first,second]);}
    assert.deepEqual(events,['alice reads','alice commits','bob reads']);
  });
});

test('failed storage work releases both locks for the next account',async()=>{
  await withBrowser(async()=>{
    await assert.rejects(exclusive('buildplay.shared.v1.alice',async()=>{throw new Error('write denied');}),/write denied/);
    assert.equal(await exclusive('buildplay.shared.v1.bob',async()=>42),42);
  });
});
