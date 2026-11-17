import {test,expect,Page} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {revealDeclarativeTarget, zoomDeclarativeBoard} from './declarative-camera';

async function mountBoard(page:Page,animate=true){
  // Fixed world-coordinate camera oracles below use a whole-board fitted view.
  // Responsive native gestures are covered by Backgammon and the separate
  // dense-scene viewport matrix.
  await page.setViewportSize({width:1280,height:900});
  await page.goto('/static/declarative-test.html');
  await page.evaluate(async animate=>{
    const box=document.createElement('div');box.id='zoom-test';box.style.cssText='position:fixed;inset:0;z-index:9999;background:#102330';document.body.append(box);
    const spec={format:'buildplay-ui',version:1,viewport:{width:600,height:420},boards:[{id:'table',kind:'zone',x:0,y:0,width:600,height:420}],piece_types:{token:{shape:'circle',color:'#a7f070',width:50,height:50}},ui_code:`const gameUI={reduce(message){const s=message.type==='ui_event'?message.state_changed:message;const e=message.event;return {scene:{pieces:[{id:'checker',type:'token',board:'table',position:{x:s.view.x||220,y:210},text:'P',actions:['move'],move_targets:['home']}],targets:[{id:'home',board:'table',position:{x:380,y:210},label:'Home'}],labels:[{id:'event',x:20,y:20,text:e?e.type:'state'}]},...(e?.type==='drop'?{make_move:{to:e.target_id}}:{})};}};`};
    const w=window as any;w.zoomMoves=[];w.zoomScenes=0;w.zoomSpec=spec;w.zoomMessage={type:'state_changed',view:{x:220},state:{},status:'ongoing',players:[{player_index:0,kind:'human'},{player_index:1,kind:'human'}],my_player_index:0,acting_for_player_index:0,turn_of_player_indices:[0],last_move_player_index:null,move_count:0};
    w.zoomHost=w.DeclarativeUI.mount(box,spec,{animate,onMove:(move:any)=>w.zoomMoves.push(move),onScene:()=>w.zoomScenes++});await w.zoomHost.send(w.zoomMessage);
  },animate);
}
async function camera(page:Page){return page.locator('#zoom-test .declarative-stage').evaluate((node:SVGSVGElement)=>({x:node.viewBox.baseVal.x,y:node.viewBox.baseVal.y,width:node.viewBox.baseVal.width,height:node.viewBox.baseVal.height}));}
async function screenPoint(page:Page,x:number,y:number){return page.locator('#zoom-test .declarative-stage').evaluate((node:SVGSVGElement,point)=>{const p=node.createSVGPoint();p.x=point.x;p.y=point.y;const result=p.matrixTransform(node.getScreenCTM()!);return {x:result.x,y:result.y};},{x,y});}
async function boardPoint(page:Page,x:number,y:number){return page.locator('#zoom-test .declarative-stage').evaluate((node:SVGSVGElement,point)=>{const p=node.createSVGPoint();p.x=point.x;p.y=point.y;const result=p.matrixTransform(node.getScreenCTM()!.inverse());return {x:result.x,y:result.y};},{x,y});}

test('background taps and small pointer jitter allow the next intentional mouse or touch move immediately',async({page})=>{
  await mountBoard(page,false);
  const stage=page.locator('#zoom-test .declarative-stage');
  const session=await page.context().newCDPSession(page);
  let accepted=0;
  for(const mode of ['mouse','touch'])for(const zoomSteps of [-1,0,2])for(const jitter of [0,3]){
    await page.evaluate(async count=>{const w=window as any;await w.zoomHost.send({...w.zoomMessage,move_count:count});},accepted);
    await zoomDeclarativeBoard(stage,'reset');
    for(let i=0;i<Math.abs(zoomSteps);i++)await zoomDeclarativeBoard(stage,zoomSteps<0?'out':'in');
    const before=await camera(page),background=await screenPoint(page,300,100);
    const checker=await screenPoint(page,220,210),home=await screenPoint(page,380,210);
    await session.send('Emulation.setTouchEmulationEnabled',{enabled:mode==='touch',maxTouchPoints:5});
    if(mode==='mouse'){
      await page.mouse.move(background.x,background.y);await page.mouse.down();
      if(jitter)await page.mouse.move(background.x+jitter,background.y);
      await page.mouse.up();
      expect(await camera(page)).toEqual(before);
      await page.mouse.click(checker.x,checker.y);await page.mouse.click(home.x,home.y);
    }else{
      const touch=(p:{x:number,y:number})=>({id:1,...p,radiusX:1,radiusY:1,force:1});
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(background)]});
      if(jitter)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch({x:background.x+jitter,y:background.y})]});
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      expect(await camera(page)).toEqual(before);
      for(const point of [checker,home]){
        await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(point)]});
        await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      }
    }
    accepted++;
    await expect.poll(()=>page.evaluate(()=>(window as any).zoomMoves.length)).toBe(accepted);
  }
});

for(const size of [{width:390,height:844},{width:844,height:390}])test(`background touch panning leaves room beyond every edge at all zoom levels (${size.width}x${size.height})`,async({page})=>{
  await mountBoard(page,false);await page.setViewportSize(size);
  const stage=page.locator('#zoom-test .declarative-stage');
  const session=await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  const touch=(x:number,y:number)=>({id:1,x,y,radiusX:1,radiusY:1,force:1});
  async function pan(direction:'left'|'right'|'up'|'down'){
    const box=(await stage.boundingBox())!;
    const horizontal=direction==='left'||direction==='right',positive=direction==='left'||direction==='up';
    const from={x:box.x+box.width*(horizontal?(positive?.18:.82):.1),y:box.y+box.height*(horizontal?.1:(positive?.18:.82))};
    const to={x:horizontal?box.x+box.width*(positive?.82:.18):from.x,y:horizontal?from.y:box.y+box.height*(positive?.82:.18)};
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(from.x,from.y)]});
    await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(to.x,to.y)]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  for(const zoomSteps of [-1,0,2]){
    for(const direction of ['left','right','up','down'] as const){
      await zoomDeclarativeBoard(stage,'reset');
      for(let i=0;i<Math.abs(zoomSteps);i++)await zoomDeclarativeBoard(stage,zoomSteps<0?'out':'in');
      const centered=await camera(page);
      await pan(direction);await pan(direction);
      const panned=await camera(page);
      if(direction==='left')expect(panned.x).toBeLessThan(Math.min(0,(600-panned.width)/2));
      if(direction==='right')expect(panned.x).toBeGreaterThan(Math.max(centered.x,600-panned.width));
      if(direction==='up')expect(panned.y).toBeLessThan(Math.min(0,(420-panned.height)/2));
      if(direction==='down')expect(panned.y).toBeGreaterThan(Math.max(centered.y,420-panned.height));
      // Repeated swipes stop at a stable limit while retaining most of the
      // smaller of the board and visible area in each dimension.
      await pan(direction);expect(await camera(page)).toEqual(panned);
      const overlapX=Math.min(panned.x+panned.width,600)-Math.max(panned.x,0);
      const overlapY=Math.min(panned.y+panned.height,420)-Math.max(panned.y,0);
      expect(overlapX).toBeGreaterThanOrEqual(Math.min(600,panned.width)*.8);
      expect(overlapY).toBeGreaterThanOrEqual(Math.min(420,panned.height)*.8);
    }
  }
  expect(await page.evaluate(()=>(window as any).zoomMoves)).toEqual([]);
  expect(await page.evaluate(()=>(window as any).zoomScenes)).toBe(1);
  // After moving the fitted board above its original edge, an ordinary native
  // checker drag still emits exactly one legal move in the shifted coordinates.
  await zoomDeclarativeBoard(stage,'reset');
  const empty=await screenPoint(page,300,100);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(empty.x,empty.y)]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(empty.x,empty.y-25)]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect((await camera(page)).y).toBeGreaterThan(0);
  const from=await screenPoint(page,220,210),to=await screenPoint(page,380,210);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(from.x,from.y)]});
  await expect(page.locator('#zoom-test [data-ui-id="home"]')).toHaveAttribute('data-drop-state','allowed');
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(to.x,to.y)]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>page.evaluate(()=>(window as any).zoomMoves)).toEqual([{to:'home'}]);
  await zoomDeclarativeBoard(stage,'reset');
  expect(await camera(page)).toEqual({x:0,y:0,width:600,height:420});
  await session.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  for(const overview of [false,true]){
    await zoomDeclarativeBoard(stage,'reset');if(overview)await zoomDeclarativeBoard(stage,'out');
    const before=await camera(page),background=await screenPoint(page,300,100);
    await page.mouse.move(background.x,background.y);await page.mouse.down();
    await page.mouse.move(background.x+25,background.y+15);await page.mouse.up();
    const after=await camera(page);expect(after.x).toBeLessThan(before.x);expect(after.y).toBeLessThan(before.y);
  }
  expect(await page.evaluate(()=>(window as any).zoomMoves)).toEqual([{to:'home'}]);
});

test('pinch zoom stays anchored, pans, preserves state and still drops the legal piece',async({page})=>{
  await mountBoard(page);
  const session=await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  const mid=await screenPoint(page,300,210),left=await screenPoint(page,250,210),right=await screenPoint(page,350,210);
  const touch=(id:number,x:number,y:number)=>({id,x,y,radiusX:1,radiusY:1,force:1});
  const start=[touch(1,left.x,left.y),touch(2,right.x,right.y)];
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:start});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(1,mid.x-(right.x-left.x),mid.y),touch(2,mid.x+(right.x-left.x),mid.y)]});
  const zoomed=await camera(page);expect(zoomed.width).toBeCloseTo(300,0);
  const anchor=await boardPoint(page,mid.x,mid.y);expect(anchor.x).toBeCloseTo(300,0);expect(anchor.y).toBeCloseTo(210,0);
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect(await page.evaluate(()=>(window as any).zoomMoves)).toEqual([]);
  expect(await page.evaluate(()=>(window as any).zoomScenes)).toBe(1);
  // Board panning changes only the host camera. It must not submit an action.
  const empty=await screenPoint(page,300,290);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(3,empty.x,empty.y)]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(3,empty.x+25,empty.y+10)]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect((await camera(page)).x).toBeLessThan(zoomed.x);
  const panned=await camera(page);
  await page.evaluate(async()=>{const w=window as any;await w.zoomHost.send({...w.zoomMessage,move_count:1,replay:{index:1,total:2}});});
  expect(await camera(page)).toEqual(panned);
  await page.evaluate(async()=>{const w=window as any;await w.zoomHost.send({...w.zoomMessage,move_count:2});});
  // A second finger cancels a piece drag, including its allowed-drop highlights.
  const checker=page.locator('#zoom-test [data-ui-id="checker"]'),home=page.locator('#zoom-test [data-ui-id="home"]');
  let from=await screenPoint(page,220,210),to=await screenPoint(page,380,210);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(4,from.x,from.y)]});
  await expect(home).toHaveAttribute('data-drop-state','allowed');
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(4,from.x,from.y),touch(5,mid.x,mid.y+55)]});
  await expect(home).toHaveAttribute('data-drop-state','placement');
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(4,to.x,to.y),touch(5,mid.x,mid.y+55)]});
  await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await home.dispatchEvent('click');
  expect(await page.evaluate(()=>(window as any).zoomMoves)).toEqual([]);
  // Pinch inward reduces magnification; the keyboard shortcut restores the whole board.
  await zoomDeclarativeBoard(page.locator('#zoom-test .declarative-stage'),'reset');

  await zoomDeclarativeBoard(page.locator('#zoom-test .declarative-stage'),'out');

  expect(await camera(page)).toEqual({x:-75,y:-52.5,width:750,height:525});
  for(let i=0;i<8;i++)await zoomDeclarativeBoard(page.locator('#zoom-test .declarative-stage'),'out');

  expect(await camera(page)).toEqual({x:-900,y:-630,width:2400,height:1680});
  await zoomDeclarativeBoard(page.locator('#zoom-test .declarative-stage'),'reset');
  expect(await camera(page)).toEqual({x:0,y:0,width:600,height:420});
  for(let i=0;i<8;i++)await zoomDeclarativeBoard(page.locator('#zoom-test .declarative-stage'),'in');
  expect((await camera(page)).width).toBeCloseTo(150);
  await zoomDeclarativeBoard(page.locator('#zoom-test .declarative-stage'),'reset');
  await zoomDeclarativeBoard(page.locator('#zoom-test .declarative-stage'),'in');
  await zoomDeclarativeBoard(page.locator('#zoom-test .declarative-stage'),'in');
  const beforeInward=await camera(page);
  const center=await screenPoint(page,300,210);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(6,center.x-50,center.y),touch(7,center.x+50,center.y)]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(6,center.x-40,center.y),touch(7,center.x+40,center.y)]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect((await camera(page)).width).toBeGreaterThan(beforeInward.width);
  // Single-finger legal dragging works in the transformed board coordinates.
  from=await screenPoint(page,220,210);to=await screenPoint(page,380,210);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(8,from.x,from.y)]});
  await expect(home).toHaveAttribute('data-drop-state','allowed');
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(8,to.x,to.y)]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>page.evaluate(()=>(window as any).zoomMoves)).toEqual([{to:'home'}]);
  await expect(checker).not.toHaveClass(/actionable/);
  await zoomDeclarativeBoard(page.locator('#zoom-test .declarative-stage'),'reset');expect(await camera(page)).toEqual({x:0,y:0,width:600,height:420});
  // Destroying/remounting clears camera fingers and starts fitted for a new match.
  await page.evaluate(async()=>{const w=window as any;w.zoomHost.destroy();w.zoomHost=w.DeclarativeUI.mount(document.getElementById('zoom-test'),w.zoomSpec,{onMove:(m:any)=>w.zoomMoves.push(m)});await w.zoomHost.send(w.zoomMessage);});
  expect(await camera(page)).toEqual({x:0,y:0,width:600,height:420});
  await test.info().attach('zoom-board',{body:await page.locator('#zoom-test').screenshot(),contentType:'image/png'});
});

test('cancelled custom drags restore artwork position and original stacking before another gesture',async({page})=>{
  await mountBoard(page,false);
  const checker=page.locator('#zoom-test [data-ui-id="checker"]'),visual=checker.locator('.declarative-drag-visual');
  const index=()=>checker.evaluate(node=>[...node.parentElement!.children].indexOf(node));
  const original=await index(),start=await screenPoint(page,220,210),denied=await screenPoint(page,500,100);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(denied.x,denied.y,{steps:4});
  await expect(checker).toHaveClass(/dragging/);
  expect(await visual.getAttribute('transform')).not.toBeNull();
  expect(await index()).toBeGreaterThan(original);
  await page.mouse.up();
  await expect(checker).not.toHaveClass(/dragging/);
  expect(await visual.getAttribute('transform')).toBeNull();
  expect(await index()).toBe(original);
  const session=await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  const touch=(id:number,p:{x:number,y:number})=>({id,...p,radiusX:1,radiusY:1,force:1});
  const moved=await screenPoint(page,300,150),second=await screenPoint(page,450,300);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(1,start)]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(1,moved)]});
  await expect(checker).toHaveClass(/dragging/);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(1,moved),touch(2,second)]});
  await expect(checker).not.toHaveClass(/dragging/);
  expect(await visual.getAttribute('transform')).toBeNull();
  expect(await index()).toBe(original);
  await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  expect(await page.evaluate(()=>(window as any).zoomMoves)).toEqual([]);
});

test('only opponent and computer actors animate; own accepted moves, replay and reduced motion settle immediately',async({page})=>{
  await mountBoard(page);
  const pieces=page.locator('#zoom-test .declarative-piece');
  expect(await pieces.evaluate(node=>node.getAnimations().length)).toBe(0);
  await zoomDeclarativeBoard(page.locator('#zoom-test .declarative-stage'),'in');
  const panStart=await screenPoint(page,300,300),beforePan=await camera(page);
  await page.mouse.move(panStart.x,panStart.y);await page.mouse.down();await page.mouse.move(panStart.x+20,panStart.y);await page.mouse.up();
  expect((await camera(page)).x).toBeLessThan(beforePan.x);
  // The accepted actor is still me after my move passes the turn to seat 1.
  await page.evaluate(async()=>{const w=window as any;await w.zoomHost.send({...w.zoomMessage,view:{x:300},move_count:1,last_move_player_index:0,turn_of_player_indices:[1],acting_for_player_index:null});});
  expect(await pieces.evaluate(node=>node.getAnimations().length)).toBe(0);
  await expect(pieces).toHaveAttribute('transform',/translate\(300 210\)/);
  // Conversely, an opponent move remains an opponent move when it gives me the turn.
  await page.evaluate(async()=>{const w=window as any;w.opponentMessage={...w.zoomMessage,view:{x:380},move_count:2,last_move_player_index:1,turn_of_player_indices:[0],acting_for_player_index:0};await w.zoomHost.send(w.opponentMessage);});
  expect(await pieces.evaluate(node=>node.getAnimations().length)).toBe(1);
  expect(await pieces.evaluate(node=>node.getAnimations()[0].effect!.getTiming().duration)).toBe(1440);
  await pieces.evaluate(node=>{(window as any).inFlightMove=node.getAnimations()[0];});
  await page.waitForFunction(()=>(window as any).inFlightMove.currentTime>=1000);
  expect(await page.evaluate(()=>(window as any).inFlightMove.playState)).toBe('running');
  await page.evaluate(async()=>{const w=window as any;await w.zoomHost.send(w.opponentMessage);});
  const afterPoll=await pieces.evaluate(node=>{const animation=node.getAnimations()[0];return {same:animation===(window as any).inFlightMove,time:animation?.currentTime,state:animation?.playState};});
  expect(afterPoll.same).toBe(true);expect(Number(afterPoll.time)).toBeGreaterThanOrEqual(1000);expect(afterPoll.state).toBe('running');
  const during=await pieces.evaluate(node=>node.getCTM()!.e);
  await expect.poll(()=>pieces.evaluate(node=>node.getAnimations().length)).toBe(0);
  // currentTime may overshoot by a compositor frame; a fill:none effect has
  // null progress after finishing. Check its exact end time and finished state.
  expect(await page.evaluate(()=>(window as any).inFlightMove.effect.getComputedTiming().endTime)).toBe(1440);
  expect(await page.evaluate(()=>(window as any).inFlightMove.playState)).toBe('finished');
  const settled=await pieces.evaluate(node=>node.getCTM()!.e);expect(settled).toBeGreaterThan(during);
  await page.evaluate(async()=>{const w=window as any;await w.zoomHost.send({...w.opponentMessage,view:{x:340}});});
  expect(await pieces.evaluate(node=>node.getAnimations().length)).toBe(0);
  await page.evaluate(async()=>{const w=window as any;await w.zoomHost.send({...w.zoomMessage,view:{x:260},move_count:3,last_move_player_index:null});});
  expect(await pieces.evaluate(node=>node.getAnimations().length)).toBe(0);
  await page.evaluate(async()=>{const w=window as any,message={...w.zoomMessage,view:{x:290},move_count:4,last_move_player_index:1};delete message.my_player_index;await w.zoomHost.send(message);});
  expect(await pieces.evaluate(node=>node.getAnimations().length)).toBe(0);
  await page.evaluate(async()=>{const w=window as any;await w.zoomHost.send({...w.zoomMessage,view:{x:220},move_count:0,last_move_player_index:1,replay:{index:0,total:4}});});
  expect(await pieces.evaluate(node=>node.getAnimations().length)).toBe(0);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(async()=>{const w=window as any;await w.zoomHost.send({...w.zoomMessage,view:{x:380},move_count:4,last_move_player_index:1});});
  expect(await pieces.evaluate(node=>node.getAnimations().length)).toBe(0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(async()=>{const w=window as any;w.zoomHost.destroy();w.zoomHost=w.DeclarativeUI.mount(document.getElementById('zoom-test'),w.zoomSpec,{animate:false});await w.zoomHost.send(w.zoomMessage);await w.zoomHost.send({...w.zoomMessage,view:{x:380},move_count:1,last_move_player_index:1});});
  expect(await pieces.evaluate(node=>node.getAnimations().length)).toBe(0);
  await page.evaluate(async()=>{const w=window as any;w.zoomHost.destroy();w.zoomHost=w.DeclarativeUI.mount(document.getElementById('zoom-test'),w.zoomSpec,{animate:true});const message={...w.zoomMessage,players:[{player_index:0,kind:'human'},{player_index:1,kind:'computer'}]};await w.zoomHost.send(message);await w.zoomHost.send({...message,view:{x:380},move_count:1,last_move_player_index:1});});
  expect(await pieces.evaluate(node=>node.getAnimations().length)).toBe(1);
  expect(await pieces.evaluate(node=>node.getAnimations()[0].effect!.getTiming().duration)).toBe(1440);
  await page.evaluate(async()=>{const w=window as any;await w.zoomHost.send({...w.zoomMessage,view:{x:260},move_count:2,last_move_player_index:1},{animate:false});});
  expect(await pieces.evaluate(node=>node.getAnimations().length)).toBe(0);
  await page.evaluate(async()=>{const w=window as any;w.zoomHost.destroy();w.zoomHost=w.DeclarativeUI.mount(document.getElementById('zoom-test'),w.zoomSpec,{animate:true});const message={...w.zoomMessage,my_player_index:null,acting_for_player_index:null};await w.zoomHost.send(message);await w.zoomHost.send({...message,view:{x:380},move_count:1,last_move_player_index:0});});
  expect(await pieces.evaluate(node=>node.getAnimations().length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).zoomMoves)).toEqual([]);
});

test('Backgammon legal drops work when pinched on phone and tablet, and opponent checkers animate',async({page},testInfo)=>{
  if(testInfo.project.name==='chromium')await page.setViewportSize({width:820,height:1180});
  const example=JSON.parse(fs.readFileSync(path.join(__dirname,'../games/declarative/backgammon.json'),'utf8'));
  // Reuse the package's ordinary-server test vector and its filtered views.
  const step=example.unit_tests.cases.find((item:any)=>item.name==='Hit a blot');
  expect(step).toBeTruthy();
  const seat=step.ctx.players.findIndex((player:any)=>player.id===step.player_id);
  const message=(view:any,count:number,viewer=seat,actor:number|null=null)=>({type:'state_changed',state:view,view,players:step.ctx.players.map((player:any,index:number)=>({player_index:index,player_id:player.id,name:player.display_name,kind:player.kind})),status:view.winner===null?'ongoing':'over',acting_for_player_index:view.winner===null&&view.cur===viewer?viewer:null,my_player_index:viewer,turn_of_player_indices:view.winner===null?[view.cur]:null,last_move_player_index:actor,move_count:count});
  const before=message(step.view_of_mover,step.ctx.move_count),after=message(step.expected_view_of_mover,step.ctx.move_count+1,seat,seat);
  await page.goto('/static/declarative-test.html');
  await page.evaluate(async({spec,before,after})=>{
    const box=document.createElement('div');box.id='zoom-test';box.style.cssText='position:fixed;inset:0;z-index:9999;background:#102330';document.body.append(box);
    const w=window as any;w.bgSpec=spec;w.bgBefore=before;w.bgAfter=after;w.bgMoves=[];
    w.bgHost=w.DeclarativeUI.mount(box,spec,{animate:true,onScene:(scene:any)=>w.bgScene=scene,onMove:(move:any)=>w.bgMoves.push(move)});await w.bgHost.send(before);
  },{spec:example.declarative_ui,before,after});
  const session=await page.context().newCDPSession(page);await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  const baseline=await camera(page),cx=baseline.x+baseline.width/2,cy=baseline.y+baseline.height/2;
  expect(baseline).toEqual({x:0,y:0,width:example.declarative_ui.viewport.width,height:example.declarative_ui.viewport.height});
  await testInfo.attach('backgammon-default-whole-board',{body:await page.locator('#zoom-test').screenshot(),contentType:'image/png'});
  const center=await screenPoint(page,cx,cy),left=await screenPoint(page,cx-50,cy),right=await screenPoint(page,cx+50,cy);
  const touch=(id:number,x:number,y:number)=>({id,x,y,radiusX:1,radiusY:1,force:1});
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(1,left.x,left.y),touch(2,right.x,right.y)]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(1,center.x-(right.x-left.x)*.75,center.y),touch(2,center.x+(right.x-left.x)*.75,center.y)]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect((await camera(page)).width).toBeCloseTo(baseline.width/1.5,0);
  const targetId='to_'+step.move.to;
  const pieceId=await page.evaluate(targetId=>(window as any).bgScene.pieces.find((piece:any)=>piece.move_targets?.includes(targetId)).id,targetId);
  const piece=page.locator(`#zoom-test [data-ui-id="${pieceId}"]`),target=page.locator(`#zoom-test [data-ui-id="${targetId}"]`);
  await revealDeclarativeTarget(page,piece);await revealDeclarativeTarget(page,target);
  // The small final camera correction must leave both endpoints reachable.
  await revealDeclarativeTarget(page,piece);
  const from=(await piece.locator(':scope > g[opacity]').boundingBox())!,to=(await target.locator('.declarative-target-area').boundingBox())!;
  const nativeHit=await piece.evaluate((node,point)=>document.elementFromPoint(point.x,point.y)?.closest('[data-ui-id]')?.getAttribute('data-ui-id'),{x:from.x+from.width/2,y:from.y+from.height/2});
  await testInfo.attach('native-drag-geometry',{body:JSON.stringify({pieceId,from,to,nativeHit,camera:await camera(page),stage:await page.locator('#zoom-test .declarative-stage').boundingBox()}),contentType:'application/json'});
  await testInfo.attach('native-drag-before',{body:await page.screenshot(),contentType:'image/png'});
  expect(nativeHit).toBe(pieceId);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(3,from.x+from.width/2,from.y+from.height/2)]});
  await expect(target).toHaveAttribute('data-drop-state','allowed');
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(3,to.x+to.width/2,to.y+to.height/2)]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>page.evaluate(()=>(window as any).bgMoves)).toEqual([step.move]);
  const fittedCamera=await camera(page);
  await page.evaluate(async()=>{const w=window as any;await w.bgHost.send(w.bgAfter);});
  // The accepted move belongs to this viewer, so it settles immediately.
  expect(await piece.evaluate(node=>node.getAnimations().length)).toBe(0);
  expect(await camera(page)).toEqual(fittedCamera);
  // Watch the same authoritative move as the opponent, with no actionable pieces.
  await page.evaluate(async()=>{const w=window as any;w.bgHost.destroy();w.bgHost=w.DeclarativeUI.mount(document.getElementById('zoom-test'),w.bgSpec,{animate:true,onMove:(move:any)=>w.bgMoves.push(move)});await w.bgHost.send({...w.bgBefore,my_player_index:1-w.bgBefore.my_player_index,acting_for_player_index:null});});
  await zoomDeclarativeBoard(page.locator('#zoom-test .declarative-stage'),'in');
  await page.evaluate(async()=>{const w=window as any;await w.bgHost.send({...w.bgAfter,my_player_index:1-w.bgAfter.my_player_index,acting_for_player_index:null});});
  expect(await piece.evaluate(node=>node.getAnimations().length)).toBe(1);
  expect(await piece.evaluate(node=>node.getAnimations()[0].effect!.getTiming().duration)).toBe(1440);
  await expect(page.locator('#zoom-test .declarative-piece.actionable')).toHaveCount(0);
  await expect.poll(()=>piece.evaluate(node=>node.getAnimations().length)).toBe(0);
  expect(await page.evaluate(()=>(window as any).bgMoves)).toEqual([step.move]);
  // Hits, bar re-entry and bearing off keep the physical checker IDs, so their
  // movements animate just like ordinary moves without inventing UI rules.
  for(const vector of example.unit_tests.cases.filter((item:any)=>['Hit a blot','Re-enter from bar','Bear off'].includes(item.name))){
    const actor=vector.ctx.players.findIndex((player:any)=>player.id===vector.player_id),viewer=1-actor;
    // A hit can also displace the other player's checker; the move actor still
    // determines whether both displaced pieces should animate.
    await page.evaluate(async({before,after})=>{const w=window as any;w.bgHost.destroy();w.bgHost=w.DeclarativeUI.mount(document.getElementById('zoom-test'),w.bgSpec,{animate:true});await w.bgHost.send(before);await w.bgHost.send(after);},{before:message(vector.view_of_mover,vector.ctx.move_count,actor),after:message(vector.expected_view_of_mover,vector.ctx.move_count+1,actor,actor)});
    // Target-hint opacity has a separate 120ms CSS transition; count physical
    // checker motion, which must remain immediate for the accepted own move.
    expect(await page.locator('#zoom-test .declarative-piece').evaluateAll(nodes=>nodes.flatMap(node=>node.getAnimations()).length)).toBe(0);
    const beforeVector=message(vector.view_of_mover,vector.ctx.move_count,viewer),afterVector=message(vector.expected_view_of_mover,vector.ctx.move_count+1,viewer,actor);
    await page.evaluate(async({before,after})=>{const w=window as any;w.bgHost.destroy();w.bgHost=w.DeclarativeUI.mount(document.getElementById('zoom-test'),w.bgSpec,{animate:true,onScene:(scene:any)=>w.bgScene=scene});await w.bgHost.send(before);w.bgAfter=after;w.bgIds=w.bgScene.pieces.filter((piece:any)=>piece.id.startsWith('checker_')).map((piece:any)=>piece.id).sort();},{before:beforeVector,after:afterVector});
    await zoomDeclarativeBoard(page.locator('#zoom-test .declarative-stage'),'in');
    await page.evaluate(async()=>{const w=window as any;await w.bgHost.send(w.bgAfter);});
    const animationState=await page.locator('#zoom-test').evaluate(node=>{const w=window as any;return {ids:w.bgScene.pieces.filter((piece:any)=>piece.id.startsWith('checker_')).map((piece:any)=>piece.id).sort(),before:w.bgIds,moving:node.getAnimations({subtree:true}).length,animated:[...node.querySelectorAll('.declarative-piece')].filter(piece=>piece.getAnimations().length).map((piece:HTMLElement)=>piece.dataset.uiId)};});
    expect(animationState.ids).toEqual(animationState.before);expect(animationState.ids.length).toBe(30);expect(animationState.moving).toBeGreaterThanOrEqual(vector.name==='Hit a blot'?2:1);
    if(vector.name==='Hit a blot'){expect(animationState.animated.some(id=>id?.startsWith('checker_'+actor+'_'))).toBe(true);expect(animationState.animated.some(id=>id?.startsWith('checker_'+viewer+'_'))).toBe(true);}
    await expect.poll(()=>page.locator('#zoom-test').evaluate(node=>node.getAnimations({subtree:true}).length)).toBe(0);
  }
  const evidence=path.join('/tmp',`declarative-backgammon-${testInfo.project.name==='chromium'?'tablet':'phone'}.png`);
  await page.locator('#zoom-test').screenshot({path:evidence});await testInfo.attach('backgammon-board',{path:evidence,contentType:'image/png'});
});
