/* No platform cookies, credentials, network, or filesystem access in game frames. */
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const input=JSON.parse(fs.readFileSync(0,'utf8'));
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 const reports=[];
 try {
  const context=await browser.newContext();
  await context.route('**/*',route=>route.abort());
  const sizes=[[360,640],[390,844],[844,390],[820,1180],[1366,768],[1920,1080]];
  for (let index=0;index<input.cases.length;index++) {
   const test=input.cases[index];
   const viewNames=['view_of_mover','view_of_other','expected_view_of_mover','expected_view_of_other'];
   for (let imageIndex=0;imageIndex<4;imageIndex++) {
    const preview=await context.newPage();await preview.setViewportSize({width:400,height:400});
    await preview.setContent('<body style="margin:0"><img style="width:400px;height:400px;object-fit:contain"></body>');
    await preview.locator('img').evaluate((img,svg)=>img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),test.images[imageIndex].svg);
    await preview.locator('img').evaluate(img=>img.decode());
    await preview.screenshot({path:path.join(input.destination,`${index}-approved-${viewNames[imageIndex]}.png`)});await preview.close();
   }
   for (const [width,height] of sizes) for (const direction of ['ltr','rtl']) {
    const page=await context.newPage();
    await page.setViewportSize({width,height});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    for (const [label,view] of Object.entries({view_of_mover:test.view_of_mover,view_of_other:test.view_of_other,expected_view_of_mover:test.expected_view_of_mover,expected_view_of_other:test.expected_view_of_other})) {
     await page.setContent('<style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><iframe sandbox="allow-scripts"></iframe>');
     await page.locator('iframe').evaluate((frame,{code,direction})=>{
      frame.srcdoc=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'"><style>html{direction:${direction}}</style>`+code;
     },{code:input.code,direction});
     const frame=await page.locator('iframe').elementHandle();
     const content=await frame.contentFrame();
     await content.waitForLoadState('load');
     const other=label.includes('other'); const after=label.startsWith('expected');
     const players=test.ctx.players.map((p,i)=>({...p,player_id:p.id,player_index:i,name:p.display_name||p.id}));
     const who=other?test.other_player_id:test.player_id;
     const seat=players.findIndex(p=>p.id===who);
     await page.locator('iframe').evaluate((f,message)=>f.contentWindow.postMessage(message,'*'),{
      type:'state_changed',state:view,view,players,status:after&&test.expected_turn===null?'over':'ongoing',
      my_player_index:seat<0?null:seat,acting_for_player_index:seat<0?null:seat,
      turn_of_player_indices:after?(test.expected_turn||[]).map(id=>players.findIndex(p=>p.id===id)):[players.findIndex(p=>p.id===test.player_id)],
      move_count:test.ctx.move_count+(after?1:0),token_pot:test.ctx.pot
     });
     await page.waitForTimeout(35);
     const findings=await content.evaluate(()=>({
      overflow:document.documentElement.scrollWidth>innerWidth+2,
      tinyTargets:[...document.querySelectorAll('button,input,select,[role=button]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&(r.width<30||r.height<30)}).length,
      blank:!document.body?.innerText.trim()&&!document.querySelector('canvas,svg,img')
     }));
     const filename=`${index}-${width}-${height}-${direction}-${label}.png`;
     await page.screenshot({path:path.join(input.destination,filename)});
     reports.push({test:test.name,width,height,direction,view:label,file:filename,approvedFile:`${index}-approved-${label}.png`,...findings,errors:[...errors]});
     if (findings.overflow||findings.tinyTargets||findings.blank||errors.length) throw new Error('UI verification failed: '+JSON.stringify(reports.at(-1)));
    }
    await page.close();
   }
  }
  process.stdout.write(JSON.stringify(reports));
 } finally {await browser.close();}
})().catch(e=>{process.stderr.write(String(e));process.exitCode=1});
