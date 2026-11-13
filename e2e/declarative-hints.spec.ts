import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('action hints distinguish passive art, show legal drops immediately and clear with gestures or turns',async({page},testInfo)=>{
  await page.goto('/static/declarative-test.html');
  await page.evaluate(async()=>{
    const box=document.createElement('div');box.id='hints-test';box.style.cssText='position:fixed;inset:0;z-index:9999;background:#102330';document.body.append(box);
    const spec={format:'buildplay-ui',version:1,viewport:{width:600,height:420},boards:[{id:'main',kind:'grid',x:30,y:80,width:540,height:240,rows:2,columns:3}],piece_types:{token:{shape:'circle',color:'#a7f070',width:64,height:64}},
      ui_code:`const gameUI={reduce(message,local){const m=message.type==='ui_event'?message.state_changed:message;local=local||{rotation:0,scale:1};const event=message.event;if(event?.type==='rotate')local.rotation+=event.delta;if(event?.type==='scale')local.scale*=event.factor;const scene={pieces:[
        {id:'movable',type:'token',board:'main',position:{cell:'0'},text:'M',actions:['move','rotate','scale'],move_targets:['home'],rotation:local.rotation,scale:local.scale},
        {id:'tap',type:'token',board:'main',position:{cell:'3'},text:'T',actions:['tap']},
        {id:'passive',type:'token',board:'main',position:{cell:'4'},text:'P',actions:[],rotation:45,scale:1.5}],targets:[{id:'home',board:'main',position:{cell:'1'},label:'Home'},{id:'other',board:'main',position:{cell:'2'},label:'Other'}],controls:[{id:'enabled',kind:'button',label:'Enabled'},{id:'disabled',kind:'button',label:'Disabled',disabled:true}],labels:[{id:'last',text:event?event.type:'ready',x:30,y:350}]};return {scene,local_state:local,...(event?.type==='drop'?{make_move:{to:event.target_id}}:{})};}};`};
    const message={type:'state_changed',view:{},state:{},status:'ongoing',my_player_index:0,acting_for_player_index:0,move_count:0};
    const w=window as any;w.hintMoves=[];w.hintMessage=message;w.hintHost=w.DeclarativeUI.mount(box,spec,{onMove:(move:any)=>w.hintMoves.push(move)});await w.hintHost.send(message);
  });
  const movable=page.locator('#hints-test [data-ui-id="movable"]');
  const tap=page.locator('#hints-test [data-ui-id="tap"]');
  const passive=page.locator('#hints-test [data-ui-id="passive"]');
  const home=page.locator('#hints-test [data-ui-id="home"]');
  const other=page.locator('#hints-test [data-ui-id="other"]');
  await expect(movable).toHaveClass(/actionable/);await expect(tap).toHaveClass(/actionable/);await expect(passive).not.toHaveClass(/actionable/);
  await expect(movable).toHaveAttribute('data-actions','move rotate scale');
  await expect(movable.locator('.declarative-piece-action-outline')).toBeVisible();
  await expect(passive.locator('.declarative-action-badges')).toHaveCount(0);
  await expect(page.locator('#hints-test [data-ui-id="enabled"]')).toBeEnabled();
  await expect(page.locator('#hints-test [data-ui-id="disabled"]')).toBeDisabled();
  await expect(home).toHaveAttribute('data-drop-state','placement');
  if(process.env.DECLARATIVE_HINTS_EVIDENCE_DIR){const output=path.resolve(process.env.DECLARATIVE_HINTS_EVIDENCE_DIR);fs.mkdirSync(output,{recursive:true});await page.locator('#hints-test').screenshot({path:path.join(output,`hints-idle-${testInfo.project.name}.png`)});}
  const from=(await movable.boundingBox())!;
  // The hint appears on pointerdown, before any movement or reducer reply.
  await movable.dispatchEvent('pointerdown',{pointerId:3,pointerType:'touch',clientX:from.x+from.width/2,clientY:from.y+from.height/2});
  await expect(home).toHaveAttribute('data-drop-state','allowed');await expect(other).toHaveAttribute('data-drop-state','unavailable');
  await expect(other).toHaveAttribute('aria-disabled','true');
  await page.locator('body').dispatchEvent('pointercancel',{pointerId:3,pointerType:'touch'});
  await expect(home).toHaveAttribute('data-drop-state','placement');
  await movable.focus();await page.keyboard.press('Enter');
  await expect(home).toHaveAttribute('data-drop-state','allowed');
  await page.locator('#hints-test [data-piece-action="rotate"]').click();
  await expect(movable).toHaveAttribute('transform',/rotate\(90\)/);
  await page.locator('#hints-test [data-piece-action="grow"]').click();
  await expect(movable).toHaveAttribute('transform',/scale\(1\.1\)/);
  await page.locator('#hints-test [data-piece-action="shrink"]').click();
  await expect(movable).toHaveAttribute('transform',/scale\(1\)/);
  await page.keyboard.press('Escape');await expect(home).toHaveAttribute('data-drop-state','placement');
  // Leaving the canvas also ends drag highlighting instead of stranding it.
  await movable.dispatchEvent('pointerdown',{pointerId:4,pointerType:'mouse',clientX:from.x,clientY:from.y});
  await page.locator('body').dispatchEvent('pointerup',{pointerId:99,pointerType:'touch',clientX:-20,clientY:-20});
  await expect(home).toHaveAttribute('data-drop-state','allowed');
  await page.locator('body').dispatchEvent('pointercancel',{pointerId:99,pointerType:'touch'});
  await expect(home).toHaveAttribute('data-drop-state','allowed');
  await page.locator('body').dispatchEvent('pointerup',{pointerId:4,pointerType:'mouse',clientX:-20,clientY:-20});
  await expect(home).toHaveAttribute('data-drop-state','placement');
  // A matching target ID in another host cannot receive this piece's drop.
  await page.evaluate(()=>{const foreign=document.createElement('button');foreign.id='foreign-drop';foreign.className='declarative-target';foreign.dataset.uiId='home';foreign.style.cssText='position:fixed;right:0;bottom:0;z-index:10000;width:40px;height:40px';document.body.append(foreign);});
  await movable.dispatchEvent('pointerdown',{pointerId:6,pointerType:'touch',clientX:from.x,clientY:from.y});
  const foreign=(await page.locator('#foreign-drop').boundingBox())!;
  await page.locator('#foreign-drop').dispatchEvent('pointerup',{pointerId:6,pointerType:'touch',clientX:foreign.x+20,clientY:foreign.y+20});
  expect(await page.evaluate(()=>(window as any).hintMoves)).toEqual([]);
  await page.locator('#foreign-drop').evaluate(node=>node.remove());
  // Native HTML drag causes pointercancel; it must retain legal destinations.
  await movable.dispatchEvent('dragstart');
  await movable.dispatchEvent('pointercancel',{pointerId:6,pointerType:'mouse'});
  await expect(home).toHaveAttribute('data-drop-state','allowed');
  await home.dispatchEvent('drop');
  await expect.poll(()=>page.evaluate(()=>(window as any).hintMoves)).toEqual([{to:'home'}]);
  await page.evaluate(async()=>{const w=window as any;await w.hintHost.send({...w.hintMessage,move_count:1});});
  await movable.focus();await page.keyboard.press('Enter');
  await other.dispatchEvent('click');expect(await page.evaluate(()=>(window as any).hintMoves)).toEqual([{to:'home'}]);
  await home.focus();await page.keyboard.press('Enter');
  await expect.poll(()=>page.evaluate(()=>(window as any).hintMoves)).toEqual([{to:'home'},{to:'home'}]);
  await expect(movable).not.toHaveClass(/actionable/);await expect(home).toHaveAttribute('data-drop-state','inactive');
  await expect(page.locator('#hints-test .declarative-hint-message')).toBeHidden();
  for(const update of [{acting_for_player_index:null},{replay:{index:0,total:1}},{status:'over'}]){
    await page.evaluate(async update=>{const w=window as any;await w.hintHost.send({...w.hintMessage,...update});},update);
    await expect(page.locator('#hints-test .actionable')).toHaveCount(0);
    await expect(page.locator('#hints-test .declarative-hint-message')).toBeHidden();
  }
  await page.evaluate(async()=>{const w=window as any;await w.hintHost.send({...w.hintMessage,move_count:1});});
  await expect(movable).toHaveClass(/actionable/);
  const pending=await page.evaluate(()=>{const w=window as any;w.hintHost.send({...w.hintMessage,move_count:2});return {actionable:document.querySelectorAll('#hints-test .actionable').length,hintsHidden:(document.querySelector('#hints-test .declarative-hint-message') as HTMLElement).hidden};});
  expect(pending).toEqual({actionable:0,hintsHidden:true});
  await expect(movable).toHaveClass(/actionable/);
  await movable.focus();await page.keyboard.press('Enter');
  if(process.env.DECLARATIVE_HINTS_EVIDENCE_DIR){const output=path.resolve(process.env.DECLARATIVE_HINTS_EVIDENCE_DIR);fs.mkdirSync(output,{recursive:true});await page.locator('#hints-test').screenshot({path:path.join(output,`hints-drop-${testInfo.project.name}.png`)});}
  await testInfo.attach('always-on-action-and-drop-hints',{body:await page.locator('#hints-test').screenshot(),contentType:'image/png'});
  await page.evaluate(()=>(window as any).hintHost.destroy());
});
