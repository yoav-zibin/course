import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {PortalStore} from '../src/core';
import {rulesSource} from '../src/game/runtimeSource';

test('iOS SVG fixture restores offline, plays through real schemas, and retains history after restart', async()=>{
  const script=fileURLToPath(new URL('../scripts/seed-ios-connect4-fixture.py',import.meta.url));
  const snapshot=JSON.parse(execFileSync('python3',['-c',`
import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('ios_fixture',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
data,_=module.fixture_snapshot();print(json.dumps(data))
`,script],{encoding:'utf8',timeout:30_000}));
  const saved:Record<string,string>={'buildplay.shared.v1.visitor':JSON.stringify(snapshot)};
  Object.defineProperties(saved,{
    getItem:{value:(key:string)=>Object.hasOwn(saved,key)?saved[key]:null},
    setItem:{value:(key:string,value:string)=>{saved[key]=String(value);}},
    removeItem:{value:(key:string)=>{delete saved[key];}},
  });
  const originalStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),originalFetch=globalThis.fetch;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:saved});
  let network=0;
  globalThis.fetch=async()=>{network++;throw Error('No network permitted');};
  const rules=async(game:any,name:string,args:unknown[],ctx:unknown,seed:number|string,now:number)=>{
    const result=JSON.parse(vm.runInNewContext(rulesSource(game,name,args,ctx,seed,now),{},{timeout:3000}));
    assert.equal(result.ok,true,result.message);return result.result;
  };
  try{
    const store=new PortalStore(rules);await store.bootstrap('https://buildplay.fun',true);
    assert.equal(store.getSnapshot().selectedMatch!.id,'local-ci-connect4-alignment');
    assert.equal(store.getSnapshot().game!.version,3);
    assert.equal(store.actions.presentationMessage().state.board.filter((v:number)=>v>=0).length,6);
    assert.equal(store.getSnapshot().storageError,null);assert.equal(store.getSnapshot().account,null);
    await store.actions.practiceMove({column:2});
    assert.equal(store.getSnapshot().selectedMatch!.move_count,7);
    const restarted=new PortalStore(rules);await restarted.bootstrap('https://buildplay.fun',true);
    assert.equal(restarted.getSnapshot().selectedMatch!.move_count,7);
    assert.equal(restarted.getSnapshot().selectedMatch!.awaitingHandoff,true);
    await restarted.actions.revealLocal();
    await restarted.actions.loadHistory();await restarted.actions.replay(4);
    assert.equal(restarted.actions.presentationMessage().state.board.filter((v:number)=>v>=0).length,4);
    assert.equal(network,0);
  }finally{
    globalThis.fetch=originalFetch;
    if(originalStorage)Object.defineProperty(globalThis,'localStorage',originalStorage);
    else Reflect.deleteProperty(globalThis,'localStorage');
  }
});
