const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {pageScript,pageScriptOf,fakeDom,texts}=require('./page-helper.cjs');
const ROOT=path.join(__dirname,'../../games/audit-batch4');
function setup(name){
 const server={};vm.createContext(server);vm.runInContext(fs.readFileSync(path.join(ROOT,name+'.server.js'),'utf8')+';globalThis.api=game;',server);
 const ctx={players:[{id:'p0',kind:'human'},{id:'p1',kind:'human'}],pot:20,move_count:0,random:()=>0.25};
 const state=server.api.newMatch(ctx).state,view=server.api.viewFor(state,'p0',ctx);
 const fd=fakeDom(),handlers={},messages=[];const elements=new Proxy({},{get:(_,id)=>fd.document.getElementById(id)});
 const parent={postMessage(m){messages.push(JSON.parse(JSON.stringify(m)))}};
 const sb={parent,document:fd.document,addEventListener:(n,cb)=>handlers[n]=cb};vm.createContext(sb);vm.runInContext(pageScriptOf(path.join(ROOT,name+'.html'),fd.document),sb);
 const data={type:'state_changed',status:'ongoing',move_count:0,turn_of_player_indices:[0],my_player_index:0,players:[{name:'A'},{name:'B'}],view};
 function update(source=parent,extra={}){handlers.message({source,data:{...data,...extra}})}
 update();
 function clickMove(){if(name==='mancala'){elements.botRow.children[2].onclick()}else{const m=view.moves[0];elements.board.children[m.from.r*8+m.from.c].onclick();elements.board.children[m.to.r*8+m.to.c].onclick()}}
 return {messages,clickMove,update,parent};
}
for(const name of ['checkers','mancala']){
 test(name+': real handlers suppress duplicate pending moves',()=>{
  const ui=setup(name);ui.clickMove();ui.clickMove();assert.equal(ui.messages.length,1);
  assert.equal(ui.messages[0].type,'make_move');
 });
 test(name+': authoritative same-count rejection permits retry',()=>{
  const ui=setup(name);ui.clickMove();ui.update();ui.clickMove();
  assert.equal(ui.messages.length,2);assert.deepEqual(ui.messages[0],ui.messages[1]);
 });
 test(name+': non-parent state cannot clear pending, parent next state can',()=>{
  const ui=setup(name);ui.clickMove();ui.update({}, {move_count:1});ui.clickMove();assert.equal(ui.messages.length,1);
  ui.update(ui.parent,{move_count:1});ui.clickMove();assert.equal(ui.messages.length,2);
 });
}
