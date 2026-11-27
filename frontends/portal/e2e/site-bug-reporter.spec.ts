import {test,expect} from '@playwright/test';

const label='Report a bug or request a feature';
const fixture=(admin=true,extra='')=>`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/static/shared/device-storage.js?v=1"></script><link rel="stylesheet" href="/static/site-bug-report.css"><script src="/static/site-bug-report.js" data-admin="${admin}"></script>${extra}</head><body style="margin:0;background:#10141f;color:white;font:16px sans-serif"><main style="padding:28px"><h1>Standalone page</h1><p>Page diagnostics and reporting fixture</p><div style="height:160px;background:rgb(255,0,255)"></div><input type="password" value="private-input-secret" aria-label="Fixture password"></main></body></html>`;

test.beforeEach(async({page,baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Requires a disposable loopback server.');
  await page.route('**/site-bug-fixture',route=>route.fulfill({contentType:'text/html',body:fixture()}));
});

test('standalone bug icon captures a real screenshot and sends redacted diagnostics with no stale portal identity',async({page,isMobile},testInfo)=>{
  const sent:any[]=[];
  await page.route('**/bug-reports',route=>{sent.push({body:route.request().postDataJSON(),headers:route.request().headers()});return route.fulfill({status:201,json:{id:'standalone-manual'}});});
  await page.addInitScript(()=>{
    localStorage.setItem('game-platform.accounts.v1',JSON.stringify([{id:'old-portal-account',password:'private-old-account-password'}]));
    localStorage.setItem('game-platform.current-account.v1','old-portal-account');
  });
  await page.goto('/site-bug-fixture');
  await page.evaluate(async()=>{
    (window as any).SiteBugReporter.rememberSecrets(['private-google-token']);
    console.info('Site recorder marker password=private-log-password private-input-secret private-google-token private-old-account-password');
    await fetch('/health?token=private-query-token');
  });
  const bug=page.getByRole('button',{name:label,exact:true});
  await expect(bug).toBeVisible();
  await expect(bug.locator('svg rect')).toHaveAttribute('stroke','#c6f432');
  if(isMobile)await bug.tap();else await bug.click();
  const input=page.getByRole('textbox',{name:'Bug or feature request',exact:true});
  await expect(input).toBeVisible();
  const image=page.getByRole('img',{name:'Screenshot captured before opening this report',exact:true});
  const screenshot=await image.getAttribute('src');
  expect(screenshot).toMatch(/^data:image\/jpeg;base64,/);expect(screenshot!.length).toBeLessThanOrEqual(500000);
  const pixels=await image.evaluate(async node=>{const image=node as HTMLImageElement;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);return [...ctx.getImageData(50,180,1,1).data];});
  expect(pixels[0]).toBeGreaterThan(230);expect(pixels[1]).toBeLessThan(25);expect(pixels[2]).toBeGreaterThan(230);
  await page.screenshot({path:testInfo.outputPath('site-bug-manual.png')});
  await input.fill('The standalone page needs a clearer navigation label.');
  await page.getByRole('button',{name:'Send report',exact:true}).click();
  await expect(page.getByText('Thanks! Your report was sent.',{exact:true})).toBeVisible();
  const report=sent.find(row=>!row.body.automatic);
  expect(report.headers['x-user-id']).toBeUndefined();expect(report.headers['x-user-password']).toBeUndefined();
  expect(report.body.screenshot).toBe(screenshot);expect(report.body.automatic).toBe(false);
  expect(report.body.diagnostics.context.adminPage).toBe(true);
  expect(report.body.diagnostics.apiCalls.some((call:any)=>call.path==='/health'&&call.status===200)).toBe(true);
  const diagnostics=JSON.stringify(report.body.diagnostics);
  expect(diagnostics).toContain('Site recorder marker');
  for(const secret of ['private-input-secret','private-google-token','private-old-account-password','private-query-token','private-log-password'])expect(diagnostics).not.toContain(secret);
});

test('unexpected errors submit silent bounded automatic reports with no screenshot or reporting recursion',async({page})=>{
  const sent:any[]=[],telemetry:any[]=[];
  await page.route('**/bug-reports',route=>{sent.push(route.request().postDataJSON());return route.fulfill({status:503,json:{detail:'Unavailable'}});});
  await page.route('**/client-errors',route=>{telemetry.push(route.request().postDataJSON());return route.fulfill({json:{}});});
  await page.goto('/site-bug-fixture');
  await page.evaluate(()=>{
    (window as any).__captureCount=0;
    (window as any).SiteBugReporter.registerCapture(()=>{(window as any).__captureCount++;return Promise.reject(new Error('Must not capture automatically'));});
    const emit=(message:string)=>window.dispatchEvent(new ErrorEvent('error',{message,error:new Error(message),filename:'https://example.test/page.js?token=private-resource-token'}));
    emit('Automatic marker password=private-auto-password');emit('Automatic marker password=private-auto-password');
  });
  await page.evaluate(()=>{void Promise.reject(new Error('Rejected promise automatic marker'));});
  await expect.poll(()=>sent.length).toBe(2);
  await page.evaluate(()=>{for(let i=0;i<8;i++)window.dispatchEvent(new ErrorEvent('error',{message:`Distinct automatic marker ${i}`}));});
  await expect.poll(()=>sent.length).toBe(5);await expect.poll(()=>telemetry.length).toBe(5);
  expect(sent.every(row=>row.automatic===true&&row.screenshot===null)).toBe(true);
  expect(sent.filter(row=>row.text.includes('Automatic marker'))).toHaveLength(1);
  expect(sent[0].diagnostics.automatic_error.kind).toBe('script_error');
  expect(sent.some(row=>row.diagnostics.automatic_error.kind==='unhandled_rejection')).toBe(true);
  expect(JSON.stringify(sent)).not.toContain('private-auto-password');expect(JSON.stringify(sent)).not.toContain('private-resource-token');
  expect(await page.evaluate(()=>(window as any).__captureCount)).toBe(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('#page-error')).toHaveCount(0);
  // Failed automatic uploads must not produce further reports or visible errors.
  await page.waitForTimeout(200);expect(sent).toHaveLength(5);
});

test('standalone automatic diagnostics retain recent traces within 100 KB', async ({page}) => {
  await page.route('**/bug-reports', route => route.fulfill({status: 201, json: {id: 'bounded-report'}}));
  await page.goto('/site-bug-fixture');
  const posted = page.waitForRequest(request =>
    request.method() === 'POST' && new URL(request.url()).pathname === '/bug-reports');
  await page.evaluate(() => {
    const reporter = (window as any).SiteBugReporter;
    reporter.recordLog('warn', 'old marker');
    for (let i = 0; i < 70; i++) reporter.recordEvent('drag_performance', {i, marker: '\u0001'.repeat(700)});
    reporter.reportIssue('script_error', new Error('Latest automatic error'));
  });
  const {diagnostics} = (await posted).postDataJSON();
  expect(Buffer.byteLength(JSON.stringify(diagnostics))).toBeLessThanOrEqual(100_000);
  expect(diagnostics.automatic_error.message).toBe('Latest automatic error');
  expect(diagnostics.logs.map((entry: {message: string}) => entry.message)).not.toContain('old marker');
  expect(diagnostics.events.at(-1).details.i).toBe(69);
});

test('same-origin embedded pages forward their errors and show one parent icon; a Portal handoff stops standalone reports',async({page})=>{
  const sent:any[]=[];
  await page.route('**/bug-reports',route=>{sent.push(route.request().postDataJSON());return route.fulfill({status:201,json:{id:'frame-automatic'}});});
  await page.route('**/site-bug-child',route=>route.fulfill({contentType:'text/html',body:fixture(true,'<script>throw new Error("Embedded page exception marker")</script>')}));
  await page.goto('/site-bug-fixture');
  await page.evaluate(()=>{const frame=document.createElement('iframe');frame.src='/site-bug-child';document.body.append(frame);});
  await expect.poll(()=>sent.length).toBe(1);
  expect(sent[0].automatic).toBe(true);expect(sent[0].diagnostics.context.frame.context.path).toBe('/site-bug-child');
  expect(await page.frameLocator('iframe').getByTestId('bug-report-button').count()).toBe(0);
  await expect(page.getByTestId('bug-report-button')).toHaveCount(1);
  await page.evaluate(()=>{
    // A message from this window is not a trusted child-frame message.
    window.postMessage({type:'buildplay-site-client-error-v1',error:{kind:'script_error',message:'Spoofed frame message'}},location.origin);
    const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');
    frame.srcdoc='<script>parent.postMessage({type:"buildplay-site-client-error-v1",error:{kind:"script_error",message:"Untrusted origin message"}},"*")</script>';
    document.body.append(frame);
  });
  await page.waitForTimeout(200);expect(sent).toHaveLength(1);
  await page.evaluate(()=>{
    (window as any).SiteBugReporter.claimPortal();
    window.dispatchEvent(new ErrorEvent('error',{message:'Portal now owns this error'}));
  });
  await expect(page.getByTestId('bug-report-button')).toHaveCount(0);
  await page.waitForTimeout(200);expect(sent).toHaveLength(1);
});

test('manual report drafts survive capture and upload failures while the icon remains above a browser modal',async({page})=>{
  await page.addInitScript(()=>{Reflect.deleteProperty(Array.prototype,'at');});
  let requests=0;
  await page.route('**/bug-reports',route=>++requests===1?route.fulfill({status:503,json:{detail:'Temporary failure'}}):route.fulfill({status:201,json:{id:'manual-retry'}}));
  await page.goto('/site-bug-fixture');
  await page.evaluate(()=>{
    (window as any).SiteBugReporter.registerCapture(()=>Promise.reject(new Error('Capture unavailable for this device')));
    const modal=document.createElement('dialog');modal.id='blocking-modal';modal.textContent='Another browser modal';document.body.append(modal);modal.showModal();
  });
  const bug=page.getByRole('button',{name:label,exact:true});
  await expect.poll(()=>bug.evaluate(node=>{const box=node.getBoundingClientRect();return node.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));})).toBe(true);
  await bug.click();
  await expect(page.getByText('Screenshot unavailable. You can still send the report.',{exact:true})).toBeVisible();
  const input=page.getByRole('textbox',{name:'Bug or feature request',exact:true});
  await input.fill('Keep my standalone report while submission is unavailable.');
  await page.getByRole('button',{name:'Send report',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Your text is saved here');
  await expect(input).toHaveValue('Keep my standalone report while submission is unavailable.');
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();await bug.click();
  await expect(input).toHaveValue('Keep my standalone report while submission is unavailable.');
  await page.getByRole('button',{name:'Send report',exact:true}).click();
  await expect(page.getByText('Thanks! Your report was sent.',{exact:true})).toBeVisible();
});

for(const unavailable of ['invalid cached locales','unavailable locale script']){
  test(`admin sign-in can initialize with ${unavailable}`,async({page})=>{
    await page.addInitScript(invalidCache=>{
      if(invalidCache)localStorage.setItem('game-platform.i18n-locales.v1',JSON.stringify({locale:'en'}));
      Object.assign(window,{google:{accounts:{id:{
        initialize(){},
        renderButton(container: HTMLElement){
          const button=document.createElement('button');
          button.textContent='Test Google sign-in';
          container.append(button);
        },
      }}}});
    },unavailable==='invalid cached locales');
    if(unavailable==='unavailable locale script')await page.route('**/static/i18n.js?*',route=>route.abort());
    await page.route('**/auth/config',route=>route.fulfill({json:{google_client_id:'synthetic-client'}}));
    await page.route('**/auth/admin-session',route=>route.fulfill({json:{signed_in:false}}));
    await page.goto('/admin/login');
    await expect(page.getByRole('button',{name:'Test Google sign-in'})).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Sign in with Google to continue.');
  });
}
