const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {pageScriptOf}=require('./page-helper.cjs');
const ROOT=path.join(__dirname,'../../games/audit-batch6');
function setup(n=2){
 const nodes=new Map(),sent=[];let receive;
 class El{constructor(){this.children=[];this.style={};this.disabled=false;this.textContent=''}replaceChildren(){this.children=[]}append(x){this.children.push(x)}}
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,new El());return nodes.get(id)},createElement:()=>new El()};
 const parent={postMessage:m=>sent.push(JSON.parse(JSON.stringify(m)))};
 const sandbox={document,parent,addEventListener:(_,f)=>receive=f};vm.createContext(sandbox);
 vm.runInContext(pageScriptOf(path.join(ROOT,'stack-duel.html'),document),sandbox);
 const server=vm.createContext({InvalidMove:class InvalidMove extends Error{}});
 vm.runInContext(fs.readFileSync(path.join(ROOT,'stack-duel.server.js'),'utf8')+';globalThis.g=game',server);
 const game=server.g,ctx={players:Array.from({length:n},(_,i)=>({id:'p'+i,kind:'human',max_loss:10})),pot:n*10,move_count:0};
 function random(seed){let value=seed>>>0;return()=>{value=(value+0x6d2b79f5)|0;let t=value;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}
 ctx.random=random(29);let current=game.newMatch(ctx);
 function advance(move){ctx.random=random(29+ctx.move_count);current=game.applyMove(current.state,current.turn[0],move,ctx);ctx.move_count++;return current}
 function message(viewer=0,extra={}){const actor=current.turn?ctx.players.findIndex(p=>p.id===current.turn[0]):null;receive({source:parent,data:{type:'state_changed',move_count:ctx.move_count,players:ctx.players.map((p,i)=>({name:'P'+i})),my_player_index:viewer,acting_for_player_index:viewer===actor?actor:null,turn_of_player_indices:actor===null?null:[actor],status:current.turn?'ongoing':'over',view:game.viewFor(current.state,viewer===null?null:'p'+viewer,ctx),...extra}})}
 const enabled=()=>nodes.get('cols').children.map((b,i)=>b.disabled?null:i).filter(x=>x!==null);
 return {nodes,sent,ctx,game,advance,message,enabled,current:()=>current,setCurrent:r=>current=r};
}
test('six accepted drops leave the next actor real client controls for all remaining placements',()=>{
 const t=setup();for(const [rot,col] of [[0,5],[3,3],[0,4],[1,4],[1,0],[2,2]])t.advance({rot,col});
 assert.equal(t.current().state.over,false);t.message(0);
 assert.deepEqual(t.enabled(),[0,5]);assert.match(t.nodes.get('status').textContent,/place the S piece/);
 t.nodes.get('rotate').onclick();assert.deepEqual(t.enabled(),[0,5,6]);
 t.nodes.get('cols').children[6].onclick();assert.deepEqual(t.sent[0].move,{rot:1,col:6});assert.doesNotThrow(()=>t.advance(t.sent[0].move));
});
test('a player-left ending with nullable winners renders a neutral ending and disables moves',()=>{
 const t=setup();t.message(1,{status:'over',end_reason:'player_left',acting_for_player_index:null,turn_of_player_indices:null});
 assert.equal(t.current().state.winners,null);assert.match(t.nodes.get('status').textContent,/Game ended — a player left\./);assert.doesNotMatch(t.nodes.get('status').textContent,/wins?|Tie/);
 assert.deepEqual(t.enabled(),[]);assert.equal(t.nodes.get('rotate').disabled,true);
 for(const button of t.nodes.get('cols').children)button.onclick();assert.equal(t.sent.length,0);
});
test('other platform terminal reasons without game winners use the neutral fallback',()=>{
 const t=setup();for(const viewer of [0,1,null]){t.message(viewer,{status:'over',end_reason:'finished',acting_for_player_index:null,turn_of_player_indices:null});assert.match(t.nodes.get('status').textContent,/^Game ended\. Lines cleared: 0$/);assert.deepEqual(t.enabled(),[])}
 assert.equal(t.sent.length,0);
});
test('a genuine no-placement game ending retains tie and unique-winner rendering',()=>{
 for(const scores of [[0,0],[1,0]]){
  const t=setup(),s=t.current().state;s.board=Array.from({length:10},()=>Array(7).fill(0).concat(-1));for(const c of [1,3,5])s.board[0][c]=-1;for(let r=1;r<4;r++)s.board[r][1]=-1;s.current='I';s.next='O';s.scores=scores;s.lines=scores[0];
  t.advance({rot:1,col:1});assert.equal(t.current().state.over,true);t.message(0);assert.deepEqual(t.enabled(),[]);
  assert.match(t.nodes.get('status').textContent,scores[0]?/P0 wins!/:/P0, P1 win!/);
 }
});
test('ordinary direct-column controls still submit a move accepted by the actual game',()=>{
 const t=setup();t.message(0);assert.deepEqual(t.enabled(),[0,1,2,3,4,5]);t.nodes.get('cols').children[0].onclick();assert.deepEqual(t.sent[0].move,{rot:0,col:0});assert.doesNotThrow(()=>t.advance(t.sent[0].move));
});
test('the page shows the translations the platform sends, and English again without them',()=>{
 const t=setup();
 t.message(0,{locale:'es',direction:'ltr',strings:{saving:'Guardando…',scores_total:'{scores} · líneas en total {lines}',score_line:'{name}: {lines} líneas',rotate:'↻ Girar',current_piece:'Pieza actual:'}});
 assert.equal(t.nodes.get('rotate').textContent,'↻ Girar');
 assert.equal(t.nodes.get('curLabel').textContent,'Pieza actual:');
 assert.match(t.nodes.get('scores').textContent,/P0: 0 líneas · P1: 0 líneas · líneas en total 0/);
 t.message(0,{locale:'en'});
 assert.equal(t.nodes.get('rotate').textContent,'↻ Rotate');
 assert.match(t.nodes.get('scores').textContent,/P0: 0 lines · P1: 0 lines · total lines 0/);
});
