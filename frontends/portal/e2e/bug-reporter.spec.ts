import {test,expect} from '@playwright/test';
import {createUser,E2E_ADMIN_HEADERS,uniqueName} from './helpers';
import {verifiedSignInFixtures,logoutAndSignIn} from './auth-fixtures';

test.beforeEach(async({baseURL})=>{if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Bug reporter tests require a disposable loopback server.');});
const label='Report a bug or request a feature';

test('switching accounts keeps an earlier private report and diagnostics out of the new report',async({page,request})=>{
  const alice=await createUser(request,uniqueName('Private Alice'));
  const bob=await createUser(request,uniqueName('Private Bob'));
  await verifiedSignInFixtures(page,[alice,bob]);
  await page.addInitScript(accounts=>{
    localStorage.setItem('game-platform.accounts.v1',JSON.stringify(accounts));
    localStorage.setItem('game-platform.current-account.v1',accounts[0].id);
  },[alice,bob]);
  await page.goto('/portal');
  await expect(page.getByRole('button',{name:'Account menu',exact:true})).toHaveAccessibleDescription(alice.display_name);
  await page.evaluate(()=>console.error('private-account-alice-diagnostic-marker'));
  const bug=page.getByRole('button',{name:label,exact:true});
  const input=page.getByRole('textbox',{name:'Bug or feature request'});
  await bug.click();await input.fill('Alice private match report must stay with Alice.');
  const earlierScreenshot=await page.getByRole('img',{name:'Screenshot captured before opening this report'}).getAttribute('src');
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await logoutAndSignIn(page,bob);
  await expect(page.getByRole('button',{name:'Account menu',exact:true})).toHaveAccessibleDescription(bob.display_name);
  await bug.click();await expect(input).toHaveValue('');
  expect(await page.getByRole('img',{name:'Screenshot captured before opening this report'}).getAttribute('src')).not.toBe(earlierScreenshot);
  await input.fill('Bob has a different report for his own session.');
  const sent=page.waitForRequest(request=>request.method()==='POST'&&new URL(request.url()).pathname==='/bug-reports');
  await page.getByRole('button',{name:'Send report',exact:true}).click();
  const submitted=await sent,body=submitted.postDataJSON();
  expect(submitted.headers()['x-user-id']).toBe(bob.id);
  expect(body.diagnostics.context.user.id).toBe(bob.id);
  expect(JSON.stringify(body.diagnostics)).not.toContain('private-account-alice-diagnostic-marker');
  expect(JSON.stringify(body)).not.toContain('Alice private match report');
  await expect(page.getByText('Thanks! Your report was sent.')).toBeVisible();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await logoutAndSignIn(page,alice);
  await expect(page.getByRole('button',{name:'Account menu',exact:true})).toHaveAccessibleDescription(alice.display_name);
  await bug.click();await expect(input).toHaveValue('Alice private match report must stay with Alice.');
});

test('an account change cancels a screenshot captured for the previous account',async({page,request})=>{
  const alice=await createUser(request,uniqueName('Capture Alice'));
  const bob=await createUser(request,uniqueName('Capture Bob'));
  await verifiedSignInFixtures(page,[alice,bob]);
  await page.addInitScript(accounts=>{
    localStorage.setItem('game-platform.accounts.v1',JSON.stringify(accounts));
    localStorage.setItem('game-platform.current-account.v1',accounts[0].id);
  },[alice,bob]);
  await page.goto('/portal');
  await expect(page.getByRole('button',{name:'Account menu',exact:true})).toHaveAccessibleDescription(alice.display_name);
  await page.evaluate(()=>{
    const decode=HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode=function(){
      if(this.src.startsWith('data:image/svg+xml'))return new Promise<void>((resolve,reject)=>{
        (window as any).__releasePrivateCapture=()=>decode.call(this).then(resolve,reject);
      });
      return decode.call(this);
    };
  });
  await page.getByRole('button',{name:label,exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>typeof(window as any).__releasePrivateCapture)).toBe('function');
  await logoutAndSignIn(page,bob);
  await expect(page.getByRole('button',{name:'Account menu',exact:true})).toHaveAccessibleDescription(bob.display_name);
  await page.evaluate(()=>(window as any).__releasePrivateCapture());
  await expect(page.getByRole('textbox',{name:'Bug or feature request'})).toHaveCount(0);
});

test('a rejected capture from a previous account cannot enter the next report diagnostics',async({page,request})=>{
  const alice=await createUser(request,uniqueName('Rejected capture Alice'));
  const bob=await createUser(request,uniqueName('Rejected capture Bob'));
  await verifiedSignInFixtures(page,[alice,bob]);
  await page.addInitScript(accounts=>{
    localStorage.setItem('game-platform.accounts.v1',JSON.stringify(accounts));
    localStorage.setItem('game-platform.current-account.v1',accounts[0].id);
  },[alice,bob]);
  await page.goto('/portal');
  await expect(page.getByRole('button',{name:'Account menu',exact:true})).toHaveAccessibleDescription(alice.display_name);
  await page.evaluate(()=>{
    const decode=HTMLImageElement.prototype.decode;let hold=true;
    HTMLImageElement.prototype.decode=function(){
      if(hold&&this.src.startsWith('data:image/svg+xml')){
        hold=false;return new Promise<void>((_resolve,reject)=>{
          (window as any).__rejectPrivateCapture=()=>reject(new Error('alice-private-capture-failure-marker'));
        });
      }
      return decode.call(this);
    };
  });
  const bug=page.getByRole('button',{name:label,exact:true});await bug.click();
  await expect.poll(()=>page.evaluate(()=>typeof(window as any).__rejectPrivateCapture)).toBe('function');
  await logoutAndSignIn(page,bob);
  await expect(page.getByRole('button',{name:'Account menu',exact:true})).toHaveAccessibleDescription(bob.display_name);
  await page.evaluate(()=>(window as any).__rejectPrivateCapture());
  await bug.click();
  await page.getByRole('textbox',{name:'Bug or feature request'}).fill('Bob report must exclude the old capture failure.');
  const sent=page.waitForRequest(request=>request.method()==='POST'&&new URL(request.url()).pathname==='/bug-reports');
  await page.getByRole('button',{name:'Send report',exact:true}).click();
  const submitted=await sent;expect(submitted.headers()['x-user-id']).toBe(bob.id);
  expect(JSON.stringify(submitted.postDataJSON().diagnostics)).not.toContain('alice-private-capture-failure-marker');
  await expect(page.getByText('Thanks! Your report was sent.')).toBeVisible();
});

test('a late report success preserves a newer reopened draft',async({page})=>{
  let respond:(()=>Promise<void>)|undefined;
  await page.route('**/bug-reports',route=>{respond=()=>route.fulfill({status:201,json:{id:'delayed-report',status:'open'}});});
  await page.goto('/portal');
  const bug=page.getByRole('button',{name:label,exact:true});
  const input=page.getByRole('textbox',{name:'Bug or feature request'});
  await bug.click();await input.fill('The first report is still being sent.');
  const finished=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/bug-reports');
  await page.getByRole('button',{name:'Send report',exact:true}).click();
  await expect.poll(()=>Boolean(respond)).toBe(true);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await bug.click();const nextDraft='Keep this newer unsent draft after the earlier report finishes.';
  await input.fill(nextDraft);await respond!();await (await finished).finished();
  await expect(input).toHaveValue(nextDraft);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();await bug.click();
  await expect(input).toHaveValue(nextDraft);
  // A successful send still clears its own unchanged draft.
  respond=undefined;await page.getByRole('button',{name:'Send report',exact:true}).click();
  await expect.poll(()=>Boolean(respond)).toBe(true);await respond!();
  await expect(page.getByText('Thanks! Your report was sent.')).toBeVisible();
  await page.getByRole('button',{name:'Close',exact:true}).click();await bug.click();
  await expect(input).toHaveValue('');
});

test('fast draft edits retain their input and survive closing above the account modal without sending',async({page})=>{
  let sent=0;page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/bug-reports')sent++;});
  await page.goto('/portal');await page.getByRole('button',{name:'Log in',exact:true}).click();
  await page.getByRole('button',{name:label,exact:true}).click();
  const input=page.getByRole('textbox',{name:'Bug or feature request'}),draft='Local smoke draft with quick edits and no lost characters.';
  await expect(input).toBeVisible();await input.click();
  await input.evaluate(node=>{(window as any).__draftInput=node;});
  await input.pressSequentially(draft,{delay:0});await expect(input).toHaveValue(draft);await expect(input).toBeFocused();
  // A surrounding app render must reconcile this same field, not replace it.
  const viewport=page.viewportSize()!;await page.setViewportSize({...viewport,height:viewport.height-40});
  expect(await input.evaluate(node=>(window as any).__draftInput===node)).toBe(true);await expect(input).toHaveValue(draft);
  await page.getByRole('dialog',{name:'Report a bug or feature request',exact:true}).getByRole('button',{name:'Close dialog',exact:true}).click();await expect(input).toHaveCount(0);
  await page.getByRole('button',{name:label,exact:true}).click();await expect(input).toHaveValue(draft);
  await input.click();await input.press('ControlOrMeta+End');await input.pressSequentially(' Still here.',{delay:0});
  await expect(input).toHaveValue(draft+' Still here.');await expect(input).toBeFocused();expect(sent).toBe(0);
});

test('captures before opening, sends real screenshot with recent diagnostics, and remains above modal and focus mode',async({page,request})=>{
  await page.goto('/portal');await page.getByRole('button',{name:'Log in',exact:true}).click();
  const bug=page.getByRole('button',{name:label,exact:true});await expect(bug).toBeVisible();
  // A shared account modal must never cover or disable the always-visible icon.
  await expect.poll(()=>bug.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  const owner=await request.post('/users',{data:{display_name:'Report owner'}});const account=await owner.json();await page.addInitScript(account=>{localStorage.setItem('game-platform.accounts.v1',JSON.stringify([account]));localStorage.setItem('game-platform.current-account.v1',account.id);},account);
  await page.goto('/portal#local');await page.getByRole('button',{name:'Pass and play',exact:true}).click();
  await page.getByRole('button',{name:'Focus mode',exact:true}).click();await expect(page.getByTestId('portal-header')).toHaveCount(0);await expect(bug).toBeVisible();
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
