import {test} from 'node:test';
import assert from 'node:assert/strict';
import {performInviteShare} from '../src/core/invite-sharing';

for(const [channel,result] of [['copy_code','copied'],['share_link','shared'],['share_link','copied']] as const)test(`${channel} records a completed ${result} action`,async()=>{
  const events:string[]=[];
  assert.equal(await performInviteShare(channel,async()=>{events.push('action');return result;},async sharedChannel=>{events.push(sharedChannel);}),result);
  assert.deepEqual(events,['action',channel]);
});

test('cancelled and failed sharing never records a successful share action',async()=>{
  let recorded=0;const record=async()=>{recorded++;};
  assert.equal(await performInviteShare('share_link',async()=> 'cancelled',record),'cancelled');
  await assert.rejects(performInviteShare('share_link',async()=>{throw new Error('Share failed');},record),/Share failed/);
  await assert.rejects(performInviteShare('copy_code',async()=>{throw new Error('Clipboard denied');},record),/Clipboard denied/);
  assert.equal(recorded,0);
});

test('analytics failure or a pending connection does not delay or fail successful copying',async()=>{
  for(const record of [async()=>{throw new Error('Offline');},()=>new Promise<never>(()=>{})]){
    assert.equal(await performInviteShare('copy_code',async()=> 'copied',record),'copied');
  }
  await new Promise(resolve=>setImmediate(resolve));
});
