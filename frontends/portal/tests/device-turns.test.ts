import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyAccountData} from '../src/core/repository';
import {DeviceTurns,deviceTurn} from '../src/core/device-turns';
import type {LocalMatch} from '../src/core/types';

const initial={id:'match',game_id:'game',game_version:1,localMode:'pass',logicState:0,state:0,
  status:'ongoing',move_count:0,local_revision:1,moves:[],players:[],turn_of_player_indices:[0]} as unknown as LocalMatch;
function move(from:LocalMatch,tile:number):LocalMatch {
  return {...from,move_count:from.move_count+1,logicState:tile,state:tile,
    local_revision:from.local_revision!+1,moves:[...from.moves,{move_number:from.move_count+1,new_state:tile,move:{tile}}]};
}
test('device checkpoint recovery is idempotent and keeps newer cloud acknowledgements',async()=>{
  let entry:string|null=null,failCleanup=true;
  const storage={getItem:async()=>entry,setItem:async(_key:string,value:string)=>{entry=value;},
    removeItem:async()=>{if(failCleanup)throw Error('interrupted after account write');entry=null;}};
  const journal=new DeviceTurns(storage,'account');await journal.load();
  const next=move(initial,7);journal.stage(deviceTurn('turn',initial,next));await journal.persist();
  let disk=emptyAccountData();disk.local.match={...initial,cloud_revision:8,synced_local_revision:1};
  const read=async()=>structuredClone(disk),write=async(data:typeof disk)=>{disk=data;};
  await assert.rejects(journal.checkpoint(read,write),/interrupted/);assert.ok(entry);
  assert.equal(disk.local.match.cloud_revision,8);assert.equal(disk.local.match.local_revision,2);
  const restored=new DeviceTurns(storage,'account');await restored.load();
  assert.deepEqual(restored.restore(await read()).local.match.moves,next.moves);
  failCleanup=false;await restored.checkpoint(read,write);
  assert.equal(entry,null);assert.equal(disk.local.match.moves.length,1);
});
test('a journal record for a diverged branch preserves both the turn and the external board',async()=>{
  let entry:string|null=null;
  const journal=new DeviceTurns({getItem:async()=>entry,setItem:async(_key,v)=>{entry=v;},removeItem:async()=>{entry=null;}},'account');
  await journal.load();journal.stage(deviceTurn('mine',initial,move(initial,2)));await journal.persist();
  const data=emptyAccountData();data.local.match=move(initial,9);
  journal.restore(data);journal.restore(data);
  assert.equal(data.local.match.state,9);assert.equal(data.archives.length,1);
  assert.equal(data.archives[0].turn.changes.state,2);assert.ok(data.conflicts.match);
});
