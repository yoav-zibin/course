const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('golf client animates authoritative server frames for the shooter after turn changes',()=>{
 const {pageScriptOf}=require('./page-helper.cjs');
 const document={getElementById:id=>element(id),createElement:()=>({style:{},replaceChildren(){},appendChild(){}})};
 const code=pageScriptOf(path.join(__dirname,'../../games/audit-batch2/mini-golf-duels.html'),document);
 const handlers={},queue=[],elements={};function element(id){return elements[id]??={getContext:()=>({}),addEventListener(){},replaceChildren(){},appendChild(){},style:{}};}
 const parent={postMessage(){}};const sb={document,parent,addEventListener:(name,cb)=>handlers[name]=cb,requestAnimationFrame:cb=>queue.push(cb),Math};vm.createContext(sb);vm.runInContext(code,sb);
 queue.length=0;const data={type:'state_changed',status:'ongoing',move_count:1,acting_for_player_index:1,my_player_index:1,players:[{name:'A',kind:'human'},{name:'B',kind:'human'}],view:{hole:0,pos:[[40,50],[70,80]],sunk:[false,false],cur:[1,0],tot:[0,0],hist:[[],[]],par:2,course:{par:2,port:null},lastShot:{seat:0,hole:0,frames:[[10,20],[40,50]]}}};
 handlers.message({source:parent,data});assert.deepEqual(Array.from(vm.runInContext('posToDraw(0)',sb)),[10,20]);assert.equal(vm.runInContext('animSeat',sb),0);queue.shift()();assert.deepEqual(Array.from(vm.runInContext('posToDraw(0)',sb)),[40,50]);
 handlers.message({source:parent,data});assert.equal(vm.runInContext('animSeat',sb),0);queue.shift()();assert.equal(vm.runInContext('animBall',sb),null);
 assert.equal(vm.runInContext('typeof animatePreview',sb),'undefined');
});

test('authoritative golf physics reflects off walls, applies terrain drag and uses portals',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../../games/audit-batch2/mini-golf-duels.server.js'),'utf8');
 const sb={};vm.createContext(sb);vm.runInContext(source+';globalThis.sim=golfPhysics;',sb);
 const fair=[[-1000,-1000],[1000,-1000],[1000,1000],[-1000,1000]],base={fair,walls:[],sands:[],ices:[],port:null,cup:[900,900]};
 const normal=sb.sim([100,200],[4,0],base);
 const sand=sb.sim([100,200],[4,0],{...base,sands:[fair]});
 const ice=sb.sim([100,200],[4,0],{...base,ices:[fair]});
 assert(sand.pos[0]<normal.pos[0]);assert(ice.pos[0]>normal.pos[0]);
 const wall=sb.sim([100,200],[4,0],{...base,walls:[[[180,180],[190,180],[190,220],[180,220]]]});
 assert(wall.frames.every(p=>p[0]<=173.01));assert(wall.pos[0]<180);
 const portal=sb.sim([100,200],[0.6,0],{...base,port:{a:{x:100,y:200,r:12},b:{x:400,y:200,r:12}}});
 assert(portal.frames.some(p=>p[0]>400));assert(portal.frames.length<=80);
});
