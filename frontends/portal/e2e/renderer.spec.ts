import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const spec=(code?:string)=>({format:'buildplay-ui',version:1,viewport:{width:400,height:300},boards:[{id:'board',kind:'grid',x:0,y:0,width:400,height:300,rows:3,columns:4}],
  piece_types:{token:{shape:'circle',width:56,height:56,color:'#b8eea2'},card:{shape:'card',width:60,height:78}},
  ui_code:code||`const gameUI={reduce(message,local){const state=message.type==='ui_event'?message.state_changed:message;const next={scene:{pieces:[{id:'token',type:'token',board:'board',position:{cell:String(state.view?.cell||0)},actions:['move','rotate','flip','scale'],move_targets:['destination'],aria_label:'Green token'},{id:'private',type:'card',board:'board',position:{cell:'7'},face:'back',text:'Secret ace',aria_label:'Secret ace',actions:[]}],targets:[{id:'destination',board:'board',position:{cell:'2'},label:'Place here'}],controls:[{id:'roll',kind:'button',label:'Roll dice'},{id:'amount',kind:'number',label:'Amount',value:2,min:1,max:5},{id:'choice',kind:'choice',label:'Choose side',value:false,options:[{label:'Left',value:false},{label:'Right',value:true}]}]},local_state:local};if(message.type==='ui_event')next.make_move={event:message.event};return next}};`});
const state=(extra:Record<string,unknown>={})=>({type:'state_changed',status:'ongoing',move_count:1,my_player_index:0,acting_for_player_index:0,view:{cell:0},...extra});

async function mount(page:Page,request:APIRequestContext,pkg=spec(),initial=state()){
  const response=await request.post('/games/declarative/client',{data:pkg});expect(response.ok(),await response.text()).toBeTruthy();
  const document=(await response.json()).client_code;
  await page.addInitScript(()=>{
    (window as any).__moves=[];(window as any).__ready=false;
    window.addEventListener('message',event=>{if(event.source!==window)return;if(event.data?.type==='make_move')(window as any).__moves.push(event.data.move);if(event.data?.type==='game_ready')(window as any).__ready=true;});
  });
  await page.route('**/renderer-fixture',route=>route.fulfill({contentType:'text/html',body:document}));
  await page.goto('/renderer-fixture');await page.waitForFunction(()=>(window as any).__ready);
  await send(page,initial);
}
async function send(page:Page,message:Record<string,unknown>){await page.evaluate(value=>window.postMessage(value,'*'),message);}
async function moves(page:Page){return page.evaluate(()=>(window as any).__moves);}

test('shared renderer isolates game code, guards replay, hides private identity and keeps controls accessible',async({page,request},info)=>{
  await mount(page,request);
  await expect(page.getByRole('button',{name:'Roll dice',exact:true})).toBeVisible();
  await expect(page.getByLabel('Secret ace')).toHaveCount(0);await expect(page.getByText('Secret ace')).toHaveCount(0);
  await expect(page.getByLabel('Covered piece',{exact:true})).toBeVisible();
  await send(page,state({replay:{index:0}}));
  await expect(page.getByRole('button',{name:'Roll dice',exact:true})).toBeDisabled();
  await expect(page.getByText('Reviewing match')).toBeVisible();
  await send(page,state({move_count:2}));await expect(page.getByRole('button',{name:'Roll dice',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Roll dice',exact:true}).click();
  await expect.poll(()=>moves(page)).toEqual([{event:{type:'tap',id:'roll'}}]);
  await expect(page.getByRole('button',{name:'Roll dice',exact:true})).toBeDisabled();
  await page.screenshot({path:info.outputPath('shared-renderer.png'),fullPage:true});
});

test('piece selection exposes rotate/flip/resize and a legal destination submits one move',async({page,request})=>{
  await mount(page,request);
  const piece=page.getByRole('button',{name:/Green token/});await expect(piece).toBeVisible();
  await piece.click();
  await expect(page.getByRole('button',{name:'Rotate clockwise',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Make piece larger',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Rotate clockwise',exact:true}).click();
  await expect.poll(()=>moves(page)).toEqual([{event:{type:'rotate',id:'token',delta:90}}]);
  await send(page,state({move_count:2}));await expect(page.getByRole('button',{name:'Roll dice',exact:true})).toBeEnabled();
  await piece.click();await page.getByRole('button',{name:'Place here',exact:true}).click();
  await expect.poll(()=>moves(page)).toHaveLength(2);
  expect((await moves(page))[1]).toEqual({event:{type:'drop',id:'token',piece_id:'token',target_id:'destination'}});
});

test('board zoom and keyboard/pointer gestures never emit a move and fixed-camera games stay fitted',async({page,request,isMobile})=>{
  await mount(page,request);
  await expect(page.getByRole('button',{name:'Reset board view'})).toHaveText('100%');
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await expect(page.getByRole('button',{name:'Reset board view'})).toHaveText('125%');
  await page.getByRole('button',{name:'Reset board view'}).click();
  if(!isMobile){
    await page.getByLabel('Game board. Use pieces and highlighted destinations. Zoom controls are above the board.').focus();
    await page.keyboard.press('+');await expect(page.getByRole('button',{name:'Reset board view'})).toHaveText('125%');
    await page.keyboard.press('0');
  }
  expect(await moves(page)).toEqual([]);
  const fixed={...spec(),viewport:{width:400,height:300,camera_enabled:false}};
  await mount(page,request,fixed);await expect(page.getByRole('button',{name:'Roll dice',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Zoom in',exact:true})).toHaveCount(0);
});

test('a reducer cannot access credentials or make network requests and an infinite loop is terminated',async({page,request})=>{
  const code=`const gameUI={reduce(){return {scene:{labels:[{id:'isolation',x:20,y:20,text:[typeof localStorage,typeof document,typeof fetch,typeof XMLHttpRequest].join(',')}]}}}};`;
  await mount(page,request,spec(code));await expect(page.getByText('undefined,undefined,undefined,undefined')).toBeVisible();
  // Client generation validates scenes using server QuickJS, so a deliberate
  // runtime loop is introduced only in this browser fixture after validation.
  const good=await request.post('/games/declarative/client',{data:spec()});
  let document=(await good.json()).client_code;
  const looping=spec('const gameUI={reduce(){while(true){}}};');
  document=document.replace(/(<script type="application\/json" id="declarative-spec">).*?(<\/script>)/s,`$1${JSON.stringify(looping).replace(/</g,'\\u003c')}$2`);
  await page.route('**/renderer-loop',route=>route.fulfill({contentType:'text/html',body:document}));
  await page.goto('/renderer-loop');await page.waitForFunction(()=>(window as any).__ready);await send(page,state());
  await expect(page.getByRole('alert')).toContainText('time limit',{timeout:10000});
});

test('mouse drags commit only declared destinations and cancelled drags cannot submit a move',async({page,request})=>{
  await mount(page,request);
  const token=page.getByRole('button',{name:/Green token/}).locator('ellipse'),target=page.getByRole('button',{name:'Place here',exact:true});
  await expect(token).toBeVisible();
  const from=(await token.boundingBox())!,to=(await target.boundingBox())!;
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
  await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:10});await page.mouse.up();
  await expect.poll(()=>moves(page)).toEqual([{event:{type:'drop',id:'token',piece_id:'token',target_id:'destination'}}]);
  await send(page,state({move_count:2}));await expect(page.getByRole('button',{name:'Roll dice',exact:true})).toBeEnabled();
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
  await page.mouse.move(2,2,{steps:10});await page.mouse.up();
  expect(await moves(page)).toHaveLength(1);
});

test('pinching cancels a held piece, zooms the board and leaves the move queue untouched',async({page,request,browserName})=>{
  test.skip(browserName!=='chromium','Chromium CDP supplies reproducible multi-touch input');
  await mount(page,request);
  const token=page.getByRole('button',{name:/Green token/}).locator('ellipse');await expect(token).toBeVisible();
  const box=(await token.boundingBox())!,center={x:box.x+box.width/2,y:box.y+box.height/2};
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...center,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...center,id:1},{x:center.x+80,y:center.y+100,id:2}]});
  for(let step=1;step<=6;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:center.x,y:center.y,id:1},{x:center.x+80+step*9,y:center.y+100+step*9,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.getByRole('button',{name:'Reset board view'})).not.toHaveText('100%');
  expect(await moves(page)).toEqual([]);
});

test('downloaded Backgammon renders original artwork, physical dice and declared checker destinations',async({page,request},info)=>{
  const game=JSON.parse(readFileSync(path.resolve(__dirname,'../../../games/declarative/backgammon.json'),'utf8'));
  const view=structuredClone(game.unit_tests.cases[0].view_of_mover);
  for(const key of ['configured','opening','opening_roll','can_undo','cube','can_double','difficulty','goal','scores','round_winner','cube_enabled','undo_stack','last_roll','combinedMoves'])delete view[key];
  Object.assign(view,{cur:0,n:0,winner:null,needRoll:true,dice:[],moves:[],legalMoves:[]});
  const players=[{player_index:0,name:'Alice',kind:'human'},{player_index:1,name:'Bob',kind:'human'}];
  await page.emulateMedia({reducedMotion:'reduce'});
  await mount(page,request,game.declarative_ui,state({view,state:view,players,strings:game.declarative_ui.strings,move_count:0,turn_of_player_indices:[0]}));
  const die=page.getByRole('button',{name:/^Die 1: roll dice/});await expect(die).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.locator('svg image,svg svg').count()).toBeGreaterThan(20);
  await page.screenshot({path:info.outputPath('backgammon-shared-board.png'),fullPage:true});
  await die.click();await expect.poll(()=>moves(page)).toEqual([{action:'roll'}]);
  const rolled={...view,needRoll:false,dice:[3,3,3,3],moves:[3,3,3,3],legalMoves:[{from:5,to:2,die:3}]};
  await send(page,state({view:rolled,state:rolled,players,strings:game.declarative_ui.strings,move_count:1,last_move_player_index:0,turn_of_player_indices:[0]}));
  const checker=page.getByRole('button',{name:/^Player 1: Point 6: Move/});await expect(checker).toBeEnabled({timeout:10000});await checker.click();
  const destination=page.getByRole('button',{name:/^Point 3$/});await expect(destination).toBeEnabled();await destination.click();
  await expect.poll(()=>moves(page)).toEqual([{action:'roll'},{action:'move',from:5,to:2}]);
});

test('stored historical HTML hosts load the shared renderer through opaque frames without static CORS',async({page})=>{
  await page.route('**/static/**',async route=>{
    const response=await route.fetch(),headers={...response.headers()};
    delete headers['access-control-allow-origin'];delete headers['access-control-allow-credentials'];
    await route.fulfill({response,headers});
  });
  const json=JSON.stringify(spec()).replace(/</g,'\\u003c');
  // The exact v19 platform wrapper remains in stored version-pinned packages.
  const historical=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/declarative-ui.css?v=19"><div id="declarative-game"></div><script type="application/json" id="i18n-strings">{}</script><script type="application/json" id="declarative-spec">${json}</script><script src="/static/declarative-ui.js?v=19"></script><script>const host=DeclarativeUI.mount(document.getElementById('declarative-game'),JSON.parse(document.getElementById('declarative-spec').textContent),{onMove:move=>parent.postMessage({type:'make_move',move},'*'),onReady:()=>parent.postMessage({type:'game_ready'},'*')});addEventListener('message',event=>{if(event.source===parent&&event.data?.type==='state_changed')host.send(event.data)});</script>`;
  const harness=`<!doctype html><style>html,body{margin:0;height:100%}iframe{height:100%;width:100%;border:0}</style><iframe id="legacy" title="Historical game host" sandbox="allow-scripts"></iframe><script>window.legacyReady=false;window.legacyMoves=[];const frame=document.getElementById('legacy');addEventListener('message',event=>{if(event.source!==frame.contentWindow)return;if(event.data?.type==='game_ready')window.legacyReady=true;if(event.data?.type==='make_move')window.legacyMoves.push(event.data.move)});frame.srcdoc=${JSON.stringify(historical).replace(/</g,'\\u003c')};</script>`;
  await page.route('**/historical-host',route=>route.fulfill({contentType:'text/html',body:harness}));
  await page.goto('/historical-host');await page.waitForFunction(()=>(window as any).legacyReady);
  const sendLegacy=(value:Record<string,unknown>)=>page.evaluate(value=>(document.getElementById('legacy') as HTMLIFrameElement).contentWindow!.postMessage(value,'*'),value);
  await sendLegacy(state());
  const historicalFrame=page.frameLocator('#legacy'),shared=historicalFrame.frameLocator('#declarative-game > iframe');
  await expect(shared.getByRole('button',{name:'Roll dice',exact:true})).toBeEnabled();
  // A sibling/parent message cannot impersonate the shared renderer's frame.
  const outer=page.frames().find(frame=>frame.parentFrame()===page.mainFrame())!;
  await outer.evaluate(()=>window.postMessage({type:'make_move',move:{forged:true}},'*'));
  expect(await page.evaluate(()=>(window as any).legacyMoves)).toEqual([]);
  await shared.getByRole('button',{name:'Roll dice',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).legacyMoves)).toEqual([{event:{type:'tap',id:'roll'}}]);
  // An explicitly resent authoritative snapshot must permit a retry even when
  // its state and move count are identical after a rejected parent-side call.
  await sendLegacy(state());await expect(shared.getByRole('button',{name:'Roll dice',exact:true})).toBeEnabled();
  await shared.getByRole('button',{name:'Roll dice',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).legacyMoves)).toHaveLength(2);
  await sendLegacy(state({move_count:2,replay:{index:0}}));
  await expect(shared.getByRole('button',{name:'Roll dice',exact:true})).toBeDisabled();
});

test('a draggable tappable piece preserves stationary clicks, focus, keyboard activation and real drops',async({page,request,isMobile})=>{
  const pkg=spec(`const gameUI={reduce(m){return {scene:{pieces:[{id:'card',type:'card',board:'board',position:{cell:'0'},aria_label:'Playable card',actions:['tap','move'],move_targets:['destination']}],targets:[{id:'destination',board:'board',position:{cell:'2'},label:'Card destination'}]},...(m.type==='ui_event'?{make_move:{action:m.event.type}}:{})}}};`);
  await mount(page,request,pkg);
  const card=page.getByRole('button',{name:/^Playable card/});await expect(card).toBeVisible();
  await card.click();await expect.poll(()=>moves(page)).toEqual([{action:'tap'}]);
  if(!isMobile)await expect(card).toBeFocused();
  await send(page,state({move_count:2}));await expect(card).toHaveAttribute('aria-disabled','false');
  await card.focus();await page.keyboard.press('Enter');
  await expect.poll(()=>moves(page)).toEqual([{action:'tap'},{action:'tap'}]);
  await send(page,state({move_count:3}));await expect(card).toHaveAttribute('aria-disabled','false');
  const from=(await card.locator('rect').first().boundingBox())!,to=(await page.getByRole('button',{name:'Card destination'}).boundingBox())!;
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:10});await page.mouse.up();
  await expect.poll(()=>moves(page)).toEqual([{action:'tap'},{action:'tap'},{action:'drop'}]);
});

const replaySpec=()=>spec(`const gameUI={reduce(m){const s=m.type==='ui_event'?m.state_changed:m;return {scene:{pieces:s.view.n===0||s.view.n===3?[]:[{id:'counter',type:'token',board:'board',position:{x:50+s.view.n*80,y:150},text:s.view.secret||String(s.view.n),aria_label:'Recorded counter',actions:['tap']}]},...(m.type==='ui_event'?{make_move:{forged:true}}:{})}}};`);

test('adjacent replay animates placements, counter changes, reversals and inert removal ghosts',async({page,request})=>{
  await mount(page,request,replaySpec(),state({move_count:0,view:{n:0},replay:{index:0,total:3}}));
  for(const count of [1,2,3,2,1,0]){
    await send(page,state({move_count:count,view:{n:count},last_move_player_index:0,replay:{index:count,total:3}}));
    if(count===0||count===3){
      const ghost=page.getByTestId('history-ghost');await expect(ghost).toHaveCount(1);
      await expect(ghost).toHaveAttribute('aria-hidden','true');await expect(ghost).toHaveAttribute('pointer-events','none');
      await expect(ghost).not.toHaveAttribute('role','button');
      await expect(ghost).toHaveCount(0,{timeout:5000});
    }else{
      const counter=page.getByRole('button',{name:/Recorded counter/});await expect(counter).toBeVisible();
      await expect(counter.locator('text').first()).toHaveText(String(count));
      await expect(counter).toHaveAttribute('aria-disabled','true');
      await counter.focus();await page.keyboard.press('Enter');
      // Wait for the actual replay transition instead of cutting it short.
      await expect.poll(()=>counter.getAttribute('opacity')).toBe('1');
    }
  }
  expect(await moves(page)).toEqual([]);
});

test('viewer changes clear an already fading private face even when the new scene and count are unchanged',async({page,request})=>{
  for(const viewer of [1,null]){
    await mount(page,request,replaySpec(),state({move_count:1,view:{n:1,secret:'Seat zero private face'},replay:{index:1,total:2}}));
    await expect(page.getByText('Seat zero private face')).toBeVisible();
    const empty=state({move_count:2,view:{n:3},replay:{index:2,total:2}});
    await send(page,empty);await expect(page.getByTestId('history-ghost')).toHaveCount(1);
    await send(page,{...empty,my_player_index:viewer});
    await expect(page.getByTestId('history-ghost')).toHaveCount(0);
    await expect(page.getByText('Seat zero private face')).toHaveCount(0);
  }
});

test('reduced-motion replay settles immediately and remains read only',async({page,request})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await mount(page,request,replaySpec(),state({move_count:0,view:{n:0},replay:{index:0,total:3}}));
  await send(page,state({move_count:1,view:{n:1},replay:{index:1,total:3}}));
  const counter=page.getByRole('button',{name:/Recorded counter/});await expect(counter).toHaveAttribute('opacity','1');
  await send(page,state({move_count:2,view:{n:3},replay:{index:2,total:3}}));
  await expect(counter).toHaveCount(0);await expect(page.getByTestId('history-ghost')).toHaveCount(0);
  expect(await moves(page)).toEqual([]);
});
