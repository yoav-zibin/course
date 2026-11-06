const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {pageScript}=require('./page-helper.cjs');
function setup(name, state){
 const html=fs.readFileSync(path.join(__dirname,'../../games/audit-batch3',name+'.html'),'utf8');
 const handlers={},elements={},messages=[];
 function el(){return {children:[],style:{},_classes:new Set(),appendChild(c){this.children.push(c)},set innerHTML(v){this.children=[]},get innerHTML(){return ''},set className(v){this._classes=new Set(v.split(' '))},get classList(){let self=this;return {add(c){self._classes.add(c)},remove(c){self._classes.delete(c)},contains(c){return self._classes.has(c)}}}};}
 const document={getElementById(id){return elements[id]??=el()},createElement:el};
 const parent={postMessage(m){messages.push(JSON.parse(JSON.stringify(m)))}};
 const sb={document,parent,addEventListener:(event,cb)=>handlers[event]=cb};vm.createContext(sb);vm.runInContext(pageScript(html,document),sb);
 function update(count=1){handlers.message({source:parent,data:{type:'state_changed',status:'ongoing',move_count:count,acting_for_player_index:0,my_player_index:0,players:[{name:'A'},{name:'B'}],view:state}})}
 update();
 function point(idx){return [...elements.left.children,...elements.right.children].find(e=>Number(e.children[0].textContent)===idx+1)}
 return {elements,messages,point,update};
}
function state(own,enemy,moves,bar=0){const s={owner:Array(24).fill(-1),cnt:Array(24).fill(0),bar:[bar,0],off:[15-bar-Object.values(own).reduce((a,b)=>a+b,0),0],cur:0,dice:[1,2],moves:[1,2],needRoll:false,winner:null,legalMoves:moves};for(const [p,pieces] of [own,enemy].entries())for(const [i,n] of Object.entries(pieces)){s.owner[i]=p;s.cnt[i]=n}return s;}
for(const name of ['backgammon','backgammon-copy']){
 test(name+': bar entry sends only higher die and suppresses pending duplicate',()=>{
  const ui=setup(name,state({}, {21:2,19:13},[{from:'bar',to:22,die:2,idx:1}],1));
  ui.elements.barCol.children[0].onclick();
  assert(!ui.point(23).classList.contains('dest'));assert(ui.point(22).classList.contains('dest'));
  ui.point(23).onclick();assert.equal(ui.messages.length,0);
  ui.elements.barCol.children[0].onclick();ui.point(22).onclick();
  assert.deepEqual(ui.messages,[{type:'make_move',move:{action:'move',from:'bar',to:22}}]);
  ui.update();ui.elements.barCol.children[0].onclick();ui.point(22).onclick();assert.equal(ui.messages.length,1);
 });
 test(name+': off tray cannot waste a die; legal point move is submitted',()=>{
  const ui=setup(name,state({1:1,3:1},{2:2,20:13},[{from:1,to:0,die:1,idx:0}]));
  ui.point(1).onclick();assert(!ui.elements.off0.classList.contains('dest'));assert(ui.point(0).classList.contains('dest'));
  ui.elements.off0.onclick();assert.equal(ui.messages.length,0);
  ui.point(0).onclick();assert.deepEqual(ui.messages,[{type:'make_move',move:{action:'move',from:1,to:0}}]);
 });
 test(name+': legal bearing off still submits',()=>{
  const ui=setup(name,state({0:1},{20:15},[{from:0,to:'off',die:1,idx:0}]));
  ui.point(0).onclick();assert(ui.elements.off0.classList.contains('dest'));ui.elements.off0.onclick();
  assert.deepEqual(ui.messages,[{type:'make_move',move:{action:'move',from:0,to:'off'}}]);
 });
}
