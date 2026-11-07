const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {pageScriptOf}=require('./page-helper.cjs');
const root=path.join(__dirname,'../../games/audit-batch4');
function setup(name,n,seed=14){
 const nodes=new Map(),sent=[];let receive;
 class El{constructor(){this.children=[];this.style={};this.disabled=false;this.textContent='';this.queries={};this.classList={add(){},remove(){},toggle(){}};}set innerHTML(v){this._html=v;this.children=[];}get innerHTML(){return this._html||'';}appendChild(x){this.children.push(x);}append(...x){this.children.push(...x);}replaceChildren(...x){this.children=x;}querySelector(q){return this.queries[q]??=new El();}}
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,new El());return nodes.get(id);},createElement:()=>new El(),createTextNode:(text)=>({textContent:text}),querySelector:q=>document.getElementById(q)};
 const parent={postMessage:m=>sent.push(m)},sandbox={document,parent,location:{reload(){}},addEventListener:(t,f)=>receive=f};sandbox.window=sandbox;vm.createContext(sandbox);
 vm.runInContext(pageScriptOf(path.join(root,name+'.html'),document),sandbox);
 const server=vm.createContext({InvalidMove:class InvalidMove extends Error{}});vm.runInContext(fs.readFileSync(path.join(root,name+'.server.js'),'utf8')+';globalThis.g=game',server);const game=server.g;
 function random(s){return()=>{s=(s+0x6D2B79F5)|0;let t=s;t=Math.imul(t^(t>>>15),t|1);t=(t+Math.imul(t^(t>>>7),t|61))^t;return((t^(t>>>14))>>>0)/4294967296;};}
 const ctx={players:Array.from({length:n},(_,i)=>({id:'p'+i,kind:'human',display_name:'P'+i,max_loss:10})),pot:10*n,move_count:0,random:random(seed)};
 let current=game.newMatch(ctx);
 function advance(move){ctx.random=random(seed+ctx.move_count);current=game.applyMove(current.state,current.turn[0],move,ctx);ctx.move_count++;return current;}
 function walk(){for(let i=0;i<2000&&current.turn;i++){ctx.random=random(seed+ctx.move_count);const m=game.randomMove(current.state,current.turn[0],ctx);advance(m);}assert.equal(current.turn,null);return current;}
 function send(viewer){const me=ctx.players.findIndex(p=>p.id===viewer);receive({source:parent,data:{type:'state_changed',status:current.turn?'ongoing':'over',move_count:ctx.move_count,players:ctx.players.map(p=>({name:p.display_name})),my_player_index:me<0?null:me,turn_of_player_indices:current.turn?current.turn.map(id=>ctx.players.findIndex(p=>p.id===id)):null,view:game.viewFor(current.state,viewer,ctx)}});}
 return{nodes,sent,game,ctx,advance,walk,send,current:()=>current};
}
test('Hearts reachable seed14 tie names all low scorers for players and spectators',()=>{
 const t=setup('hearts',4);const end=t.walk();assert.deepEqual(Array.from(end.state.taken),[0,3,23,0]);assert.equal(end.payouts.p0,end.payouts.p3);
 for(const viewer of ['p0','p3',null]){t.send(viewer);assert.match(t.nodes.get('status').textContent,/Tie: P0 & P3 with 0 pts/);assert.match(t.nodes.get('#center .big').textContent,/Tie: P0 & P3/);assert.equal(t.sent.length,0);}
});
test('Hearts unique winner and legal card handlers still work',()=>{
 const t=setup('hearts',4,0);t.send(t.current().turn[0]);const card=t.nodes.get('hand').children.find(x=>x.onclick);assert.ok(card);card.onclick();assert.doesNotThrow(()=>t.advance(t.sent[0].move));
 const end=t.walk();const low=Math.min(...end.state.taken),winner=end.state.taken.indexOf(low);assert.equal(end.state.taken.filter(x=>x===low).length,1);t.send('p0');assert.match(t.nodes.get('status').textContent,new RegExp('P'+winner+' wins with '+low+' pts'));
});
test('Cheat challenge controls disabled for spectator and claimant, enabled for eligible players',()=>{
 const t=setup('cheat-bs',3);t.advance({kind:'play',cards:[t.current().state.hands[0][0]]});
 for(const viewer of [null,'p0']){t.send(viewer);for(const id of ['bsBtn','passBtn']){assert.equal(t.nodes.get(id).disabled,true);t.nodes.get(id).onclick();}assert.equal(t.sent.length,0);}
 t.send('p1');assert.equal(t.nodes.get('bsBtn').disabled,false);assert.equal(t.nodes.get('passBtn').disabled,false);t.nodes.get('passBtn').onclick();assert.doesNotThrow(()=>t.game.applyMove(JSON.parse(JSON.stringify(t.current().state)),'p1',t.sent.at(-1).move,t.ctx));
 t.send('p2');t.nodes.get('bsBtn').onclick();assert.doesNotThrow(()=>t.game.applyMove(JSON.parse(JSON.stringify(t.current().state)),'p2',t.sent.at(-1).move,t.ctx));
});
