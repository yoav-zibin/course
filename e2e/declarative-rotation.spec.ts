import {test,expect,type Page} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
declare const I18n:any;

// An L-shaped tromino: rotate both ways, flip, preview its cells before placing.
const UI_CODE=`const SHAPE=[[0,0],[1,0],[0,1]];
function cells(o){return SHAPE.map(([x,y])=>{if(o.flipped)x=-x;for(let i=0;i<((o.rotation/90)%4+4)%4;i++)[x,y]=[-y,x];return [x,y];});}
const gameUI={reduce(message,local){
  local=local||{rotation:0,flipped:false};
  const event=message.type==='ui_event'?message.event:null;
  if(event?.type==='rotate')local={...local,rotation:((local.rotation+event.delta)%360+360)%360};
  if(event?.type==='flip')local={...local,flipped:!local.flipped};
  const shape=cells(local),selected=Boolean(event&&event.type!=='drop'&&event.type!=='tap');
  const pieces=shape.map(([x,y],i)=>({id:'cell'+i,type:'cell',board:'tray',position:{x:90+x*40,y:90+y*40},
    actions:['rotate','flip'],move_targets:['place','other'],selected,aria_label:'L piece'}));
  const preview=at=>shape.map(([x,y])=>({position:{cell:String((Math.floor(at/5)+y)*5+at%5+x)},color:'#4f8cff'}));
  const targets=[{id:'place',board:'main',position:{cell:'12'},aria_label:'Middle',preview:preview(12)},
    {id:'other',board:'main',position:{cell:'6'},aria_label:'Upper left',preview:preview(6)}];
  const result={scene:{pieces,targets,labels:[{id:'state',text:local.rotation+(local.flipped?' flipped':''),x:10,y:10}]},local_state:local};
  if(event?.type==='drop')result.make_move={at:event.target_id,...local};
  return result;
}};`;

async function mountRotation(page:Page,code=UI_CODE,locale?:string){
  await page.goto('/static/declarative-test.html');
  if(locale)await page.evaluate(language=>I18n.choose(language),locale);
  await page.evaluate(async code=>{
    const box=document.createElement('div');box.id='rotation-test';box.style.cssText='position:fixed;inset:0;z-index:9999;background:#102330;display:flex;flex-direction:column';document.body.append(box);
    const spec={format:'buildplay-ui',version:1,viewport:{width:640,height:360},
      boards:[{id:'tray',kind:'zone',x:0,y:0,width:200,height:360},{id:'main',kind:'grid',x:240,y:20,width:320,height:320,rows:5,columns:5}],
      piece_types:{cell:{shape:'rect',color:'#ffb347',width:38,height:38}},ui_code:code};
    const message={type:'state_changed',view:{},state:{},status:'ongoing',my_player_index:0,acting_for_player_index:0,move_count:0};
    const w=window as any;w.rotMoves=[];w.rotMessage=message;
    w.rotHost=w.DeclarativeUI.mount(box,spec,{onMove:(move:any)=>w.rotMoves.push(move)});await w.rotHost.send(message);
  },code);
}

test('rotation tools, keyboard, flip and placement previews work for touch, mouse and keyboard',async({page},testInfo)=>{
  await mountRotation(page);
  const root=page.locator('#rotation-test');
  const cell=root.locator('[data-ui-id="cell0"]');
  const place=root.locator('[data-ui-id="place"]'),other=root.locator('[data-ui-id="other"]');
  const ghosts=root.locator('.declarative-preview-cell');
  const state=root.locator('text').filter({hasText:/^\d+/}).first();
  await expect(cell).toHaveAttribute('data-actions','move rotate flip');
  await expect(cell.locator('[data-action-hint="flip"]')).toHaveCount(1);
  // The toolbar is visible before selection, with disabled buttons, so the
  // layout never jumps when a piece is selected or dragged.
  await expect(root.locator('.declarative-piece-actions')).toBeVisible();
  await expect(root.locator('.declarative-piece-actions-caption')).toHaveText('Select a piece to use these tools');
  await expect(root.locator('.declarative-piece-actions button:disabled')).toHaveCount(3);
  const before=(await root.locator('.declarative-stage').boundingBox())!;

  // Selecting the piece shows both rotate directions and flip, all touch-sized.
  await cell.focus();await page.keyboard.press('Enter');
  const tools=root.locator('.declarative-piece-actions button');
  expect((await root.locator('.declarative-stage').boundingBox())!.height).toBeCloseTo(before.height,0);
  await expect(tools).toHaveCount(3);
  await expect(tools.nth(0)).toHaveAttribute('data-piece-action','rotate_counterclockwise');
  await expect(tools.nth(0)).toHaveAccessibleName('Rotate L piece counterclockwise');
  await expect(tools.nth(1)).toHaveAccessibleName('Rotate L piece');
  await expect(tools.nth(2)).toHaveAccessibleName('Flip L piece');
  for(let i=0;i<3;i++){const box=(await tools.nth(i).boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);}
  const pressTool=async(index:number)=>testInfo.project.name==='mobile'?tools.nth(index).tap():tools.nth(index).click();
  await pressTool(0);await expect(state).toHaveText('270');
  await pressTool(1);await expect(state).toHaveText('0');
  await pressTool(2);await expect(state).toHaveText('0 flipped');
  await tools.nth(2).focus();
  // Keyboard: R clockwise, Shift+R counterclockwise, F flips.
  await page.keyboard.press('r');await expect(state).toHaveText('90 flipped');
  await page.keyboard.press('Shift+R');await page.keyboard.press('Shift+R');await expect(state).toHaveText('270 flipped');
  await page.keyboard.press('f');await expect(state).toHaveText('270');
  expect(await page.evaluate(()=>(window as any).rotMoves)).toEqual([]);

  // Keyboard focus previews the whole shape where it would land.
  await place.focus();await expect(ghosts).toHaveCount(3);await expect(place).toHaveClass(/previewing/);
  await page.keyboard.press('Escape');await expect(ghosts).toHaveCount(0);

  // Mouse hover previews, leaving clears.
  await cell.click();
  const target=(await place.boundingBox())!;
  await page.mouse.move(target.x+target.width/2,target.y+target.height/2);await expect(ghosts).toHaveCount(3);
  if(process.env.DECLARATIVE_ROTATION_EVIDENCE_DIR){const out=path.resolve(process.env.DECLARATIVE_ROTATION_EVIDENCE_DIR);fs.mkdirSync(out,{recursive:true});await root.screenshot({path:path.join(out,`rotation-preview-${testInfo.project.name}.png`)});}
  await page.mouse.move(5,350);await expect(ghosts).toHaveCount(0);

  // Dragging a cell previews the destination under the pointer.
  const from=(await cell.boundingBox())!;
  await cell.dispatchEvent('pointerdown',{pointerId:7,pointerType:'touch',clientX:from.x+5,clientY:from.y+5});
  await page.locator('body').dispatchEvent('pointermove',{pointerId:7,pointerType:'touch',clientX:target.x+target.width/2,clientY:target.y+target.height/2});
  await expect(ghosts).toHaveCount(3);
  await page.locator('body').dispatchEvent('pointercancel',{pointerId:7,pointerType:'touch'});
  await expect(ghosts).toHaveCount(0);

  // Touch: the first tap arms and previews, a tap elsewhere re-arms, the second tap on the same spot places.
  await cell.click();
  await other.dispatchEvent('pointerdown',{pointerType:'touch'});await other.dispatchEvent('click');
  await expect(other).toHaveClass(/armed/);await expect(ghosts).toHaveCount(3);
  await expect(root.locator('.declarative-preview-status')).toHaveText('Tap the same spot again to place it there.');
  await place.dispatchEvent('pointerdown',{pointerType:'touch'});await place.dispatchEvent('click');
  await expect(place).toHaveClass(/armed/);await expect(other).not.toHaveClass(/armed/);
  // Rotating while armed keeps the spot armed and redraws the ghost.
  await page.keyboard.press('r');await expect(state).toHaveText('0');await expect(place).toHaveClass(/armed/);await expect(ghosts).toHaveCount(3);
  expect(await page.evaluate(()=>(window as any).rotMoves)).toEqual([]);
  await place.dispatchEvent('pointerdown',{pointerType:'touch'});await place.dispatchEvent('click');
  await expect.poll(()=>page.evaluate(()=>(window as any).rotMoves)).toEqual([{at:'place',rotation:0,flipped:false}]);
  await expect(root.locator('.declarative-preview-status')).toBeHidden();await expect(ghosts).toHaveCount(0);

  // A new state clears everything; spectators get no tools, previews or shortcuts.
  await page.evaluate(async()=>{const w=window as any;await w.rotHost.send({...w.rotMessage,move_count:1,acting_for_player_index:null});});
  await expect(root.locator('.actionable')).toHaveCount(0);
  await place.dispatchEvent('focus');await expect(ghosts).toHaveCount(0);
  await page.keyboard.press('r');await expect(state).toHaveText('0');
  await page.evaluate(()=>(window as any).rotHost.destroy());
});

test('a previewed destination keeps its interior clickable with the mouse',async({page})=>{
  await mountRotation(page);
  const root=page.locator('#rotation-test');
  await root.locator('[data-ui-id="cell0"]').click();
  const place=root.locator('[data-ui-id="place"]');
  await place.hover();
  await expect(root.locator('.declarative-preview-cell')).toHaveCount(3);
  await place.click();
  await expect.poll(()=>page.evaluate(()=>(window as any).rotMoves)).toEqual([{at:'place',rotation:0,flipped:false}]);
});

test.describe('native touch placement',()=>{
  test.use({hasTouch:true});
  for(const locale of ['en','de','ar','hi'])test(`two taps at the same screen position place the preview in ${locale}`,async({page})=>{
    await page.setViewportSize({width:360,height:780});
    const adjacent=UI_CODE.replace("move_targets:['place','other']","move_targets:['place','other','below']")
      .replace("preview:preview(6)}];","preview:preview(6)},{id:'below',board:'main',position:{cell:'17'},aria_label:'Below',preview:preview(17)}];");
    await mountRotation(page,adjacent,locale);
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    const root=page.locator('#rotation-test'),stage=root.locator('.declarative-stage');
    await root.locator('[data-ui-id="cell0"]').tap();
    const place=root.locator('[data-ui-id="place"]');
    const box=(await place.boundingBox())!,before=(await stage.boundingBox())!;
    const point={x:box.x+box.width/2,y:box.y+box.height/2};
    await page.touchscreen.tap(point.x,point.y);
    await expect(place).toHaveClass(/armed/);
    await expect(root.locator('.declarative-preview-cell')).toHaveCount(3);
    expect(await page.evaluate(()=>(window as any).rotMoves)).toEqual([]);
    await expect.poll(async()=>(await stage.boundingBox())!.height).toBeCloseTo(before.height,1);
    // Reuse the physical position, rather than relocating the element after
    // the confirmation line appears. Nearby destinations must not replace it.
    await page.touchscreen.tap(point.x,point.y);
    await expect.poll(()=>page.evaluate(()=>(window as any).rotMoves)).toEqual([{at:'place',rotation:0,flipped:false}]);
  });
});
