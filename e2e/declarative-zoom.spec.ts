import {test,expect,Page} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

async function mountBoard(page:Page,animate=true){
  await page.goto('/static/declarative-test.html');
  await page.evaluate(async animate=>{
    const box=document.createElement('div');box.id='zoom-test';box.style.cssText='position:fixed;inset:0;z-index:9999;background:#102330';document.body.append(box);
    const spec={format:'buildplay-ui',version:1,viewport:{width:600,height:420},boards:[{id:'table',kind:'zone',x:0,y:0,width:600,height:420}],piece_types:{token:{shape:'circle',color:'#a7f070',width:50,height:50}},ui_code:`const gameUI={reduce(message){const s=message.type==='ui_event'?message.state_changed:message;const e=message.event;return {scene:{pieces:[{id:'checker',type:'token',board:'table',position:{x:s.view.x||220,y:210},text:'P',actions:['move'],move_targets:['home']}],targets:[{id:'home',board:'table',position:{x:380,y:210},label:'Home'}],labels:[{id:'event',x:20,y:20,text:e?e.type:'state'}]},...(e?.type==='drop'?{make_move:{to:e.target_id}}:{})};}};`};
    const w=window as any;w.zoomMoves=[];w.zoomScenes=0;w.zoomSpec=spec;w.zoomMessage={type:'state_changed',view:{x:220},state:{},status:'ongoing',my_player_index:0,acting_for_player_index:0,move_count:0};
    w.zoomHost=w.DeclarativeUI.mount(box,spec,{animate,onMove:(move:any)=>w.zoomMoves.push(move),onScene:()=>w.zoomScenes++});await w.zoomHost.send(w.zoomMessage);
  },animate);
}
async function camera(page:Page){return page.locator('#zoom-test .declarative-stage').evaluate((node:SVGSVGElement)=>({x:node.viewBox.baseVal.x,y:node.viewBox.baseVal.y,width:node.viewBox.baseVal.width,height:node.viewBox.baseVal.height}));}
async function screenPoint(page:Page,x:number,y:number){return page.locator('#zoom-test .declarative-stage').evaluate((node:SVGSVGElement,point)=>{const p=node.createSVGPoint();p.x=point.x;p.y=point.y;const result=p.matrixTransform(node.getScreenCTM()!);return {x:result.x,y:result.y};},{x,y});}
async function boardPoint(page:Page,x:number,y:number){return page.locator('#zoom-test .declarative-stage').evaluate((node:SVGSVGElement,point)=>{const p=node.createSVGPoint();p.x=point.x;p.y=point.y;const result=p.matrixTransform(node.getScreenCTM()!.inverse());return {x:result.x,y:result.y};},{x,y});}

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
  // Pinch inward reduces magnification; the fit button restores the whole board.
  await page.locator('#zoom-test [data-camera-action="reset"]').click();
  await expect(page.locator('#zoom-test [data-camera-action="out"]')).toBeDisabled();
  for(let i=0;i<8;i++)if(await page.locator('#zoom-test [data-camera-action="in"]').isEnabled())await page.locator('#zoom-test [data-camera-action="in"]').click();
  await expect(page.locator('#zoom-test [data-camera-action="in"]')).toBeDisabled();expect((await camera(page)).width).toBeCloseTo(150);
  await page.locator('#zoom-test [data-camera-action="reset"]').click();
  await page.locator('#zoom-test [data-camera-action="in"]').click();
  await page.locator('#zoom-test [data-camera-action="in"]').click();
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
  await page.locator('#zoom-test [data-camera-action="reset"]').click();expect(await camera(page)).toEqual({x:0,y:0,width:600,height:420});
  // Destroying/remounting clears camera fingers and starts fitted for a new match.
  await page.evaluate(async()=>{const w=window as any;w.zoomHost.destroy();w.zoomHost=w.DeclarativeUI.mount(document.getElementById('zoom-test'),w.zoomSpec,{onMove:(m:any)=>w.zoomMoves.push(m)});await w.zoomHost.send(w.zoomMessage);});
  expect(await camera(page)).toEqual({x:0,y:0,width:600,height:420});
  await test.info().attach('zoom-board',{body:await page.locator('#zoom-test').screenshot(),contentType:'image/png'});
});

test('server moves animate stable pieces, while replay, local mode and reduced motion settle immediately',async({page})=>{
  await mountBoard(page);
  const pieces=page.locator('#zoom-test .declarative-piece');
  expect(await pieces.evaluate(node=>node.getAnimations().length)).toBe(0);
  await page.locator('#zoom-test [data-camera-action="in"]').click();
  const panStart=await screenPoint(page,300,300),beforePan=await camera(page);
  await page.mouse.move(panStart.x,panStart.y);await page.mouse.down();await page.mouse.move(panStart.x+20,panStart.y);await page.mouse.up();
  expect((await camera(page)).x).toBeLessThan(beforePan.x);
  await page.evaluate(async()=>{const w=window as any;await w.zoomHost.send({...w.zoomMessage,view:{x:380},move_count:1});});
  expect(await pieces.evaluate(node=>node.getAnimations().length)).toBe(1);
  expect(await pieces.evaluate(node=>node.getAnimations()[0].effect!.getTiming().duration)).toBe(1440);
  // An ordinary poll can land anywhere in the 2s polling cycle, including in
  // the middle of a move. It must keep the same animation and elapsed time.
  await pieces.evaluate(node=>{(window as any).inFlightMove=node.getAnimations()[0];});
  await page.waitForFunction(()=>(window as any).inFlightMove.currentTime>=1000);
  expect(await page.evaluate(()=>(window as any).inFlightMove.playState)).toBe('running');
  await page.evaluate(async()=>{const w=window as any;await w.zoomHost.send({...w.zoomMessage,view:{x:380},move_count:1});});
  const afterPoll=await pieces.evaluate(node=>{const animation=node.getAnimations()[0];return {same:animation===(window as any).inFlightMove,time:animation?.currentTime,state:animation?.playState};});
  expect(afterPoll.same).toBe(true);expect(Number(afterPoll.time)).toBeGreaterThanOrEqual(1000);expect(afterPoll.state).toBe('running');
  const during=await pieces.evaluate(node=>node.getCTM()!.e);
  await expect.poll(()=>pieces.evaluate(node=>node.getAnimations().length)).toBe(0);
  expect(await page.evaluate(()=>(window as any).inFlightMove.currentTime)).toBe(1440);
  expect(await page.evaluate(()=>(window as any).zoomMoves)).toEqual([]);
  const settled=await pieces.evaluate(node=>node.getCTM()!.e);expect(settled).toBeGreaterThan(during);
  await page.evaluate(async()=>{const w=window as any;await w.zoomHost.send({...w.zoomMessage,view:{x:220},move_count:0,replay:{index:0,total:1}});});
  expect(await pieces.evaluate(node=>node.getAnimations().length)).toBe(0);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(async()=>{const w=window as any;await w.zoomHost.send({...w.zoomMessage,view:{x:380},move_count:2});});
  expect(await pieces.evaluate(node=>node.getAnimations().length)).toBe(0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(async()=>{const w=window as any;w.zoomHost.destroy();w.zoomHost=w.DeclarativeUI.mount(document.getElementById('zoom-test'),w.zoomSpec,{animate:false});await w.zoomHost.send(w.zoomMessage);await w.zoomHost.send({...w.zoomMessage,view:{x:380},move_count:1});});
  expect(await pieces.evaluate(node=>node.getAnimations().length)).toBe(0);
  expect(await page.evaluate(()=>(window as any).zoomMoves)).toEqual([]);
});

test('Backgammon legal drops work when pinched on phone and tablet, and opponent checkers animate',async({page},testInfo)=>{
  if(testInfo.project.name==='chromium')await page.setViewportSize({width:820,height:1180});
  const example=JSON.parse(fs.readFileSync(path.join(__dirname,'../games/declarative/backgammon.json'),'utf8'));
  // Reuse the package's ordinary-server test vector and its filtered views.
  const step=example.unit_tests.cases[1],seat=step.ctx.players.findIndex((player:any)=>player.id===step.player_id);
  const message=(view:any,count:number)=>({type:'state_changed',state:view,view,players:step.ctx.players.map((player:any,index:number)=>({player_index:index,player_id:player.id,name:player.display_name,kind:player.kind})),status:'ongoing',acting_for_player_index:seat,my_player_index:seat,turn_of_player_indices:[view.cur],move_count:count});
  const before=message(step.view_of_mover,step.ctx.move_count),after=message(step.expected_view_of_mover,step.ctx.move_count+1);
  await page.goto('/static/declarative-test.html');
  await page.evaluate(async({spec,before,after})=>{
    const box=document.createElement('div');box.id='zoom-test';box.style.cssText='position:fixed;inset:0;z-index:9999;background:#102330';document.body.append(box);
    const w=window as any;w.bgSpec=spec;w.bgBefore=before;w.bgAfter=after;w.bgMoves=[];
    w.bgHost=w.DeclarativeUI.mount(box,spec,{animate:true,onScene:(scene:any)=>w.bgScene=scene,onMove:(move:any)=>w.bgMoves.push(move)});await w.bgHost.send(before);
  },{spec:example.declarative_ui,before,after});
  const session=await page.context().newCDPSession(page);await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  const center=await screenPoint(page,400,300),left=await screenPoint(page,350,300),right=await screenPoint(page,450,300);
  const touch=(id:number,x:number,y:number)=>({id,x,y,radiusX:1,radiusY:1,force:1});
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(1,left.x,left.y),touch(2,right.x,right.y)]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(1,center.x-(right.x-left.x)*.75,center.y),touch(2,center.x+(right.x-left.x)*.75,center.y)]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect((await camera(page)).width).toBeCloseTo(example.declarative_ui.viewport.width/1.5,0);
  const targetId='to_'+step.move.to;
  const pieceId=await page.evaluate(targetId=>(window as any).bgScene.pieces.find((piece:any)=>piece.move_targets?.includes(targetId)).id,targetId);
  const piece=page.locator(`#zoom-test [data-ui-id="${pieceId}"]`),target=page.locator(`#zoom-test [data-ui-id="${targetId}"]`);
  const from=(await piece.boundingBox())!,to=(await target.boundingBox())!;
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(3,from.x+from.width/2,from.y+from.height/2)]});
  await expect(target).toHaveAttribute('data-drop-state','allowed');
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(3,to.x+to.width/2,to.y+to.height/2)]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>page.evaluate(()=>(window as any).bgMoves)).toEqual([step.move]);
  const fittedCamera=await camera(page);
  await page.evaluate(async()=>{const w=window as any;await w.bgHost.send(w.bgAfter);});
  expect(await piece.evaluate(node=>node.getAnimations().length)).toBe(1);
  await expect.poll(()=>piece.evaluate(node=>node.getAnimations().length)).toBe(0);
  expect(await camera(page)).toEqual(fittedCamera);
  // Watch the same authoritative move as the opponent, with no actionable pieces.
  await page.evaluate(async()=>{const w=window as any;w.bgHost.destroy();w.bgHost=w.DeclarativeUI.mount(document.getElementById('zoom-test'),w.bgSpec,{animate:true,onMove:(move:any)=>w.bgMoves.push(move)});await w.bgHost.send({...w.bgBefore,my_player_index:1-w.bgBefore.my_player_index,acting_for_player_index:null});});
  await page.locator('#zoom-test [data-camera-action="in"]').click();
  await page.evaluate(async()=>{const w=window as any;await w.bgHost.send({...w.bgAfter,my_player_index:1-w.bgAfter.my_player_index,acting_for_player_index:null});});
  expect(await piece.evaluate(node=>node.getAnimations().length)).toBe(1);
  expect(await piece.evaluate(node=>node.getAnimations()[0].effect!.getTiming().duration)).toBe(1440);
  await expect(page.locator('#zoom-test .declarative-piece.actionable')).toHaveCount(0);
  await expect.poll(()=>piece.evaluate(node=>node.getAnimations().length)).toBe(0);
  expect(await page.evaluate(()=>(window as any).bgMoves)).toEqual([step.move]);
  // Hits, bar re-entry and bearing off keep the physical checker IDs, so their
  // movements animate just like ordinary moves without inventing UI rules.
  for(const vector of example.unit_tests.cases.filter((item:any)=>['Hit a blot','Re-enter from bar','Bear off'].includes(item.name))){
    const beforeVector=message(vector.view_of_mover,vector.ctx.move_count),afterVector=message(vector.expected_view_of_mover,vector.ctx.move_count+1);
    await page.evaluate(async({before,after})=>{const w=window as any;w.bgHost.destroy();w.bgHost=w.DeclarativeUI.mount(document.getElementById('zoom-test'),w.bgSpec,{animate:true,onScene:(scene:any)=>w.bgScene=scene});await w.bgHost.send(before);w.bgAfter=after;w.bgIds=w.bgScene.pieces.filter((piece:any)=>piece.id.startsWith('checker_')).map((piece:any)=>piece.id).sort();},{before:beforeVector,after:afterVector});
    await page.locator('#zoom-test [data-camera-action="in"]').click();
    await page.evaluate(async()=>{const w=window as any;await w.bgHost.send(w.bgAfter);});
    const animationState=await page.locator('#zoom-test').evaluate(node=>{const w=window as any;return {ids:w.bgScene.pieces.filter((piece:any)=>piece.id.startsWith('checker_')).map((piece:any)=>piece.id).sort(),before:w.bgIds,moving:node.getAnimations({subtree:true}).length};});
    expect(animationState.ids).toEqual(animationState.before);expect(animationState.ids.length).toBe(30);expect(animationState.moving).toBeGreaterThanOrEqual(vector.name==='Hit a blot'?2:1);
    await expect.poll(()=>page.locator('#zoom-test').evaluate(node=>node.getAnimations({subtree:true}).length)).toBe(0);
  }
  const evidence=path.join('/tmp',`declarative-backgammon-${testInfo.project.name==='chromium'?'tablet':'phone'}.png`);
  await page.locator('#zoom-test').screenshot({path:evidence});await testInfo.attach('backgammon-board',{path:evidence,contentType:'image/png'});
});
