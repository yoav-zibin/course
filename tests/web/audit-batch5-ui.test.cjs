const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {pageScriptOf}=require('./page-helper.cjs');
const ROOT=path.join(__dirname,'../../games/audit-batch5');
function setup(name,n=2){
 const nodes=new Map(),sent=[],timers=new Map();let receive,timerId=0;
 class El{
  constructor(){this.children=[];this.style={};this.disabled=false;this.textContent='';this._value=null;this.classList={add(){},remove(){},toggle(){}};}
  set id(v){this._id=v;nodes.set(v,this)} get id(){return this._id}
  set value(v){this._value=String(v)} get value(){return this._value??(this.children[0]?.value??'')}
  set innerHTML(v){this._html=v;this.children=[]}get innerHTML(){return this._html||''}
  appendChild(x){x.parentNode=this;this.children.push(x);return x}
  append(...xs){xs.forEach(x=>this.appendChild(x))}
  replaceChildren(...xs){this.children=[];xs.forEach(x=>this.appendChild(x))}
  setAttribute(k,v){this['_'+k]=v}
  querySelectorAll(q){return this.children.filter(x=>q==='button'||q==='.'+x.className)}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(x=>x!==this)}
 }
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,new El());return nodes.get(id)},createElement:()=>new El(),createTextNode:(text)=>({textContent:text})};
 for(const m of fs.readFileSync(path.join(ROOT,name+'.html'),'utf8').matchAll(/id=['"]([^'"]+)['"]/g))document.getElementById(m[1]);
 const parent={postMessage:m=>sent.push(JSON.parse(JSON.stringify(m)))};
 const sandbox={document,parent,addEventListener:(t,f)=>receive=f,setTimeout:f=>{timers.set(++timerId,f);return timerId},clearTimeout:id=>timers.delete(id)};sandbox.window=sandbox;vm.createContext(sandbox);
 vm.runInContext(pageScriptOf(path.join(ROOT,name+'.html'),document),sandbox);
 const server=vm.createContext({InvalidMove:class InvalidMove extends Error{}});vm.runInContext(fs.readFileSync(path.join(ROOT,name+'.server.js'),'utf8')+';globalThis.g=game',server);const game=server.g;
 let seed=20261106;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
 const ctx={players:Array.from({length:n},(_,i)=>({id:'p'+i,kind:'human',display_name:'P'+i,max_loss:10})),pot:10*n,move_count:0,random};let current=game.newMatch(ctx);
 function advance(move){current=game.applyMove(current.state,current.turn[0],move,ctx);ctx.move_count++;return current}
 function message(viewer,source=parent,extra={}){const me=ctx.players.findIndex(p=>p.id===viewer);receive({source,data:{type:'state_changed',status:current.turn?'ongoing':'over',move_count:ctx.move_count,players:ctx.players.map(p=>({name:p.display_name})),my_player_index:me<0?null:me,acting_for_player_index:current.turn?ctx.players.findIndex(p=>p.id===current.turn[0]):null,view:game.viewFor(current.state,viewer,ctx),...extra}})}
 function walk(){for(let i=0;i<1000&&current.turn;i++)advance(game.randomMove(current.state,current.turn[0],ctx));assert.equal(current.turn,null);return current}
 return {nodes,sent,game,ctx,advance,message,walk,current:()=>current,parent,timers};
}
test('Guess Who actual handlers skip already asked own questions and emit a legal next ask',()=>{
 const t=setup('guess-who');t.advance({kind:'ask',q:0});t.advance({kind:'ask',q:0});t.message('p0');
 assert.equal(t.nodes.get('q').children[0].disabled,true);assert.equal(t.nodes.get('q').value,'1');
 t.nodes.get('q').value='0';t.nodes.get('ask').onclick();assert.equal(t.sent.length,0);
 t.nodes.get('q').value='1';t.nodes.get('q').onchange();t.nodes.get('ask').onclick();
 assert.deepEqual(t.sent[0].move,{kind:'ask',q:1});assert.doesNotThrow(()=>t.advance(t.sent[0].move));
 // Questions belong to the asker: the opponent's prior question is still legal.
 const u=setup('guess-who');u.advance({kind:'ask',q:0});u.message('p1');assert.equal(u.nodes.get('q').children[0].disabled,false);u.nodes.get('ask').onclick();assert.doesNotThrow(()=>u.advance(u.sent[0].move));
});
test('Guess Who duplicate submits are blocked, authoritative same-count rejection permits retry',()=>{
 const t=setup('guess-who');t.message('p0');t.nodes.get('ask').onclick();t.nodes.get('ask').onclick();assert.equal(t.sent.length,1);assert.equal(t.nodes.get('ask').disabled,true);assert.equal(t.nodes.get('guessBtn').disabled,true);
 t.message('p0',{});t.nodes.get('ask').onclick();assert.equal(t.sent.length,1);
 t.message('p0');t.nodes.get('ask').onclick();assert.equal(t.sent.length,2);assert.deepEqual(t.sent[0],t.sent[1]);
});
test('Guess Who all fourteen questions exhausted still allows one legal guess',()=>{
 const t=setup('guess-who');for(let q=0;q<14;q++){t.advance({kind:'ask',q});t.advance({kind:'ask',q})}t.message('p0');
 assert.equal(t.nodes.get('ask').disabled,true);assert.equal(t.nodes.get('q').disabled,true);assert.equal(t.nodes.get('guessBtn').disabled,false);
 t.nodes.get('ask').onclick();assert.equal(t.sent.length,0);
 t.nodes.get('guessBtn').onclick();t.nodes.get('ggrid').children[0].onclick();t.nodes.get('confirm').onclick();t.nodes.get('confirm').onclick();assert.equal(t.sent.length,1);assert.deepEqual(t.sent[0].move,{kind:'guess',idx:0});assert.doesNotThrow(()=>t.advance(t.sent[0].move));
});
test('Guess Who spectator and terminal handlers never emit moves',()=>{
 const t=setup('guess-who');t.message(null);for(const id of ['ask','guessBtn','confirm']){t.nodes.get(id).onclick();assert.equal(t.nodes.get(id).disabled,true)}assert.equal(t.sent.length,0);
 t.advance({kind:'guess',idx:t.current().state.s[1]});t.message('p0');t.nodes.get('ask').onclick();t.nodes.get('guessBtn').onclick();assert.equal(t.sent.length,0);
});
test('Spades terminal controls guide a new portal match without sending an illegal terminal move',()=>{
 const t=setup('spades',4);t.walk();assert.equal(t.ctx.move_count,65);
 for(const viewer of ['p0',null]){t.message(viewer);for(const id of ['newgame','bRand','bSmart']){assert.equal(t.nodes.get(id).disabled,true);t.nodes.get(id).onclick()}assert.equal(t.nodes.get('over').style.display,'flex');assert.equal(t.nodes.get('again').onclick,undefined)}
 assert.equal(t.sent.length,0);assert.match(fs.readFileSync(path.join(ROOT,'spades.html'),'utf8'),/Use the portal controls to start another match/);
});
test('Spades current actor can redeal and play; spectators and other seats cannot',()=>{
 const t=setup('spades',4);const pid=t.current().turn[0];t.message(null);t.nodes.get('newgame').onclick();t.nodes.get('bRand').onclick();assert.equal(t.sent.length,0);
 t.message('p'+((Number(pid.slice(1))+1)%4));t.nodes.get('newgame').onclick();assert.equal(t.sent.length,0);
 t.message(pid);t.nodes.get('newgame').onclick();t.nodes.get('newgame').onclick();assert.equal(t.sent.length,1);assert.deepEqual(t.sent[0].move,{newGame:true});assert.doesNotThrow(()=>t.advance(t.sent[0].move));
 t.message(t.current().turn[0]);t.nodes.get('hand').children.find(x=>x.onclick).onclick();assert.equal(t.sent.length,2);assert.doesNotThrow(()=>t.advance(t.sent[1].move));
});
test('Spades auto collect only runs for the acting viewer; stale clicks and timers are guarded',()=>{
 const t=setup('spades',4);for(let i=0;i<4;i++)t.advance(t.game.randomMove(t.current().state,t.current().turn[0],t.ctx));const pid=t.current().turn[0];
 t.message(null);assert.equal(t.timers.size,0);t.message('p'+((Number(pid.slice(1))+1)%4));assert.equal(t.timers.size,0);
 t.message(pid);assert.equal(t.timers.size,1);const timer=[...t.timers.values()][0];timer();timer();assert.equal(t.sent.length,1);assert.deepEqual(t.sent[0].move,{collect:true});
 t.message(pid,{});timer();assert.equal(t.sent.length,1);t.message(pid);timer();assert.equal(t.sent.length,2);assert.doesNotThrow(()=>t.advance(t.sent[0].move));
});
