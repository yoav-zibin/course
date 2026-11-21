import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const state=(extra:Record<string,unknown>={})=>({type:'state_changed',status:'ongoing',move_count:0,
  my_player_index:0,acting_for_player_index:0,view:{},...extra});
const spec=(code:string)=>({format:'buildplay-ui',version:1,viewport:{width:400,height:400},
  boards:[{id:'board',kind:'grid',x:0,y:0,width:400,height:400,rows:4,columns:4}],
  piece_types:{token:{shape:'circle',width:50,height:50,color:'#ffcc11'},cover:{shape:'rect',width:80,height:80,color:'#253242'}},
  motion:{move_ms:900},ui_code:code});

async function mount(page:Page,request:APIRequestContext,pkg:object=spec(`const gameUI={reduce(m){return {scene:{
  pieces:[{id:'token',type:'token',board:'board',position:{cell:'0'},actions:['move'],move_targets:['destination'],aria_label:'Source token'}],
  targets:[{id:'destination',board:'board',position:{cell:'12'},label:'Bottom destination'}]},
  ...(m.type==='ui_event'?{make_move:m.event}:{})}}};`),initial=state()){
  const response=await request.post('/games/declarative/client',{data:pkg});expect(response.ok(),await response.text()).toBeTruthy();
  const document=(await response.json()).client_code;
  await page.addInitScript(()=>{
    (window as any).__moves=[];(window as any).__ready=false;
    window.addEventListener('message',event=>{
      if(event.source!==window)return;
      if(event.data?.type==='game_ready')(window as any).__ready=true;
      if(event.data?.type==='make_move')(window as any).__moves.push(event.data.move);
    });
  });
  await page.route('**/drag-fixture',route=>route.fulfill({contentType:'text/html',body:document}));
  await page.goto('/drag-fixture');await page.waitForFunction(()=>(window as any).__ready);
  await page.evaluate(message=>window.postMessage(message,'*'),initial);
}

test('real touch drag keeps its origin mounted, hovers above the finger and survives identical deliveries',async({page,request,browserName})=>{
  test.skip(browserName!=='chromium','Real multi-event touch input uses Chromium CDP.');
  await mount(page,request);
  const source=page.getByRole('button',{name:/Source token/});await expect(source).toBeVisible();
  const origin=await source.elementHandle();
  const box=(await source.locator('ellipse').first().boundingBox())!;
  const canvas=(await page.getByLabel('Game board. Use pieces and highlighted destinations.').boundingBox())!;
  const start={x:box.x+box.width/2,y:box.y+box.height/2};
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:1}]});
  const middle={x:canvas.x+canvas.width/2,y:canvas.y+canvas.height/2};
  for(let step=1;step<=8;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{
    x:start.x+(middle.x-start.x)*step/8,y:start.y+(middle.y-start.y)*step/8,id:1}]});
  const held=page.getByTestId('dragged-piece');await expect(held).toHaveCount(1);
  expect(await origin!.evaluate(node=>node.isConnected)).toBe(true);
  await expect(page.getByTestId('held-piece-origin')).toHaveAttribute('opacity','0');
  const hovering=(await held.locator('ellipse').first().boundingBox())!;
  expect(hovering.y+hovering.height/2).toBeLessThan(middle.y-8);
  await page.evaluate(message=>window.postMessage(message,'*'),state());
  await expect(held).toHaveCount(1);
  const destination=(await page.getByRole('button',{name:'Bottom destination',exact:true}).locator('rect').boundingBox())!;
  const end={x:destination.x+destination.width/2,y:Math.min(canvas.y+canvas.height-1,destination.y+destination.height/2+54)};
  for(let step=1;step<=8;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{
    x:middle.x+(end.x-middle.x)*step/8,y:middle.y+(end.y-middle.y)*step/8,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>page.evaluate(()=>(window as any).__moves)).toEqual([{type:'drop',id:'token',piece_id:'token',target_id:'destination'}]);
  await expect(held).toHaveCount(0);
  expect(await origin!.evaluate(node=>node.isConnected)).toBe(true);
});

test('a genuine authoritative change cancels a held touch without submitting a stale move',async({page,request})=>{
  await mount(page,request);
  const source=page.getByRole('button',{name:/Source token/});await expect(source).toBeVisible();
  const box=(await source.locator('ellipse').first().boundingBox())!,start={x:box.x+box.width/2,y:box.y+box.height/2};
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+20,y:start.y+20,id:1}]});
  await expect(page.getByTestId('dragged-piece')).toHaveCount(1);
  await page.evaluate(message=>window.postMessage(message,'*'),state({move_count:1,acting_for_player_index:null,view:{changed:true}}));
  await expect(page.getByTestId('dragged-piece')).toHaveCount(0);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect(await page.evaluate(()=>(window as any).__moves)).toEqual([]);
});

test('a stationary touch reveals selection controls when the frozen gesture toolbar thaws',async({page,request})=>{
  await mount(page,request);
  const source=page.getByRole('button',{name:/Source token/});await expect(source).toBeVisible();
  const box=(await source.locator('ellipse').first().boundingBox())!;
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.getByRole('button',{name:'Cancel selection',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__moves)).toEqual([]);
});

for(const z of [undefined,0,1000000])test(`animation layer ${z??'legacy default'} is temporary and ordered against pieces and decorations`,async({page,request})=>{
  const pkg=spec(`const gameUI={reduce(m){const s=m.type==='ui_event'?m.state_changed:m;
    const x=s.view.moved?250:50;return {scene:{pieces:[
      {id:'token',type:'token',board:'board',position:{x,y:180},aria_label:'Moving token',actions:[],z:1},
      {id:'cover',type:'cover',board:'board',position:{x:200,y:180},aria_label:'Stationary cover',actions:[],z:90000}],
      labels:[{id:'label',x:170,y:180,text:'Scene decoration'}]},
      ${z===undefined?'':`last_move_animations:s.view.moved?[{piece_id:'token',path:[{board:'board',position:{x:50,y:180}},{board:'board',position:{x:250,y:180}}],duration_ms:900,z:${z}}]:[],`}
    };}};`);
  await mount(page,request,pkg);
  const token=page.getByRole('img',{name:'Moving token'}),cover=page.getByRole('img',{name:'Stationary cover'});
  await expect(token).toBeVisible();
  await page.evaluate(message=>window.postMessage(message,'*'),state({move_count:1,last_move_player_index:1,view:{moved:true}}));
  await expect(page.getByText('Waiting for a move',{exact:true})).toBeVisible();
  const follows=()=>token.evaluate(node=>{
    const svg=(node as SVGElement).ownerSVGElement!;const children=[...svg.children];
    return children.indexOf(node)>children.indexOf([...svg.children].find(child=>child.textContent==='Scene decoration')!);
  });
  await expect.poll(follows).toBe(z!==0);
  await expect.poll(follows,{timeout:3000}).toBe(false);
  expect(await cover.count()).toBe(1);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(message=>window.postMessage(message,'*'),state({move_count:2,last_move_player_index:1,view:{moved:true}}));
  expect(await follows()).toBe(false);
});

test('the unchanged pinned Backgammon v1 presentation lifts a moving checker over its stacks and labels',async({page,request})=>{
  const legacy=JSON.parse(readFileSync(path.resolve(__dirname,'../../../tests/fixtures/declarative/backgammon-v1-ui.json'),'utf8'));
  const current=JSON.parse(readFileSync(path.resolve(__dirname,'../../../games/declarative/backgammon.json'),'utf8'));
  const before=structuredClone(current.unit_tests.cases[0].view_of_mover);
  Object.assign(before,{cur:1,needRoll:false,dice:[3,4],moves:[3,4],legalMoves:[],winner:null});
  const initial=state({view:before,state:before,last_move_player_index:null});
  await mount(page,request,legacy,initial);
  const moving=page.getByRole('img',{name:'checker_1_1',exact:true});await expect(moving).toBeVisible();
  const after=structuredClone(before);
  after.cnt[0]--;after.cnt[3]++;after.owner[3]=1;
  Object.assign(after,{cur:0,needRoll:true,dice:[],moves:[]});
  await page.evaluate(message=>window.postMessage(message,'*'),state({move_count:1,last_move_player_index:1,view:after,state:after}));
  const above=()=>moving.evaluate(node=>{
    const svg=(node as SVGElement).ownerSVGElement!;
    return svg.lastElementChild===node;
  });
  await expect.poll(above).toBe(true);
  await expect.poll(above,{timeout:6000}).toBe(false);
});

test('sequential captures raise only the active checker and preserve repeated-entry layer changes',async({page,request})=>{
  const pkg=spec(`const gameUI={reduce(m){const s=m.type==='ui_event'?m.state_changed:m;return {
    scene:{pieces:[{id:'a',type:'token',board:'board',position:{x:s.view.moved?300:50,y:180},aria_label:'First checker',actions:[],z:1},
      {id:'b',type:'token',board:'board',position:{x:s.view.moved?250:200,y:180},aria_label:'Second checker',actions:[],z:2}],
      labels:[{id:'end',x:20,y:360,text:'End label'}]},
    last_move_animations:s.view.moved?[
      {piece_id:'a',path:[{board:'board',position:{x:50,y:180}},{board:'board',position:{x:150,y:180}}],duration_ms:800,z:900000},
      {piece_id:'b',path:[{board:'board',position:{x:200,y:180}},{board:'board',position:{x:250,y:180}}],duration_ms:800},
      {piece_id:'a',path:[{board:'board',position:{x:150,y:180}},{board:'board',position:{x:300,y:180}}],duration_ms:800,z:-10}]:[]
  };}};`);
  await mount(page,request,pkg);await expect(page.getByRole('img',{name:'First checker'})).toBeVisible();
  await page.evaluate(message=>window.postMessage(message,'*'),state({move_count:1,last_move_player_index:1,view:{moved:true}}));
  const top=()=>page.getByRole('img',{name:'First checker'}).evaluate(node=>{
    const last=(node as SVGElement).ownerSVGElement!.lastElementChild!;
    return last.getAttribute('aria-label')||last.textContent;
  });
  await expect.poll(top).toBe('First checker');
  await expect.poll(top).toBe('Second checker');
  await expect.poll(top).toBe('End label');
});

test('clicking a nonblocking raised pulse selects the visible piece, then resting hit order returns',async({page,request})=>{
  const pkg=spec(`const gameUI={reduce(m){const s=m.type==='ui_event'?m.state_changed:m;return {scene:{pieces:[
    {id:'low',type:'token',board:'board',position:{x:200,y:200},aria_label:'Pulse piece',actions:['tap'],z:1,
      ...(s.view.pulse?{animation:{kind:'pulse',key:'pulse:1',duration_ms:1500,z:1000000}}:{})},
    {id:'high',type:'cover',board:'board',position:{x:200,y:200},aria_label:'Resting piece',actions:['tap'],z:90000}]},
    ...(m.type==='ui_event'?{make_move:{id:m.event.id}}:{})};}};`);
  await mount(page,request,pkg);
  await expect(page.getByRole('button',{name:/Resting piece/})).toBeVisible();
  await page.evaluate(message=>window.postMessage(message,'*'),state({move_count:1,last_move_player_index:0,view:{pulse:true}}));
  const pulse=page.getByRole('button',{name:/Pulse piece/});
  await expect.poll(()=>pulse.evaluate(node=>(node as SVGElement).ownerSVGElement!.lastElementChild===node)).toBe(true);
  // Exercise a real pointer hit during motion. Locator.click waits for stable
  // geometry and would deliberately postpone the click until the pulse ends.
  const box=(await pulse.locator('ellipse').first().boundingBox())!;
  await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  await expect.poll(()=>page.evaluate(()=>(window as any).__moves)).toEqual([{id:'low'}]);
  await page.evaluate(message=>window.postMessage(message,'*'),state({move_count:2,last_move_player_index:0,view:{pulse:false}}));
  await page.getByRole('button',{name:/Resting piece/}).locator('rect').first().click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__moves)).toEqual([{id:'low'},{id:'high'}]);
});

test('parallel default animations preserve the resting relative order of their artwork',async({page,request})=>{
  const pkg=spec(`const gameUI={reduce(m){const s=m.type==='ui_event'?m.state_changed:m;return {scene:{pieces:[
    {id:'front',type:'token',board:'board',position:{x:200,y:200},rotation:s.view.moved?90:0,aria_label:'Front artwork',actions:[],z:10},
    {id:'back',type:'cover',board:'board',position:{x:200,y:200},rotation:s.view.moved?90:0,aria_label:'Back artwork',actions:[],z:1}],
    labels:[{id:'label',x:20,y:360,text:'Decoration'}]},animations:s.view.moved?[
      {piece_id:'front',key:'rotate:1',from:{rotation:0},duration_ms:900},
      {piece_id:'back',key:'rotate:1',from:{rotation:0},duration_ms:900}]:[]};}};`);
  await mount(page,request,pkg);const front=page.getByRole('img',{name:'Front artwork'});await expect(front).toBeVisible();
  await page.evaluate(message=>window.postMessage(message,'*'),state({move_count:1,last_move_player_index:0,view:{moved:true}}));
  const above=()=>front.evaluate(node=>(node as SVGElement).ownerSVGElement!.lastElementChild===node);
  await expect.poll(above).toBe(true);
  await expect.poll(above,{timeout:3000}).toBe(false);
});
