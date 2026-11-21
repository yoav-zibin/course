import {test,expect,type Page,type Locator} from '@playwright/test';
import {createUser,loginAs,uniqueName} from './helpers';

test.beforeEach(async({baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Bug drag checks require a disposable loopback server.');
});
const label='Report a bug or request a feature';

async function drag(page:Page,control:Locator,x:number,y:number,touch:boolean) {
  await expect.poll(()=>control.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
  const box=(await control.boundingBox())!,start={x:box.x+box.width/2,y:box.y+box.height/2};
  if(touch){
    const client=await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:1}]});
    for(let step=1;step<=8;step++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(x-start.x)*step/8,y:start.y+(y-start.y)*step/8,id:1}]});
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await client.detach();
  }else{
    await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(x,y,{steps:8});await page.mouse.up();
  }
}

test('floating bug control drags without reporting and keeps its position over dialogs',async({page,isMobile})=>{
  await page.goto('/portal');
  const control=page.getByRole('button',{name:label,exact:true});await expect(control).toBeVisible();
  const initial=(await control.boundingBox())!,games=(await page.getByTestId('header-games').boundingBox())!;
  expect(games.y).toBeLessThan(initial.y+initial.height);
  expect(games.x).toBeGreaterThanOrEqual(initial.x+initial.width);
  await drag(page,control,240,270,isMobile);
  await expect(page.getByRole('textbox',{name:'Bug or feature request',exact:true})).toHaveCount(0);
  await expect.poll(async()=>(await control.boundingBox())!.x).toBeGreaterThan(150);
  const moved=(await control.boundingBox())!;
  expect(moved.x).toBeGreaterThan(150);expect(moved.y).toBeGreaterThan(180);

  await page.getByRole('button',{name:'Log in',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Close dialog',exact:true})).toBeVisible();
  await expect.poll(async()=>Math.abs((await control.boundingBox())!.x-moved.x)).toBeLessThan(1);
  await expect.poll(()=>control.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
  await drag(page,control,140,175,isMobile);
  await expect(page.getByRole('textbox',{name:'Bug or feature request',exact:true})).toHaveCount(0);
  if(isMobile)await control.tap();else await control.click();
  await expect(page.getByRole('textbox',{name:'Bug or feature request',exact:true})).toBeVisible();
  await expect(page.getByText('Your screenshot, recent app logs, errors, API timings, pages, device details, and account identity will be included. Passwords and API request bodies are excluded from diagnostics.',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('img',{name:'Screenshot captured before opening this report',exact:true})).toBeVisible();
});

test('moved bug control clamps after viewport changes and retains keyboard activation',async({page,isMobile})=>{
  await page.setViewportSize({width:900,height:650});await page.goto('/portal');
  const control=page.getByRole('button',{name:label,exact:true});await expect(control).toBeVisible();
  await drag(page,control,899,649,isMobile);
  await expect(page.getByRole('textbox',{name:'Bug or feature request',exact:true})).toHaveCount(0);
  await page.setViewportSize({width:320,height:480});
  await expect.poll(async()=>{const box=(await control.boundingBox())!;return box.x>=0&&box.y>=0&&box.x+box.width<=320&&box.y+box.height<=480;}).toBe(true);
  await control.focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox',{name:'Bug or feature request',exact:true})).toBeVisible();
});

test('dragged bug control remains above native browser modals and fullscreen content',async({page,isMobile})=>{
  await page.goto('/portal');const control=page.getByRole('button',{name:label,exact:true});await expect(control).toBeVisible();
  await page.evaluate(()=>{const dialog=document.createElement('dialog');dialog.id='drag-blocker';dialog.style.cssText='position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;background:black';document.body.appendChild(dialog);dialog.showModal();});
  await drag(page,control,200,220,isMobile);
  await expect(page.getByRole('textbox',{name:'Bug or feature request',exact:true})).toHaveCount(0);
  await expect.poll(()=>control.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
  await page.evaluate(()=>{(document.getElementById('drag-blocker') as HTMLDialogElement).close();});
  if(!isMobile){
    await page.evaluate(async()=>{const full=document.createElement('div');full.id='drag-fullscreen';full.style.cssText='position:fixed;inset:0;background:black';document.body.appendChild(full);await full.requestFullscreen();});
    await drag(page,control,350,280,false);
    await expect.poll(async()=>(await control.boundingBox())!.x).toBeGreaterThan(250);
    await expect(page.getByRole('textbox',{name:'Bug or feature request',exact:true})).toHaveCount(0);
  }
  await control.focus();await page.keyboard.press('Space');
  await expect(page.getByRole('textbox',{name:'Bug or feature request',exact:true})).toBeVisible();
});

test('bug and menu drag as one control and remain usable after narrow and landscape resizing',async({page,request,isMobile})=>{
  const owner=await createUser(request,uniqueName('Grouped control owner'));
  await loginAs(page,owner);await page.goto('/portal#local');
  await page.getByRole('button',{name:'Pass and play',exact:true}).click();
  const group=page.getByTestId('match-floating-controls'),bug=page.getByTestId('bug-report-button'),menu=page.getByTestId('match-menu-button');
  await expect(group).toBeVisible();await expect(menu).toHaveAttribute('aria-expanded','false');
  async function assertPair(){
    await expect(group.getByRole('button')).toHaveCount(2);
    const whole=(await group.boundingBox())!,left=(await bug.boundingBox())!,right=(await menu.boundingBox())!;
    expect(Math.abs(left.y-right.y)).toBeLessThan(1);
    expect(Math.abs(left.x+left.width-right.x)).toBeLessThan(1);
    expect(left.x).toBeGreaterThanOrEqual(whole.x);expect(right.x+right.width).toBeLessThanOrEqual(whole.x+whole.width);
    expect(whole.x).toBeGreaterThanOrEqual(0);expect(whole.y).toBeGreaterThanOrEqual(0);
    expect(whole.x+whole.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(whole.y+whole.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    return whole;
  }
  const initial=await assertPair();
  await drag(page,bug,180,220,isMobile);
  await expect(menu).toHaveAttribute('aria-expanded','false');
  await expect(page.getByRole('textbox',{name:'Bug or feature request',exact:true})).toHaveCount(0);
  const moved=await assertPair();expect(Math.abs(moved.y-initial.y)).toBeGreaterThan(30);
  await drag(page,menu,page.viewportSize()!.width-1,page.viewportSize()!.height-1,isMobile);
  await expect(menu).toHaveAttribute('aria-expanded','false');await assertPair();
  for(const viewport of [{width:844,height:390},{width:320,height:480}]){
    await page.setViewportSize(viewport);
    await expect.poll(async()=>{const box=(await group.boundingBox())!;return box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height;}).toBe(true);
    await assertPair();
    if(isMobile)await menu.tap();else await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded','true');await expect(page.getByTestId('portal-header')).toBeVisible();
    if(isMobile)await menu.tap();else await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded','false');await expect(page.getByTestId('portal-header')).toHaveCount(0);
  }
  if(isMobile)await bug.tap();else await bug.click();
  await expect(page.getByRole('textbox',{name:'Bug or feature request',exact:true})).toBeVisible();
  await expect(page.getByRole('img',{name:'Screenshot captured before opening this report',exact:true})).toBeVisible();
});
