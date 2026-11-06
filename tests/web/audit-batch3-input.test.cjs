const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'../../games/audit-batch3');
const {pageScriptOf,fakeDom}=require('./page-helper.cjs');
// The markup a rendered node would produce: enough to check classes, text and inline handlers.
function ser(node){if(!node)return '';if(node.tag==='br')return '<br>';if(node.children===undefined)return node.textContent||'';const cls=node.className?` class="${node.className}"`:'';const on=node.attributes&&node.attributes.onclick?` onclick="${node.attributes.onclick}"`:'';return `<${node.tag}${cls}${on}>`+(node.textContent||'')+node.children.map(ser).join('')+`</${node.tag}>`;}
function setup(name){
 const sent=[];let receive;const {document,ids:nodes}=fakeDom();
 const parent={postMessage:message=>sent.push(message)};
 const sandbox={document,parent,addEventListener:(type,fn)=>{if(type==='message')receive=fn;}};sandbox.window=sandbox;
 vm.createContext(sandbox);vm.runInContext(pageScriptOf(path.join(root,name+'.html'),document),sandbox);
 const server={InvalidMove:class InvalidMove extends Error{}};vm.createContext(server);
 vm.runInContext(fs.readFileSync(path.join(root,name+'.server.js'),'utf8')+';globalThis.auditGame=game;',server);
 let seed=20261105;
 const ctx={players:[0,1].map(i=>({id:'p'+i,kind:'human',display_name:'P'+i,max_loss:10})),pot:20,move_count:0,
  random:()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}};
 const game=server.auditGame;let current=game.newMatch(ctx);
 function message(extra={},viewer=current.turn?.[0]??'p0'){
  const actor=current.turn?.[0],seat=ctx.players.findIndex(p=>p.id===actor),mine=ctx.players.findIndex(p=>p.id===viewer);
  return {type:'state_changed',status:current.turn?'ongoing':'over',move_count:ctx.move_count,
   players:ctx.players.map(p=>({name:p.display_name,player_id:p.id})),my_player_index:mine<0?null:mine,
   acting_for_player_index:actor===viewer?seat:null,turn_of_player_indices:current.turn?[seat]:null,
   view:game.viewFor(current.state,viewer,ctx),...extra};
 }
 function send(extra={},viewer){receive({source:parent,data:message(extra,viewer)});}
 function advance(move){current=game.applyMove(JSON.parse(JSON.stringify(current.state)),current.turn[0],move,ctx);ctx.move_count++;return current;}
 function startPlay(){advance({kind:'flip',idxs:[0,1]});advance({kind:'flip',idxs:[0,1]});send();}
 function clickInline(node,action){const html=ser(nodes.get(node));const handler=[...html.matchAll(/onclick="([^"]+)"/g)].map(m=>m[1]).find(h=>h===action);assert.ok(handler,`${action} should be an actual rendered handler`);vm.runInContext(handler,sandbox);}
 return {nodes,html:id=>ser(nodes.get(id)),sent,sandbox,game,ctx,message,send,advance,startPlay,clickInline,
  current:()=>current,foreign:extra=>receive({source:{},data:message(extra)})};
}
test('Golf public discard and own drawn cards render their actual faces',()=>{
 const t=setup('six-card-golf');t.startPlay();
 assert.doesNotMatch(t.html('piles'),/Discard<br><div class="card back/);
 t.clickInline('actions','window.clickStock()');t.advance(t.sent[0].move);t.send();
 assert.doesNotMatch(t.html('piles'),/Drawn<br><div class="card back/);
 assert.match(t.html('piles'),/Drawn<br><div class="card(?: red)?"/);
 assert.match(t.html('hands'),/class="card back/); // unrevealed hand cards stay hidden
});
test('Golf draw submissions lock until an authoritative response, including same-count rejection',()=>{
 const t=setup('six-card-golf');t.startPlay();const action='window.clickStock()';
 t.clickInline('actions',action);vm.runInContext(action,t.sandbox);assert.equal(t.sent.length,1);
 assert.equal(t.nodes.get('status').textContent,'Saving move…');
 t.foreign({error:'rejected'});vm.runInContext(action,t.sandbox);assert.equal(t.sent.length,1);
 t.send({error:'rejected'});t.clickInline('actions',action);assert.equal(t.sent.length,2);
});
test('Golf flip and replacement handlers submit legal moves once',()=>{
 const t=setup('six-card-golf');t.send();
 t.clickInline('hands','window.clickFlip(0);');t.clickInline('hands','window.clickFlip(1);');
 t.clickInline('actions','window.confirmFlip()');vm.runInContext('window.confirmFlip()',t.sandbox);assert.equal(t.sent.length,1);
 t.advance(t.sent[0].move);t.advance({kind:'flip',idxs:[0,1]});t.send();
 t.clickInline('actions','window.clickStock()');t.advance(t.sent[1].move);t.send();
 t.clickInline('hands','window.clickReplace(2);');vm.runInContext('window.clickReplace(2)',t.sandbox);
 assert.equal(t.sent.length,3);assert.doesNotThrow(()=>t.advance(t.sent[2].move));
});
test('Golf ignores stale or illegal phase actions and never flips a face-up card',()=>{
 const t=setup('six-card-golf');t.startPlay();
 vm.runInContext('window.clickReplace(0);window.clickFlipSpot(0);window.confirmFlip();',t.sandbox);assert.equal(t.sent.length,0);
 t.clickInline('actions','window.clickDisc()');t.advance(t.sent[0].move);t.send();
 vm.runInContext('window.clickFlipSpot(2);window.armFlip();window.clickStock();',t.sandbox);assert.equal(t.sent.length,1);
 assert.doesNotMatch(t.html('actions'),/Now click/);
});
test('Golf spectators do not see stock-drawn card or get action handlers',()=>{
 const t=setup('six-card-golf');t.startPlay();t.advance({kind:'draw',from:'stock'});t.send({},null);
 assert.match(t.html('piles'),/Drawn<br><div class="card back">\?<\/div>/);
 assert.doesNotMatch(t.html('actions'),/onclick=/);
 vm.runInContext('window.clickStock();window.clickReplace(0);',t.sandbox);assert.equal(t.sent.length,0);
});
test('Golf displays all tied low scorers instead of naming an exclusive winner',()=>{
 const t=setup('six-card-golf');t.startPlay();const view=t.message().view;
 t.send({status:'over',acting_for_player_index:null,view:{...view,phase:'over',scores:[32,32],winner:0}});
 assert.match(t.nodes.get('status').textContent,/Tie: P0 & P1 with 32/);
 assert.doesNotMatch(t.nodes.get('status').textContent,/P0 wins/);
 vm.runInContext('window.clickStock();window.clickReplace(0);',t.sandbox);assert.equal(t.sent.length,0);
});
test('unchanged Reversi permits legal squares and blocks duplicate submission until refresh',()=>{
 const t=setup('reversi');t.send();const board=t.nodes.get('board').children;
 assert.equal(board[0].disabled,true);const legal=t.message().view.legalMoves[0];assert.equal(board[legal].disabled,false);
 board[legal].onclick();board[legal].onclick();assert.equal(t.sent.length,1);
 assert.doesNotThrow(()=>t.advance(t.sent[0].move));t.send();
 assert.notEqual(t.nodes.get('status').textContent,'Saving move…');
});
