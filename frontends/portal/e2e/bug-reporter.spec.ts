import {test,expect} from '@playwright/test';
import {E2E_ADMIN_HEADERS} from './helpers';

test.beforeEach(async({baseURL})=>{if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Bug reporter tests require a disposable loopback server.');});
const label='Report a bug or request a feature';

test('captures before opening, sends real screenshot with recent diagnostics, and remains above modal and focus mode',async({page,request})=>{
  await page.goto('/portal');await page.getByRole('button',{name:'Log in',exact:true}).click();
  const bug=page.getByRole('button',{name:label,exact:true});await expect(bug).toBeVisible();
  // A shared account modal must never cover or disable the always-visible icon.
  await expect.poll(()=>bug.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'On this device',exact:true}).click();await page.getByRole('button',{name:'Pass and play',exact:true}).click();
  await page.getByRole('button',{name:'Focus mode',exact:true}).click();await expect(page.getByRole('link',{name:'BuildPlay home'})).toHaveCount(0);await expect(bug).toBeVisible();
  await page.evaluate(()=>{const pane=document.createElement('div');pane.id='scroll-screenshot-proof';pane.style.cssText='position:fixed;left:60px;top:100px;width:100px;height:80px;overflow:auto;z-index:2147483646';pane.innerHTML='<div style="height:1000px;background:black"></div><div style="height:80px;background:rgb(255,0,255)"></div>';document.body.appendChild(pane);pane.scrollTop=1000;});
  await page.evaluate(()=>console.error('Visible diagnostic marker password=do-not-copy'));
  const capture=page.waitForRequest(request=>request.method()==='POST'&&new URL(request.url()).pathname==='/bug-reports');
  await bug.click();await expect(page.getByRole('textbox',{name:'Bug or feature request'})).toBeVisible();
  const image=page.getByRole('img',{name:'Screenshot captured before opening this report'});await expect(image).toBeVisible();
  const uri=await image.getAttribute('src');expect(uri).toMatch(/^data:image\/jpeg;base64,/);expect(uri!.length).toBeLessThanOrEqual(500000);
  const pixels=await image.evaluate(async node=>{const image=node as HTMLImageElement;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);const data=c.getImageData(0,0,canvas.width,canvas.height).data;const colors=new Set<string>();for(let i=0;i<data.length;i+=400)colors.add(`${data[i]},${data[i+1]},${data[i+2]}`);return {width:canvas.width,height:canvas.height,colors:colors.size,sample:Array.from(c.getImageData(90,130,1,1).data)};});
  expect(pixels.width).toBeGreaterThan(300);expect(pixels.height).toBeGreaterThan(200);expect(pixels.colors).toBeGreaterThan(10);expect(pixels.sample[0]).toBeGreaterThan(235);expect(pixels.sample[1]).toBeLessThan(20);expect(pixels.sample[2]).toBeGreaterThan(235);
  await page.evaluate(()=>document.getElementById('scroll-screenshot-proof')?.remove());
  await page.getByRole('textbox',{name:'Bug or feature request'}).fill('The game board needs a clearer turn marker.');await page.getByRole('button',{name:'Send report',exact:true}).click();
  const submitted=(await capture).postDataJSON();expect(submitted.screenshot).toBe(uri);expect(submitted.diagnostics.context.matchId).toBeTruthy();expect(submitted.diagnostics.pages.some((row:any)=>row.page.focus)).toBe(true);expect(submitted.diagnostics.apiCalls.length).toBeGreaterThan(0);
  expect(submitted.diagnostics.context.webAssets.some((asset:string)=>asset.startsWith('/static/app/_expo/static/js/web/index-'))).toBe(true);
  expect(JSON.stringify(submitted.diagnostics)).toContain('Visible diagnostic marker');expect(JSON.stringify(submitted.diagnostics)).not.toContain('do-not-copy');
  await expect(page.getByText('Thanks! Your report was sent.')).toBeVisible();
  const listed=await request.get('/admin/bug-reports?status=open',{headers:E2E_ADMIN_HEADERS});expect(listed.ok()).toBe(true);const rows=await listed.json();const reports=rows.items||rows.reports||rows.bug_reports;expect(reports.some((row:any)=>row.text===submitted.text)).toBe(true);
});

test('bug icon remains clickable above a browser modal dialog and fullscreen content',async({page,isMobile})=>{
  await page.goto('/portal');const bug=page.getByRole('button',{name:label,exact:true});await expect(bug).toBeVisible();
  await page.evaluate(()=>{const dialog=document.createElement('dialog');dialog.id='blocking-dialog';dialog.style.cssText='position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;background:black;';dialog.textContent='Blocking native browser dialog';document.body.appendChild(dialog);dialog.showModal();});
  await expect.poll(()=>bug.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
  await bug.click();await page.getByRole('textbox',{name:'Bug or feature request'}).fill('Report while native browser dialog is still open.');
  await expect(page.getByRole('textbox',{name:'Bug or feature request'})).toHaveValue('Report while native browser dialog is still open.');
  await page.evaluate(()=>{(document.getElementById('blocking-dialog') as HTMLDialogElement).close();});
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  if(!isMobile){
    await page.evaluate(async()=>{const full=document.createElement('div');full.id='full-screen';full.style.cssText='position:fixed;inset:0;background:black';document.body.appendChild(full);await full.requestFullscreen();});
    await expect(bug).toBeVisible();await expect.poll(()=>bug.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
    await bug.click();await page.getByRole('textbox',{name:'Bug or feature request'}).fill('Report while the browser is still in fullscreen.');
    await page.getByRole('button',{name:'Send report',exact:true}).click();await expect(page.getByText('Thanks! Your report was sent.')).toBeVisible();
    await page.evaluate(()=>document.exitFullscreen());
  }
});

test('capture failure still opens a report and preserves its text across a failed submission',async({page})=>{
  await page.goto('/portal');await page.evaluate(()=>{HTMLCanvasElement.prototype.toDataURL=()=>{throw new Error('Screenshot test failure');};});
  await page.getByRole('button',{name:label,exact:true}).click();await expect(page.getByText(/Screenshot unavailable:/)).toBeVisible();
  let attempts=0;await page.route('**/bug-reports',route=>attempts++===0?route.fulfill({status:503,json:{detail:'Please retry later'}}):route.continue());
  const input=page.getByRole('textbox',{name:'Bug or feature request'});await input.fill('Keep this request when the network fails.');await page.getByRole('button',{name:'Send report',exact:true}).click();
  await expect(page.getByText('Please retry later',{exact:true}).last()).toBeVisible();await expect(input).toHaveValue('Keep this request when the network fails.');
  const retry=page.waitForRequest(request=>request.method()==='POST'&&new URL(request.url()).pathname==='/bug-reports');
  await page.getByRole('button',{name:'Send report',exact:true}).click();const body=(await retry).postDataJSON();expect(body.diagnostics.apiCalls.some((call:any)=>call.status===503)).toBe(true);expect(JSON.stringify(body.diagnostics.logs)).toContain('Please retry later');await expect(page.getByText('Thanks! Your report was sent.')).toBeVisible();
});
