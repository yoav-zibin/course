const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {pageScript,pageScriptOf,fakeDom,texts}=require('./page-helper.cjs');

function client(){
 const sent=[];let receive;const {document,ids:nodes}=fakeDom();
 const parent={postMessage(m){sent.push(m);}};
 const code=pageScriptOf(path.join(__dirname,'../../games/audit-batch4/blackjack-table.html'),document);
 vm.runInNewContext(code,{document,parent,addEventListener(type,fn){if(type==='message')receive=fn;}});
 return {nodes,sent,send(message){receive({source:parent,data:message});},foreign(message){receive({source:{},data:message});}};
}
function state(chips=2){return {type:'state_changed',status:'ongoing',move_count:40,my_player_index:0,turn_of_player_indices:[0],
 players:[{name:'You'},{name:'Opponent'}],view:{phase:'betting',customNames:['',''],round:9,deckCount:52,
  chips:[chips,750],dealer:[],hands:[[],[]],results:['',''],pendingBets:{},needBet:[true,true],curP:0,curH:0,winners:null}};}
function buttons(t){return t.nodes.get('actions').children;}

test('every remaining 1-9 chip stack has an enabled exact legal bet',()=>{
 for(let chips=1;chips<10;chips++){
  const t=client();t.send(state(chips));const bets=buttons(t);
  assert.equal(bets.length,1);assert.equal(bets[0].disabled,false);assert.match(bets[0].textContent,/all in/);
  bets[0].onclick();assert.equal(t.sent.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(t.sent[0])),{type:'make_move',move:{kind:'bet',amount:chips}});
 }
});
test('normal stacks keep affordable bet buttons, zero has no bet',()=>{
 const t=client();t.send(state(50));assert.deepEqual(buttons(t).map(x=>x.textContent),['Bet 10','Bet 25','Bet 50']);
 t.send(state(0));assert.equal(buttons(t).length,0);
});
test('duplicate and stale handlers send once, unchanged authoritative refresh recovers',()=>{
 const t=client(),m=state();t.send(m);const old=buttons(t)[0];old.onclick();old.onclick();
 assert.equal(t.sent.length,1);assert.ok(buttons(t).every(b=>b.disabled));
 t.foreign(m);old.onclick();assert.equal(t.sent.length,1);
 t.send({...m,error:'Move rejected'});assert.equal(buttons(t)[0].disabled,false);
 buttons(t)[0].onclick();assert.equal(t.sent.length,2);
 t.send({...m,move_count:41});buttons(t)[0].onclick();assert.equal(t.sent.length,3);
});
test('spectators and completed matches cannot submit through current or stale controls',()=>{
 const t=client();t.send(state());const old=buttons(t)[0];
 t.send({...state(),turn_of_player_indices:[1]});old.onclick();assert.equal(t.sent.length,0);
 t.send({...state(),status:'over',view:{...state().view,phase:'gameOver',winners:0}});
 old.onclick();assert.equal(t.sent.length,0);assert.equal(buttons(t).length,0);
});
