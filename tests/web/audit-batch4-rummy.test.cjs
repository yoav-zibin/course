const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {pageScript,pageScriptOf,fakeDom,texts}=require('./page-helper.cjs');
const root=path.join(__dirname,'../../games/audit-batch4');
function setup(){
 const sent=[];let receive;const {document,ids:nodes}=fakeDom();
 const parent={postMessage:x=>sent.push(x)};
 const sandbox={document,parent,alert(){},addEventListener:(type,fn)=>{if(type==='message')receive=fn;}};
 vm.createContext(sandbox);vm.runInContext(pageScriptOf(path.join(root,'rummy-500.html'),document),sandbox);
 const server={InvalidMove:class InvalidMove extends Error{}};vm.createContext(server);
 vm.runInContext(fs.readFileSync(path.join(root,'rummy-500.server.js'),'utf8')+';globalThis.auditGame=game;',server);
 let seed=1;const ctx={players:[0,1].map(i=>({id:'p'+i,display_name:'P'+i,kind:'human',max_loss:10})),pot:20,move_count:0,random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}};
 const game=server.auditGame;let current=game.newMatch(ctx);
 function message(){const actor=current.turn[0],seat=ctx.players.findIndex(p=>p.id===actor);return {type:'state_changed',status:'ongoing',view:game.viewFor(current.state,actor,ctx),players:ctx.players.map(p=>({name:p.display_name})),move_count:ctx.move_count,my_player_index:seat,turn_of_player_indices:[seat]};}
 const deliver=(extra={},source=parent)=>receive({source,data:{...message(),...extra}});
 function apply(move){current=game.applyMove(JSON.parse(JSON.stringify(current.state)),current.turn[0],move,ctx);ctx.move_count++;}
 function run(code){return vm.runInContext(code,sandbox);}
 function reachMeld(){for(let step=0;step<1000;step++){
   const s=current.state;
   if(s.phase==='play'&&s.melds.length&&!s.pending&&s.hands[s.actor].some(c=>c.id!==s.ban))return;
   apply(game.computerMove(s,current.turn[0],ctx));
 }throw new Error('did not reach table meld');}
 return {nodes,sent,game,ctx,run,deliver,message,apply,reachMeld,current:()=>current};
}
test('Rummy illegal layoff is blocked and a legal discard remains usable',()=>{
 const t=setup();t.reachMeld();const s=t.current().state,actor=t.current().turn[0];
 const card=s.hands[s.actor].find(c=>c.id!==s.ban&&(()=>{try{t.game.applyMove(JSON.parse(JSON.stringify(s)),actor,{type:'layoff',card_id:c.id,meld_id:s.melds[0].id},t.ctx);return false;}catch{return true;}})());
 assert.ok(card);t.deliver();
 t.run(`sel=new Set([${JSON.stringify(card.id)}]);selMeld=${JSON.stringify(s.melds[0].id)};render();`);
 const button=t.nodes.get('controls').children.find(b=>String(b.textContent).startsWith('Lay Off Selected'));
 assert.ok(button&&!button.disabled);button.onclick();assert.equal(t.sent.length,0);
 t.run(`doDiscard(${JSON.stringify(card.id)})`);assert.equal(t.sent.length,1);assert.doesNotThrow(()=>t.apply(t.sent[0].move));
});
test('Rummy submits once until parent response and recovers at the same move count',()=>{
 const t=setup();t.deliver();t.run('doDrawStock();doDrawStock()');assert.equal(t.sent.length,1);
 assert.match(texts(t.nodes.get('status')).join(' '),/Saving move/);
 t.deliver({error:'rejected'},{});t.run('doDrawStock()');assert.equal(t.sent.length,1);
 t.deliver({error:'rejected'});t.run('doDrawStock()');assert.equal(t.sent.length,2);
 assert.doesNotThrow(()=>t.apply(t.sent[1].move));t.deliver();
 t.run('doDrawStock();doNextRound();doEndStock()');assert.equal(t.sent.length,2);
});
test('Rummy incompatible deep discard pickup is blocked before posting',()=>{
 const t=setup();const s=t.current().state;
 // Conserved minimal card ownership is tested with QuickJS's reachable
 // seed2 regression; this focuses the real client draw control.
 s.actor=0;s.hands[0]=[{id:'a',r:2,s:'H'},{id:'b',r:8,s:'C'}];
 s.discard=[{id:'k',r:13,s:'S'},{id:'q',r:12,s:'D'}];s.melds=[];s.phase='draw';t.current().turn=['p0'];
 t.deliver();t.run('doDrawDiscard(0)');assert.equal(t.sent.length,0);
 t.run('doDrawDiscard(1)');assert.equal(t.sent.length,1);assert.doesNotThrow(()=>t.apply(t.sent[0].move));
});
test('Rummy valid layoff posts a move accepted by the server',()=>{
 const t=setup();const s=t.current().state;
 s.actor=0;s.phase='play';s.hands[0]=[{id:'s4',r:4,s:'S'},{id:'h9',r:9,s:'H'}];s.melds=[{id:'m1',owner:1,cards:[1,2,3].map(r=>({id:'s'+r,r,s:'S'})),exts:[]}];t.current().turn=['p0'];
 t.deliver();t.run("doLayoff('s4','m1')");assert.equal(t.sent.length,1);assert.doesNotThrow(()=>t.apply(t.sent[0].move));
});
