// Feedback in the portal: the feedback form (kinds, titles, sending), and who can get it.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

const read=name=>fs.readFileSync(path.join(__dirname,'../../static',name),'utf8');
const I18n={t:(key,params,fallback)=>fallback??key,locale:()=>'en',revision:()=>0,
  gameName:(id,fallback)=>fallback,gameDescription:(id,fallback)=>fallback,gameText:async()=>({locale:'en',direction:'ltr'})};

function loadDialog() {
  const window={};
  vm.runInContext(read('feedback-dialog.js'),vm.createContext({window,I18n,navigator:{onLine:true},String,Math}));
  return window.FeedbackDialog;
}

const target={type:'user',id:'bob',name:'Bob'};
const user={id:'ann',password:'pw'};

test('the counter, and Send only with at least 5 characters (after trimming)',()=>{
  const dialog=loadDialog();
  const form=dialog.createForm({target,kind:'problem',user,page:'/portal',request:async()=>{}});
  assert.equal(form.counter(),'0 / 1000');assert.equal(form.canSend(),false);
  form.input('   abcd   ');assert.equal(form.canSend(),false);
  form.input('abcde');assert.equal(form.canSend(),true);assert.equal(form.counter(),'5 / 1000');
  form.input('x'.repeat(1200));assert.equal(form.text.length,1000);assert.equal(form.counter(),'1000 / 1000');
});

test('sending posts the kind and the target, and then says thanks',async()=>{
  const calls=[];
  const dialog=loadDialog();
  const request=async(method,url,opts)=>{calls.push([method,url,opts]);return {id:'f1'};};
  const form=dialog.createForm({target:{type:'game',id:'g1',name:'Poker'},user,page:'/static/portal.html#match=m1',request});
  assert.equal(form.kind,'bug'); // the default
  form.setKind('suggestion');form.setKind('praise'); // not a kind: ignored
  form.input('  An undo button  ');
  assert.equal(await form.submit(),true);
  assert.equal(form.sent,true);assert.equal(form.canSend(),false);
  // The platform has no target id.
  const platform=dialog.createForm({target:{type:'platform',id:'',name:''},user,request});
  platform.input('The menu is slow');
  assert.equal(await platform.submit(),true);
  assert.deepEqual(calls.map(([m,u,o])=>[m,u,o.user,{...o.body}]),[
    ['POST','/feedback',user,{kind:'suggestion',target_type:'game',target_id:'g1',text:'An undo button',page:'/static/portal.html#match=m1'}],
    ['POST','/feedback',user,{kind:'bug',target_type:'platform',text:'The menu is slow',page:undefined}]]);
});

test('errors are shown: too short, the daily limit from the server, and offline',async()=>{
  const dialog=loadDialog();
  const short=dialog.createForm({target,user,request:async()=>{throw new Error('never sent');}});
  short.input('hi');
  assert.equal(await short.submit(),false);assert.equal(short.error,'Write at least 5 characters.');
  const limited=dialog.createForm({target,user,request:async()=>{throw new Error('you can send at most 20 feedback messages a day; try again tomorrow');}});
  limited.input('spam spam spam');
  assert.equal(await limited.submit(),false);
  assert.equal(limited.error,'you can send at most 20 feedback messages a day; try again tomorrow');
  assert.equal(limited.sent,false);assert.equal(limited.canSend(),true); // they can fix it and try again
  limited.input('spam spam spam!');assert.equal(limited.error,'');
  const offline=dialog.createForm({target,user,request:async()=>{throw new Error('never sent');},online:()=>false});
  offline.input('a long enough reason');
  assert.equal(await offline.submit(),false);assert.equal(offline.error,'Connect to the internet to send feedback.');
});

test('the title follows the kind, and the dialog says what the feedback is about',()=>{
  const dialog=loadDialog();
  assert.deepEqual(Array.from(dialog.KINDS,kind=>dialog.titleFor(kind)),['Report a bug','Suggest something',"What's wrong?"]);
  assert.equal(dialog.aboutText({type:'user',name:'Bob'}),'About Bob');
  assert.equal(dialog.aboutText({type:'game',name:'Poker'}),'About the game Poker');
  assert.equal(dialog.aboutText({type:'match',name:'Poker'}),'About this match of Poker');
  assert.equal(dialog.aboutText({type:'platform'}),'About the website');
});

// Who can be reported, through the real portal.js (set up like portal.test.cjs).
function setupPortal(me) {
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id)) nodes.set(id,{value:'',hidden:false,disabled:false,dataset:{},children:[],classList:{toggle(){}},
      replaceChildren(...children){this.children=children;},setAttribute(){},addEventListener(){},focus(){}});
    return nodes.get(id);
  };
  const ctx=vm.createContext({console,Map,Set,URLSearchParams,Date,Math,Number,String,
    navigator:{onLine:true},localStorage:{},PortalOffline:class {async api(){return {};}read(){return {};}write(){}},
    document:{getElementById:node,body:{classList:{toggle(){}}}},window:{addEventListener(){}},
    location:{hash:'',search:'',assign(){}},history:{replaceState(){}},
    Auth:{current:()=>me},I18n,GameFrame:class{load(){}unload(){}send(){}},
    apiRequest:async()=>({}),formatTime:()=>'',shortId:x=>x,showPageError(){},el:(tag,attrs={},...children)=>({...attrs,children})});
  vm.runInContext(read('portal.js').replace(/main\(\);\s*$/,''),ctx);
  const run=code=>vm.runInContext(code,ctx);
  run('refresh=async()=>{}');
  return {node,run};
}

test('a player can be reported only by someone else, and only as a human in an online match',()=>{
  const {run}=setupPortal({id:'ann'});
  const match=JSON.stringify({localMode:false});
  assert.equal(run(`canReportPlayer(${match},{kind:'human',user_id:'bob'},{id:'ann'})`),true);
  assert.equal(run(`canReportPlayer(${match},{kind:'human',user_id:'ann'},{id:'ann'})`),false); // yourself
  assert.equal(run(`canReportPlayer(${match},{kind:'computer',user_id:null},{id:'ann'})`),false);
  assert.equal(run(`canReportPlayer({localMode:'computer'},{kind:'human',user_id:'bob'},{id:'ann'})`),false);
  assert.equal(run(`canReportPlayer(${match},{kind:'human',user_id:'bob'},null)`),false); // logged out
});

test('a game can get feedback from its page, but not your own game',()=>{
  const {node,run}=setupPortal({id:'ann'});
  run('state.games=[{id:"g1",version:1,name:"Poker",owner_user_id:"bob",allowed_player_counts:[2,4]},{id:"g2",version:1,name:"Mine",owner_user_id:"ann",allowed_player_counts:[2]}]');
  node('new-game').value='g1';run('updateMatchSetup()');
  assert.equal(node('feedback-game').hidden,false);assert.equal(typeof node('feedback-game').onclick,'function');
  node('new-game').value='g2';run('updateMatchSetup()');
  assert.equal(node('feedback-game').hidden,true);
});

test('the page loads the feedback files, and the offline cache lists them',()=>{
  const sw=read('portal-sw.js'),html=read('portal.html');
  for(const file of ['feedback-dialog.js','feedback-dialog.css']) {
    const version=html.match(new RegExp(`/static/${file.replace('.','\\.')}\\?v=\\d+`))[0];
    assert.ok(sw.includes(`"${version}"`),`${version} in portal-sw.js`);
  }
  assert.ok(html.indexOf('feedback-dialog.js')<html.indexOf('/static/portal.js'));
});
