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
  await page.route('**/renderer-fixture',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:document}));
  await page.goto('/renderer-fixture');await page.waitForFunction(()=>(window as any).__ready);
  await send(page,initial);
}
async function send(page:Page,message:Record<string,unknown>){await page.evaluate(value=>window.postMessage(value,'*'),message);}
async function moves(page:Page){return page.evaluate(()=>(window as any).__moves);}

test('a coalesced computer batch paints its intermediate accepted boards in order',async({page,request})=>{
  const pkg={...spec(`const gameUI={reduce(message){const m=message.type==='ui_event'?message.state_changed:message;return {scene:{pieces:[{id:'token',type:'token',board:'board',position:{cell:String(m.view.n%12)},aria_label:'Batch token',actions:[]}],labels:[{id:'step',x:8,y:285,text:'Accepted step '+m.view.n}]}}}};`),motion:{move_ms:120}};
  await mount(page,request,pkg,state({move_count:0,view:{n:0},last_move_player_index:null}));
  await expect(page.getByText('Accepted step 0',{exact:true})).toBeVisible();
  await page.evaluate(()=>{
    (window as any).__acceptedSteps=[];
    const observer=new MutationObserver(()=>{
      const label=[...document.querySelectorAll('svg text')].find(node=>node.textContent?.startsWith('Accepted step '));
      const value=Number(label?.textContent?.slice('Accepted step '.length));
      const seen=(window as any).__acceptedSteps;
      if(Number.isInteger(value)&&value!==seen.at(-1))seen.push(value);
    });observer.observe(document.body,{subtree:true,childList:true,characterData:true});
  });
  await send(page,state({move_count:13,view:{n:13},last_move_player_index:1,presentation_history:Array.from({length:12},(_,i)=>({view:{n:i+1},move_count:i+1,last_move_player_index:i===0?0:1}))}));
  await expect(page.getByText('Accepted step 13',{exact:true})).toBeVisible();
  const painted=await page.evaluate(()=>(window as any).__acceptedSteps as number[]);
  expect(painted.filter(n=>n>=2)).toEqual(Array.from({length:12},(_,i)=>i+2));
  expect(await moves(page)).toEqual([]);
});

test('an occupied legal destination keeps the selected source for taps while other pieces remain draggable',async({page,request,isMobile})=>{
  const pkg=spec(`const gameUI={reduce(message){const m=message.type==='ui_event'?message.state_changed:message;return {scene:{pieces:[
    {id:'reserve',type:'token',board:'board',position:{cell:'0'},aria_label:'Reserve tile',actions:['move'],move_targets:['occupied']},
    {id:'built',type:'token',board:'board',position:{cell:'2'},aria_label:'Built tile',actions:['move'],move_targets:['other']}],
    targets:[{id:'occupied',board:'board',position:{cell:'2'},label:'Swap here'},{id:'other',board:'board',position:{cell:'3'},label:'Other destination'}],
    labels:[{id:'revision',x:10,y:200,text:'Revision '+m.move_count}]},...(message.type==='ui_event'?{make_move:message.event}:{})};}};`);
  await mount(page,request,pkg);await expect(page.getByText('Revision 1',{exact:true})).toBeVisible();
  const reserve=page.getByRole('button',{name:'Reserve tile: Move',exact:true}),destination=page.getByRole('button',{name:'Swap here',exact:true});
  if(isMobile){await reserve.tap();await destination.tap();}else{await reserve.click();await destination.click();}
  await expect.poll(()=>moves(page)).toEqual([{type:'drop',id:'reserve',piece_id:'reserve',target_id:'occupied'}]);
  await send(page,state({move_count:2}));await expect(page.getByText('Revision 2',{exact:true})).toBeVisible();
  await reserve.click();const source=(await page.getByRole('button',{name:'Built tile: Move',exact:true}).boundingBox())!,target=(await page.getByRole('button',{name:'Other destination',exact:true}).boundingBox())!;
  await page.mouse.move(source.x+source.width/2,source.y+source.height/2);await page.mouse.down();
  await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:10});await page.mouse.up();
  await expect.poll(()=>moves(page)).toEqual([{type:'drop',id:'reserve',piece_id:'reserve',target_id:'occupied'},{type:'drop',id:'built',piece_id:'built',target_id:'other'}]);
});

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

test('scene labels keep their declared left edge in an Arabic document',async({page,request})=>{
  await mount(page,request,spec(`const gameUI={reduce(){return {scene:{labels:[{id:'arabic',x:24,y:24,text:'مرحبا بالعالم 123',font_size:20}]}}}};`));
  await page.evaluate(()=>{document.documentElement.dir='rtl';document.documentElement.lang='ar';});
  const label=page.getByText('مرحبا بالعالم 123',{exact:true});await expect(label).toBeVisible();
  const box=await label.evaluate(node=>{const b=(node as unknown as SVGTextElement).getBBox();return {x:b.x,width:b.width};});
  expect(box.x).toBeGreaterThanOrEqual(23);expect(box.x).toBeLessThanOrEqual(25);
});

test('Connect Four SVG discs stay centered in their rack holes with native nested-SVG positioning',async({page,request},info)=>{
  const {game}=JSON.parse(readFileSync(path.resolve(__dirname,'../../../tests/fixtures/declarative/connect4-native-package.json'),'utf8'));
  const board=Array(42).fill(-1),disc_ids=Array(42).fill(-1);
  for(const [index,[cell,seat]] of [[35,0],[37,1],[38,0],[39,1],[40,0],[41,1],[32,0],[25,1]].entries()){
    board[cell]=seat;disc_ids[cell]=index;
  }
  const view={board,disc_ids,turn:0,turns:8,over:false,winner:-1,legal:Array.from({length:7},(_,column)=>({column}))};
  await page.emulateMedia({reducedMotion:'reduce'});
  await mount(page,request,game.declarative_ui,state({view,state:view,move_count:8,turn_of_player_indices:[0],strings:game.declarative_ui.strings}));
  const rack=page.locator('svg svg').filter({has:page.locator('circle[cx="37"][cy="284"][r="23"]')}).first();
  const first=page.getByLabel('Player 1 disc, row 6, column 1',{exact:true}).locator('circle').first();
  await expect(first).toBeVisible();
  const assertCenters=async()=>{
    for(const [cell,seat] of [[35,0],[37,1],[38,0],[39,1],[40,0],[41,1],[32,0],[25,1]]){
      const row=Math.floor(cell/7),column=cell%7;
      const piece=page.getByLabel(`Player ${seat+1} disc, row ${row+1}, column ${column+1}`,{exact:true}).locator('circle').first();
      const hole=rack.locator(`circle[cx="${37+50*column}"][cy="${34+50*row}"][r="23"]`).first();
      const a=(await piece.boundingBox())!,b=(await hole.boundingBox())!;
      expect(Math.abs(a.x+a.width/2-b.x-b.width/2)).toBeLessThan(.5);
      expect(Math.abs(a.y+a.height/2-b.y-b.height/2)).toBeLessThan(.5);
    }
  };
  await assertCenters();
  // RNSVGGroup's native nested viewports draw at (0,0), without the XML
  // root's x/y placement. Model that backend here: the old negative offsets
  // shift every disc half its size, while explicit parent transforms stay put.
  await page.locator('svg svg').evaluateAll(nodes=>nodes.forEach(node=>{node.removeAttribute('x');node.removeAttribute('y');}));
  await assertCenters();
  await page.setViewportSize({width:480,height:640});
  await expect(assertCenters).toPass({timeout:5000});
  await page.screenshot({path:info.outputPath('connect4-native-svg-centers.png'),fullPage:true});
});

test('fitted native scenes retain instructions inside the complete declared viewport',async({page,request})=>{
  const pkg={...spec(`const gameUI={reduce(){return {scene:{labels:[{id:'instruction',x:20,y:440,text:'Keep this complete instruction visible',font_size:18}]}}}};`),viewport:{width:400,height:500},boards:[{id:'board',kind:'zone',x:20,y:20,width:180,height:180}]};
  await mount(page,request,pkg);const label=page.getByText('Keep this complete instruction visible',{exact:true});await expect(label).toBeVisible();
  const board=page.getByLabel('Game board. Use pieces and highlighted destinations.');
  await label.scrollIntoViewIfNeeded();const caption=(await label.boundingBox())!,canvas=(await board.boundingBox())!;
  expect(caption.y).toBeGreaterThanOrEqual(canvas.y);expect(caption.y+caption.height).toBeLessThanOrEqual(canvas.y+canvas.height+1);
  await expect(label).toBeInViewport();
});

test('short-screen height fitting preserves 32px physical bodies and destinations',async({page,request})=>{
  const pkg={format:'buildplay-ui',version:1,viewport:{width:1120,height:1100},boards:[{id:'table',kind:'zone',x:0,y:0,width:1120,height:1100}],
    piece_types:{domino:{shape:'rect',width:224,height:112}},
    ui_code:`const gameUI={reduce(){return {scene:{pieces:[{id:'tile',type:'domino',board:'table',position:{x:300,y:700},aria_label:'Physical domino',actions:['move'],move_targets:['end']}],targets:[{id:'end',board:'table',position:{x:800,y:700},label:'Legal end',hit_area:{width:224,height:112,x:-112,y:-56}}]}}}};`};
  for(const viewport of [{width:320,height:480},{width:480,height:320},{width:844,height:390}]){
    await page.setViewportSize(viewport);await mount(page,request,pkg);
    const body=page.getByRole('button',{name:/Physical domino/}).locator('rect').first();await expect(body).toBeAttached();
    await expect.poll(async()=>{const box=(await body.boundingBox())!;return Math.min(box.width,box.height);}).toBeGreaterThanOrEqual(31.99);
    const target=(await page.getByRole('button',{name:'Legal end',exact:true}).locator('rect').first().boundingBox())!;
    expect(Math.min(target.width,target.height)).toBeGreaterThanOrEqual(31.99);
  }
});

for(const viewport of [{width:320,height:480},{width:844,height:390}])test(`scaled offset grid target bounds retain their matching physical tap destinations at ${viewport.width}x${viewport.height}`,async({page,request})=>{
  const pkg={...spec(`const gameUI={reduce(m){return {scene:{targets:Array.from({length:9},(_,cell)=>({id:'cell_'+cell,board:'board',position:{cell:String(cell)},label:'Cell '+(cell+1)}))},...(m.type==='ui_event'?{make_move:{cell:Number(m.event.id.slice(5))}}:{})}}};`),
    viewport:{width:600,height:560},boards:[{id:'board',kind:'grid',x:24,y:100,width:400,height:400,rows:3,columns:3}]};
    await page.setViewportSize(viewport);await mount(page,request,pkg);
    for(const [index,cell] of [1,4,3].entries()){
      if(index)await send(page,state({move_count:index+1}));
      const target=page.getByRole('button',{name:`Cell ${cell}`,exact:true});await expect(target).toHaveAttribute('aria-disabled','false');
      await target.scrollIntoViewIfNeeded();const node=(await target.boundingBox())!,body=(await target.locator('rect').boundingBox())!;
      expect(Math.abs(node.x-body.x)).toBeLessThanOrEqual(1);expect(Math.abs(node.y-body.y)).toBeLessThanOrEqual(1);
      await target.click();await expect.poll(()=>moves(page)).toEqual([1,4,3].slice(0,index+1).map(value=>({cell:value-1})));
    }
});

test('scene controls wrap complete 200-codepoint Unicode names inside the native viewport',async({page,request})=>{
  const pkg=spec(`const gameUI={reduce(m){const s=m.type==='ui_event'?m.state_changed:m;return {scene:{controls:[{id:'status',kind:'button',label:s.view.name||'Player',disabled:true}]}}}};`);
  const names=['مرحباالعالم世界🙂Ω'.repeat(20),'Alice العربية 中文 👩🏽‍🚀🦊'.repeat(20)].map(name=>Array.from(name).slice(0,200).join(''));
  for(const viewport of [{width:320,height:480},{width:480,height:320},{width:820,height:1180},{width:1180,height:820}]){
    await page.setViewportSize(viewport);await mount(page,request,pkg,state({view:{name:names[0]}}));
    for(const name of names){
      await send(page,state({view:{name}}));const control=page.getByRole('button',{name,exact:true});await expect(control).toHaveText(name);await expect(control).toBeDisabled();
      const box=(await control.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(-1);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width+1);expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
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

test('Escape from an outside piece control cancels a held selection without disabling direct placements',async({page,request})=>{
  await mount(page,request);await page.getByRole('button',{name:/Green token/}).click();
  await expect(page.getByRole('button',{name:'Rotate clockwise',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Rotate clockwise',exact:true}).focus();await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Rotate clockwise',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Place here',exact:true}).click();
  await expect.poll(()=>moves(page)).toEqual([{event:{type:'tap',id:'destination'}}]);
});

test('boards omit zoom controls, retain camera gestures and keep fixed-camera games fitted',async({page,request,isMobile})=>{
  await mount(page,request);
  const board=page.getByLabel('Game board. Use pieces and highlighted destinations.');
  const canvas=board.locator('svg').first();
  await expect(canvas).toHaveAttribute('viewBox','0 0 400 300');
  await expect(page.getByRole('button',{name:/^(Zoom in|Zoom out|Reset board view)$/})).toHaveCount(0);
  if(!isMobile){
    await board.focus();await page.keyboard.press('+');
    await expect(canvas).not.toHaveAttribute('viewBox','0 0 400 300');
    await page.keyboard.press('0');await expect(canvas).toHaveAttribute('viewBox','0 0 400 300');
  }
  expect(await moves(page)).toEqual([]);
  const fixed={...spec(),viewport:{width:400,height:300,camera_enabled:false}};
  await mount(page,request,fixed);await expect(page.getByRole('button',{name:'Roll dice',exact:true})).toBeVisible();
  if(!isMobile){await board.focus();await page.keyboard.press('+');}
  await expect(canvas).toHaveAttribute('viewBox','0 0 400 300');
  await expect(page.getByRole('button',{name:/^(Zoom in|Zoom out|Reset board view)$/})).toHaveCount(0);
});

test('scene copy hides internal terminology without changing move identifiers or option values',async({page,request})=>{
  const pkg=spec(`const gameUI={reduce(message){return {scene:{
    pieces:[{id:'declarative_piece',type:'token',board:'board',position:{cell:'0'},text:'Token (Declarative)',aria_label:'Token (Declarative)',actions:['move'],move_targets:['declarative_target']}],
    targets:[{id:'declarative_target',board:'board',position:{cell:'2'},label:'Destination (Declarative)'}],
    labels:[{id:'title',x:10,y:240,text:'Table (Declarative)'}],
    controls:[{id:'declarative_choice',kind:'choice',label:'Theme (Declarative)',value:false,options:[{label:'Classic (Declarative)',value:'declarative_value'}]}]
  },...(message.type==='ui_event'?{make_move:message.event}:{})};}};`);
  await mount(page,request,pkg);
  await expect(page.getByText('Table',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Token: Move',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Destination',exact:true})).toBeVisible();
  await expect(page.getByText('Theme',{exact:true})).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/declarative/i);
  expect(await page.locator('[aria-label]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')).join(' '))).not.toMatch(/declarative/i);
  await page.getByRole('radio',{name:'Classic',exact:true}).click();
  await expect.poll(()=>moves(page)).toEqual([{type:'change',id:'declarative_choice',value:'declarative_value'}]);
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
  const canvas=page.getByLabel('Game board. Use pieces and highlighted destinations.').locator('svg').first();
  const fitted=await canvas.getAttribute('viewBox');
  const box=(await token.boundingBox())!,center={x:box.x+box.width/2,y:box.y+box.height/2};
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...center,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...center,id:1},{x:center.x+80,y:center.y+100,id:2}]});
  for(let step=1;step<=6;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:center.x,y:center.y,id:1},{x:center.x+80+step*9,y:center.y+100+step*9,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(canvas).not.toHaveAttribute('viewBox',fitted!);
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

for(const outline of ['rect','none'])test(`a draggable tappable piece preserves stationary clicks, focus, keyboard activation and real drops with ${outline} outline`,async({page,request,isMobile})=>{
  const base=spec(`const gameUI={reduce(m){return {scene:{pieces:[{id:'card',type:'card',board:'board',position:{cell:'0'},aria_label:'Playable card',actions:['tap','move'],move_targets:['destination']}],targets:[{id:'destination',board:'board',position:{cell:'2'},label:'Card destination'}]},...(m.type==='ui_event'?{make_move:{action:m.event.type}}:{})}}};`);
  const pkg={...base,piece_types:{...base.piece_types,card:{...base.piece_types.card,action_outline:outline}}};
  await mount(page,request,pkg);
  const card=page.getByRole('button',{name:/^Playable card/});await expect(card).toBeVisible();
  expect(await card.evaluate(node=>{const box=node.getBoundingClientRect();return node.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));})).toBe(true);
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

for(const kind of ['checkers','chess','four_player_chess'])test(`${kind} lets physical taps choose either source for a shared legal destination`,async({page,request})=>{
  const game=JSON.parse(readFileSync(path.resolve(__dirname,`../../../games/declarative/${kind}.json`),'utf8'));
  const view=game.unit_tests.cases[0].view_of_mover;
  const legal=kind==='checkers'?view.moves.map((m:any)=>({from:m.from,to:m.to,move:{from:m.from,to:m.to}})):
    view.legalMoves.map((m:any)=>({from:{r:m.fr,c:m.fc},to:{r:m.tr,c:m.tc},move:{...(kind==='four_player_chess'?{kind:'move'}:{}),fr:m.fr,fc:m.fc,tr:m.tr,tc:m.tc}}));
  const shared=legal.find((m:any)=>legal.some((other:any)=>JSON.stringify(m.to)===JSON.stringify(other.to)&&JSON.stringify(m.from)!==JSON.stringify(other.from)));
  const pair=legal.filter((m:any)=>JSON.stringify(m.to)===JSON.stringify(shared.to)).slice(0,2);
  expect(pair.length).toBe(2);
  await mount(page,request,game.declarative_ui,state({view,state:view,strings:game.declarative_ui.strings}));
  for(const [index,choice]of pair.entries()){
    await send(page,state({view,state:view,strings:game.declarative_ui.strings,move_count:index+2}));
    await page.getByRole('button',{name:`Select piece at row ${choice.from.r+1}, column ${choice.from.c+1}`,exact:true}).click();
    await page.getByRole('button',{name:`Move to row ${choice.to.r+1}, column ${choice.to.c+1}`,exact:true}).click();
    await expect.poll(()=>moves(page)).toHaveLength(index+1);
    expect((await moves(page)).at(-1)).toEqual(choice.move);
  }
});

test('Battleship requests a private automatic fleet and clears its cells when the viewer changes',async({page,request},info)=>{
  const game=JSON.parse(readFileSync(path.resolve(__dirname,'../../../games/declarative/battleship.json'),'utf8'));
  const opening=game.unit_tests.cases[0],view=opening.view_of_mover;
  await mount(page,request,game.declarative_ui,state({view,state:view,strings:game.declarative_ui.strings,move_count:0}));
  await page.getByRole('button',{name:'Place fleet and start battle',exact:true}).click();
  await expect.poll(()=>moves(page)).toEqual([{type:'auto_place'}]);
  const own=opening.expected_view_of_mover;
  await send(page,state({view:own,state:own,strings:game.declarative_ui.strings,move_count:1,acting_for_player_index:null}));
  await expect(page.getByText('■',{exact:true})).toHaveCount(17);
  await page.screenshot({path:info.outputPath('battleship-private-fleet.png'),fullPage:true});
  const hidden=opening.expected_view_of_other;
  await send(page,state({view:hidden,state:hidden,strings:game.declarative_ui.strings,move_count:1,my_player_index:1,acting_for_player_index:1}));
  await expect(page.getByText('■',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Place fleet and start battle',exact:true})).toBeVisible();
  expect(await moves(page)).toEqual([{type:'auto_place'}]);
});

test('Guess Who portraits expose the public features used by translated questions',async({page,request},info)=>{
  const game=JSON.parse(readFileSync(path.resolve(__dirname,'../../../games/declarative/guess_who.json'),'utf8'));
  const view=game.unit_tests.cases[0].view_of_mover;
  await mount(page,request,game.declarative_ui,state({view,state:view,strings:game.translations.es.client_strings,locale:'es'}));
  const cleo=page.getByRole('button',{name:/^Cleo:/});
  await expect(cleo).toBeVisible();
  await expect(cleo.locator('svg')).toHaveCount(1);
  await expect(cleo.locator('path[stroke="#172033"]')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Preguntar: ¿Lleva gafas?',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('guess-who-public-traits.png'),fullPage:true});
  await cleo.click();await expect.poll(()=>moves(page)).toEqual([{kind:'guess',idx:2}]);
});
