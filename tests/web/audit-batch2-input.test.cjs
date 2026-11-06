const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'../../games/audit-batch2');
function setup(name){
 const nodes=new Map(),sent=[];let receive;
 const element=()=>({children:[],style:{},classList:{add(){},remove(){}},disabled:false,textContent:'',
  append(...items){this.children.push(...items);},appendChild(item){this.children.push(item);},replaceChildren(...items){this.children=items;},
  addEventListener(type,fn){this['on'+type]=fn;}});
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element};
 const parent={postMessage:message=>sent.push(message)};
 const sandbox={document,parent,addEventListener:(type,fn)=>{if(type==='message')receive=fn;}};sandbox.window=sandbox;
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(root,name+'.html'),'utf8').match(/<script[^>]*>([\s\S]*?)<\/script>/)[1],sandbox);
 const server={InvalidMove:class InvalidMove extends Error{}};vm.createContext(server);vm.runInContext(fs.readFileSync(path.join(root,name+'.server.js'),'utf8')+';globalThis.auditGame=game;',server);
 const game=server.auditGame,ctx={players:[0,1].map(i=>({id:'p'+i,kind:'human',name:'P'+i,max_loss:10})),pot:20,random:()=>.5,move_count:0};
 const current=game.newMatch(ctx);
 function send(state=current.state,extras={}){const seat=name==='quoridor'?state.turnIdx:state.currentPlayer;const view=game.viewFor(state,'p'+seat,ctx);receive({source:parent,data:{type:'state_changed',status:'ongoing',move_count:0,my_player_index:0,acting_for_player_index:name==='quoridor'?state.turnIdx:state.currentPlayer,players:ctx.players,view,...extras}});}
 return {nodes,sent,sandbox,game,ctx,current,send,foreign:data=>receive({source:{},data})};
}
test('Blokus illegal placement is disabled and stale click cannot submit it',()=>{
 const t=setup('blokus');t.send();const cells=t.nodes.get('board').children;
 assert.equal(cells[10*20+10].disabled,true);cells[10*20+10].onclick();assert.equal(t.sent.length,0);
 assert.equal(cells[0].disabled,false);cells[0].onclick();cells[0].onclick();assert.equal(t.sent.length,1);
 assert.doesNotThrow(()=>t.game.applyMove(JSON.parse(JSON.stringify(t.current.state)),'p0',t.sent[0].move,t.ctx));
 t.send();t.nodes.get('board').children[0].onclick();assert.equal(t.sent.length,2);
});
test('Blokus rejects touching own edge and permits actual corner contact',()=>{
 const t=setup('blokus');const s=t.current.state;
 s.board[0][0]=0;s.available[0][1]=false;
 t.send(s); // the selected unused monomino must touch diagonally, not along an edge
 const cells=t.nodes.get('board').children;
 assert.equal(cells[1].disabled,true);cells[1].onclick();assert.equal(t.sent.length,0);
 assert.equal(cells[21].disabled,false);cells[21].onclick();assert.equal(t.sent.length,1);
 assert.doesNotThrow(()=>t.game.applyMove(s,'p0',t.sent[0].move,t.ctx));
});
test('Blokus spectators and ended matches cannot send',()=>{
 const t=setup('blokus');t.send(t.current.state,{acting_for_player_index:null});t.nodes.get('board').children[0].onclick();
 t.send(t.current.state,{status:'over'});t.nodes.get('board').children[0].onclick();assert.equal(t.sent.length,0);
});
const anchor=(t,r,c)=>t.nodes.get('grid').children[(2*r+1)*17+(2*c+1)];
test('Quoridor filters occupied, overlapping, crossing, and path-blocking walls',()=>{
 const t=setup('quoridor');const s=t.current.state;
 Object.assign(s,{pawns:[{r:7,c:0},{r:0,c:4}],walls:[{r:6,c:0,o:'V'},{r:7,c:0,o:'H'}]});
 t.send(s);t.nodes.get('modeWall').onclick();
 assert.equal(t.game.wallFits(s,5,0,'H'),false);assert.equal(anchor(t,5,0).onclick,undefined);
 assert.equal(anchor(t,7,0).onclick,undefined);assert.equal(anchor(t,7,1).onclick,undefined);
 for(const o of ['H','V']){
  if(o==='V')t.nodes.get('orient').onclick();
  for(let r=0;r<8;r++)for(let c=0;c<8;c++)assert.equal(typeof anchor(t,r,c).onclick==='function',t.game.wallFits(s,r,c,o),`${r},${c},${o}`);
 }
});
test('Quoridor accepted wall sends once and same-count refresh recovers input',()=>{
 const t=setup('quoridor');t.send();t.nodes.get('modeWall').onclick();const wall=anchor(t,4,4);
 wall.onclick();wall.onclick();assert.equal(t.sent.length,1);
 assert.doesNotThrow(()=>t.game.applyMove(JSON.parse(JSON.stringify(t.current.state)),'p0',t.sent[0].move,t.ctx));
 assert.equal(t.nodes.get('status').textContent,'Saving move…');
 t.send(t.current.state,{error:'Rejected'});anchor(t,4,4).onclick();assert.equal(t.sent.length,2);
});
test('Quoridor disables wall placement when no walls remain',()=>{
 const t=setup('quoridor');t.current.state.wallsLeft[0]=0;t.send();t.nodes.get('modeWall').onclick();
 for(let r=0;r<8;r++)for(let c=0;c<8;c++)assert.equal(anchor(t,r,c).onclick,undefined);
 assert.equal(t.sent.length,0);
});

test('Blokus ignores foreign messages while an accepted send is pending',()=>{
 const t=setup('blokus');t.send();t.nodes.get('board').children[0].onclick();
 t.foreign({type:'state_changed',status:'ongoing',move_count:0,acting_for_player_index:0,view:t.game.viewFor(t.current.state,'p0',t.ctx)});
 t.nodes.get('board').children[0].onclick();assert.equal(t.sent.length,1);
});
