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

test('pieces and destinations accept bounded accessible names independently of artwork text',()=>{
  const spec=sample();
  const piece={id:'one',type:'token',board:'main',position:{cell:'0'},text:'1'};
  const target={id:'destination',board:'main',position:{cell:'1'},label:'2'};
  const scene={pieces:[{...piece,aria_label:'Alice’s counter at A1'}],targets:[{...target,aria_label:'Column two'}]};
  assert.equal(api.validateScene(spec,scene),scene);
  for(const value of [null,42,{},'', '🙂'.repeat(4001)]){
    assert.throws(()=>api.validateScene(spec,{pieces:[{...piece,aria_label:value}]}));
    assert.throws(()=>api.validateScene(spec,{targets:[{...target,aria_label:value}]}));
  }
  assert.doesNotThrow(()=>api.validateScene(spec,{pieces:[{...piece,aria_label:'🙂'.repeat(4000)}]}));
  assert.equal(scene.pieces[0].text,'1');assert.equal(scene.targets[0].label,'2');
});

test('roll animation metadata matches portable schema cases without granting actions',()=>{
  const spec=sample(),piece={id:'die',type:'token',board:'main',position:{cell:'0'},actions:[]};
  const cases=JSON.parse(fs.readFileSync(path.join(__dirname,'../fixtures/declarative/piece-animation-cases.json'),'utf8'));
  for(const {value,valid} of cases){
    const scene={pieces:[{...piece,animation:value}]};
    if(valid){assert.equal(api.validateScene(spec,scene),scene);assert.deepEqual(api.pieceActions(scene.pieces[0]),[]);}
    else assert.throws(()=>api.validateScene(spec,scene));
  }
  assert.doesNotThrow(()=>api.validateScene(spec,{pieces:[{...piece,animation:{kind:'roll',key:'r'.repeat(80)}}]}));
  assert.throws(()=>api.validateScene(spec,{pieces:[{...piece,animation:{kind:'roll',key:'r'.repeat(81)}}]}));
});

test('expanded target hit areas match portable schema geometry without changing marker positions',()=>{
  const spec=sample(),target={id:'destination',board:'main',position:{cell:'1'},label:'Point 2'};
  const cases=JSON.parse(fs.readFileSync(path.join(__dirname,'../fixtures/declarative/target-hit-area-cases.json'),'utf8'));
  for(const {value,valid} of cases){
    const scene={targets:[{...target,hit_area:value}]};
    if(valid){
      assert.equal(api.validateScene(spec,scene),scene);
      assert.deepEqual(api.position(spec,scene.targets[0]),api.position(spec,target));
    }else assert.throws(()=>api.validateScene(spec,scene));
  }
  assert.doesNotThrow(()=>api.validateScene(spec,{targets:[{...target,hit_area:{x:-100000,y:100000,width:100000,height:100000}}]}));
  assert.throws(()=>api.validateScene(spec,{targets:[{...target,hit_area:{x:Infinity,y:0,width:48,height:200}}]}));
  assert.throws(()=>api.validateScene(spec,{pieces:[{id:'piece',type:'token',board:'main',position:{cell:'0'},hit_area:cases[0].value}]}));
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

test('compatibility clients use the same versioned renderer assets as the portal',()=>{
  const portal=fs.readFileSync(path.join(__dirname,'../../static/portal.html'),'utf8');
  const source=api.clientDocument(sample());
  for(const extension of ['js','css']){
    const url=portal.match(new RegExp(`/static/declarative-ui\\.${extension}\\?v=\\d+`))[0];
    assert.ok(source.includes(`"${url}"`),`compatibility client must load ${url}`);
  }
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

test('piece actions distinguish legal interaction from decorative transforms',()=>{
  assert.deepEqual(api.pieceActions({actions:[],rotation:90,scale:2}),[]);
  assert.deepEqual(api.pieceActions({}),['tap']);
  assert.deepEqual(api.pieceActions({actions:['rotate','tap','scale'],move_targets:['home']}),['tap','move','rotate','scale']);
  assert.deepEqual(api.pieceActions({actions:[],move_targets:['home']}),['move']);
  assert.deepEqual(api.pieceActions({actions:['tap'],hidden:true}),[]);
  const spec=sample(),piece={id:'one',type:'token',board:'main',position:{cell:'0'}};
  for(const actions of [null,'tap',['spin'],['tap','tap'],['move']])assert.throws(()=>api.validateScene(spec,{pieces:[{...piece,actions}]}));
  assert.doesNotThrow(()=>api.validateScene(spec,{pieces:[{...piece,actions:['move','rotate','scale'],move_targets:['home']}],targets:[{id:'home',board:'main',position:{cell:'1'}}]}));
});

test('immersive fitting includes every board while excluding exterior headings',()=>{
  const spec=sample();
  spec.boards.push({id:'off',kind:'zone',x:350,y:20,width:40,height:300});
  assert.deepEqual(api.contentBounds(spec,{labels:[{id:'title',x:0,y:-1000,text:'Game title'}]}),{x:10,y:20,width:380,height:300});
});

test('immersive fitting preserves hands and legal destinations outside board surfaces',()=>{
  const spec=sample();spec.piece_types.card={shape:'card',width:80,height:40};
  const scene={pieces:[{id:'hand',type:'card',board:'main',position:{x:400,y:180},rotation:90,scale:2},
    {id:'hidden',type:'card',board:'main',position:{x:-900,y:-900},hidden:true}],
    targets:[{id:'outside',board:'main',position:{x:160,y:400}}]};
  const bounds=api.contentBounds(spec,scene);
  assert.equal(bounds.x,10);assert.equal(bounds.y,20);
  assert.equal(bounds.width,440);assert.equal(bounds.height,450);
});

test('camera margins expose every edge at overview, fitted and magnified zoom without losing the board',()=>{
  const board={x:20,y:105,width:764,height:440};
  for(const zoom of [.25,.8,1,1.5,4]){
    const limits=api.cameraLimits(board,zoom);
    const ordinaryX=board.x+Math.min(0,(board.width-limits.width)/2);
    const ordinaryY=board.y+Math.min(0,(board.height-limits.height)/2);
    assert.ok(limits.minX<ordinaryX);assert.ok(limits.minY<ordinaryY);
    assert.ok(limits.maxX>Math.max(ordinaryX,board.x+board.width-limits.width));
    assert.ok(limits.maxY>Math.max(ordinaryY,board.y+board.height-limits.height));
    for(const x of [limits.minX,limits.maxX])for(const y of [limits.minY,limits.maxY]){
      const overlapX=Math.min(x+limits.width,board.x+board.width)-Math.max(x,board.x);
      const overlapY=Math.min(y+limits.height,board.y+board.height)-Math.max(y,board.y);
      assert.ok(overlapX>=Math.min(limits.width,board.width)*.8);
      assert.ok(overlapY>=Math.min(limits.height,board.height)*.8);
    }
  }
});
