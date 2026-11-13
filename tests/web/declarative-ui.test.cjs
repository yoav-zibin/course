const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const api=require('../../static/declarative-ui.js');
const sample=()=>({format:'buildplay-ui',version:1,viewport:{width:400,height:400},boards:[{id:'main',kind:'grid',x:10,y:20,width:300,height:300,rows:3,columns:3}],piece_types:{token:{shape:'circle'}},ui_code:'const gameUI={reduce(){return {scene:{}}}};'});

test('grid, explicit topology and free positions use board-relative logical units',()=>{
  const spec=sample();
  assert.deepEqual(api.position(spec,{board:'main',position:{cell:'4'}}),{x:160,y:170,board:spec.boards[0]});
  spec.boards.push({id:'path',kind:'track',x:40,y:50,width:100,height:100,cells:[{id:'home',x:30,y:40}]});
  assert.equal(api.position(spec,{board:'path',position:{cell:'home'}}).x,70);
  assert.equal(api.position(spec,{board:'path',position:{x:5,y:7}}).y,57);
  for(const cell of ['-1','09','9','unknown'])assert.throws(()=>api.position(spec,{board:'main',position:{cell}}),/Unknown board cell/);
  spec.boards[0].cells=[{id:'named',x:5,y:7}];
  assert.equal(api.position(spec,{board:'main',position:{cell:'named'}}).x,15);
  assert.throws(()=>api.position(spec,{board:'main',position:{cell:'0'}}),/Unknown board cell/);
  spec.boards[0].cells=[];
  assert.equal(api.position(spec,{board:'main',position:{cell:'0'}}).x,60);
});

test('scene identities and movement constraints reference declared nodes',()=>{
  const spec=sample();
  const scene={pieces:[{id:'one',type:'token',board:'main',position:{cell:'0'},move_targets:['destination']}],targets:[{id:'destination',board:'main',position:{cell:'1'}}]};
  assert.equal(api.validateScene(spec,scene),scene);
  scene.pieces[0].move_targets=['missing'];assert.throws(()=>api.validateScene(spec,scene),/Unknown move target/);
  scene.pieces[0].move_targets=[];scene.targets[0].id='one';assert.throws(()=>api.validateScene(spec,scene),/unique across/);
  scene.targets=[];scene.pieces[0].type='unknown';assert.throws(()=>api.validateScene(spec,scene),/Unknown piece type/);
});

test('renderer rejects explosive grids, non-finite geometry and unapproved image schemes',()=>{
  const spec=sample();spec.boards[0].rows=100000;assert.throws(()=>api.validateSpec(spec),/2048/);
  spec.boards[0].rows=3;spec.boards[0].width=Infinity;assert.throws(()=>api.validateSpec(spec),/non-finite/);
  for(const uri of ['javascript:alert(1)','file:///etc/passwd','http://insecure.test/a.png','data:text/html;base64,PHNjcmlwdD4='])assert.equal(api.assetURI({uri}),null);
  assert.equal(api.assetURI({uri:'data:image/png;base64,aGVsbG8='}),'data:image/png;base64,aGVsbG8=');
});

test('compatibility clients escape script terminators and contain platform code only',()=>{
  const spec=sample();spec.strings={title:'</script><img src=x onerror=alert(1)>'};
  const source=api.clientDocument(spec);
  assert.ok(source.includes('\\u003c/script>'));assert.ok(!source.includes('<img src=x'));
  const match=source.match(/id="declarative-spec">(.*?)<\/script>/s);assert.deepEqual(JSON.parse(match[1]),spec);
  assert.match(source,/event.source===parent/);assert.match(source,/type:"make_move"/);
});


test('dynamic scenes reject unknown fields, malformed positions and invalid transforms',()=>{
  const spec=sample();
  const piece={id:'one',type:'token',board:'main',position:{cell:'0'}};
  for(const extra of [{scale:0},{scale:101},{opacity:2},{rotation:'90'},{hidden:'yes'},{extra:1},{move_targets:['x','x']}])assert.throws(()=>api.validateScene(spec,{pieces:[{...piece,...extra}]}));
  assert.throws(()=>api.validateScene(spec,{pieces:[{...piece,position:{cell:'0',x:0,y:0}}]}));
  assert.throws(()=>api.validateScene(spec,{pieces:null}));
  assert.throws(()=>api.validateScene(spec,{custom:[]}));
  assert.throws(()=>api.validateScene(spec,{controls:[{id:'select',kind:'choice',label:'Choose',options:[]}]}));
});
