const {test}=require('node:test');
const assert=require('node:assert/strict');
const api=require('../../static/declarative-ui.js');
const sample=()=>({format:'buildplay-ui',version:1,viewport:{width:400,height:400},boards:[{id:'main',kind:'grid',x:10,y:20,width:300,height:300,rows:3,columns:3}],piece_types:{token:{shape:'circle'}},assets:{},ui_code:'const gameUI={reduce(){return {scene:{}}}};'});
const piece={id:'one',type:'token',board:'main',position:{cell:'0'}};
const target={id:'home',board:'main',position:{cell:'4'}};

test('flip is a declared piece action, ordered after rotate',()=>{
  assert.deepEqual(api.pieceActions({actions:['scale','flip','rotate','tap']}),['tap','rotate','flip','scale']);
  assert.doesNotThrow(()=>api.validateScene(sample(),{pieces:[{...piece,actions:['tap','move','rotate','flip','scale'],move_targets:['home']}],targets:[target]}));
  for(const actions of [['flip','flip'],['mirror']])assert.throws(()=>api.validateScene(sample(),{pieces:[{...piece,actions}]}));
});

test('target previews are bounded ghost cells on the target board',()=>{
  const spec=sample();
  const ok=[{position:{cell:'4'},color:'#4f8cff',rotation:90,text:'2'},{position:{x:5,y:6}}];
  assert.doesNotThrow(()=>api.validateScene(spec,{targets:[{...target,preview:ok}]}));
  for(const preview of [[],'4',[{}],[{position:{cell:'9'}}],[{position:{cell:'1'},asset:'missing'}],[{position:{cell:'1'},color:'blue'}],
    [{position:{cell:'1'},opacity:.5}],[{position:{cell:'1'},text:'x'.repeat(41)}],Array(65).fill({position:{cell:'1'}})])
    assert.throws(()=>api.validateScene(spec,{targets:[{...target,preview}]}),undefined,JSON.stringify(preview).slice(0,80));
  assert.throws(()=>api.validateScene(spec,{pieces:[{...piece,preview:ok}]}),/Invalid UI object fields/);
});
