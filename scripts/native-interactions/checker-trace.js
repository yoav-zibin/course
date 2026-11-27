// Copied into the benchmark bundle only. Batch numeric timings on a timer.
// A signed-in account can keep synchronizing for the entire recording.
import {AccountRepository} from './src/core/repository';
import {PortalStore} from './src/core';
import {setItem} from './src/platform/storage';

const rows=[];
let sequence=0,flush;
function append(row) {
  rows.push({...row,wall_ms:Date.now(),js_ms:performance.now()});
  if(rows.length>900)rows.shift();
  if(!flush)flush=setTimeout(()=>{
    flush=undefined;
    void setItem('buildplay.test.checker-timing',JSON.stringify(rows)).catch(()=>{});
  },750);
}
function begin(label) {const id=++sequence;append({label,id,phase:'begin'});return id;}
function end(id) {append({id,phase:'end'});}
function event(label,data={}) {
  if(!['drag_performance','game_move','game_drop_board_updated','local_move_timing','local_move_journal_saved','local_move_checkpoint'].includes(label))return;
  const numbers=Object.fromEntries(Object.entries(data).filter(([,v])=>typeof v==='number'||typeof v==='boolean'));
  append({label,phase:'event',...numbers});
}
function traceAsync(proto,method,label) {
  const original=proto[method];
  proto[method]=async function(...args){
    const id=begin(typeof label==='function'?label(args):label);
    try{return await original.apply(this,args);}finally{end(id);}
  };
}
const repository=AccountRepository.prototype;
traceAsync(repository,'read','Read account and parse JSON');
traceAsync(repository,'write','Serialize and persist account');
const lock=repository.lock;
repository.lock=function(owner,run){
  const id=begin('Wait for account lock');
  return lock.call(this,owner,()=>{end(id);return run();});
};
const portal=PortalStore.prototype;
traceAsync(portal,'callGame',args=>'Rules: '+args[1]);
traceAsync(portal,'practiceMove','Apply local move');
const holdAccountMs=__BENCHMARK_ACCOUNT_HOLD_MS__;
if(holdAccountMs){
  const apply=portal.practiceMove;
  portal.practiceMove=function(...args){
    // Simulate a slow background storage transaction without blocking the JS thread.
    void this.repository.lock(this.identity(),async()=>{
      const id=begin('Simulated competing account transaction');
      try{await new Promise(resolve=>setTimeout(resolve,holdAccountMs));}finally{end(id);}
    }).catch(()=>{});
    return apply.apply(this,args);
  };
}
traceAsync(portal,'sync','Cloud synchronization');
const publish=portal.publishData;
portal.publishData=function(...args){
  const id=begin('Publish account to React');
  try{return publish.apply(this,args);}finally{end(id);}
};
globalThis.__bpCheckerTrace={begin,end,event};
