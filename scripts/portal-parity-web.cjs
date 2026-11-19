#!/usr/bin/env node
/* Actual browser audit of the shared app; fixture storage only, no API writes. */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {chromium,expect}=require('@playwright/test');

const fixturePath=path.resolve(process.argv[2]||'tests/fixtures/portal-parity/common.json');
const output=path.resolve(process.argv[3]||'/tmp/buildplay-parity-600/web');
const base=new URL(process.argv[4]||'http://127.0.0.1:8128').origin;
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Parity audit requires a disposable loopback server');
const fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
const requestedViewport=process.env.PORTAL_PARITY_VIEWPORT;
if(requestedViewport&&!/^\d{3,4}x\d{3,4}$/.test(requestedViewport))throw Error('PORTAL_PARITY_VIEWPORT must be WIDTHxHEIGHT');
const viewport=requestedViewport?Object.fromEntries(requestedViewport.split('x').map((value,index)=>[index?'height':'width',Number(value)])):fixture.viewport;
if(viewport.width<300||viewport.width>4096||viewport.height<300||viewport.height>4096)throw Error('Parity viewport is outside the supported audit range');
const touch=viewport.width<800;
const key=`buildplay.shared.v1.${encodeURIComponent(base)}.visitor`;
const canonical=value=>JSON.stringify(value,(_key,child)=>child&&typeof child==='object'&&!Array.isArray(child)?Object.fromEntries(Object.entries(child).sort(([a],[b])=>a.localeCompare(b))):child);
const digest=value=>crypto.createHash('sha256').update(canonical(value)).digest('hex');
const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function main(){
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true});
  const summary={sourceSha:fixture.sourceSha,fixtureSha256:crypto.createHash('sha256').update(fs.readFileSync(fixturePath)).digest('hex'),viewport,input:touch?'touch':'mouse',platform:'web',startedAt:new Date().toISOString(),pages:[],games:[],network:[]};
  let active;
  async function session(){
    const context=await browser.newContext({viewport,deviceScaleFactor:1,isMobile:touch,hasTouch:touch,serviceWorkers:'block',reducedMotion:'no-preference'});
    const page=await context.newPage();active=page;
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(request.method()!=='GET'||url.origin!==base){summary.network.push({method:request.method(),url:request.url(),action:'blocked'});return route.abort('blockedbyclient');}
      const endpoint=url.pathname+url.search;
      if(url.pathname==='/storage/capabilities')return route.fulfill({json:{pagination:false}});
      if(url.pathname==='/i18n/locales')return route.fulfill({json:{locales:[{code:'en',name:'English',native_name:'English',direction:'ltr'}]}});
      if(url.pathname==='/i18n/bundle/en')return route.fulfill({json:{catalog:{messages:{},direction:'ltr'},games:{}}});
      if(Object.hasOwn(fixture.accountData.responses,endpoint))return route.fulfill({json:fixture.accountData.responses[endpoint]});
      if(!['/portal','/health','/portal-worker.js','/'].includes(url.pathname)&&!url.pathname.startsWith('/static/')){
        summary.network.push({method:'GET',url:request.url(),action:'fixture-miss'});return route.fulfill({status:404,json:{detail:'Parity fixture has no response for this path'}});
      }
      return route.continue();
    });
    await page.addInitScript(({storage,data,key})=>{
      if(window!==window.top)return;
      if(localStorage.getItem(key)===null){
        localStorage.clear();
        for(const [name,value]of Object.entries(storage))if(name!=='buildplay.shared.v1.visitor')localStorage.setItem(name,value);
        localStorage.setItem(key,JSON.stringify(data));localStorage.setItem('game-platform.accounts.v1','[]');localStorage.setItem('game-platform.current-account.v1','visitor');localStorage.setItem('game-platform.locale.v1','en');localStorage.setItem('buildplay.navigation.v2','top');
      }
      Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});
      window.__portalParity={scenes:[],painted:[],paintSequence:0};
      addEventListener('message',event=>{
        try{const parsed=JSON.parse(event.data?.result?.result);if(parsed?.scene){window.__portalParity.scenes.push({at:performance.now(),scene:parsed.scene});if(window.__portalParity.scenes.length>300)window.__portalParity.scenes.shift();}}
        catch{/* Non-presentation messages include the separate rules runtime. */}
      });
      addEventListener('DOMContentLoaded',()=>{
        let pending=false;
        new MutationObserver(()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;const svg=document.querySelector('[data-testid="game-stage"] svg');if(svg){const signature=[...svg.querySelectorAll('[aria-label]')].map(node=>node.getAttribute('aria-label')+':'+node.getAttribute('aria-disabled')).join('|')+'~'+svg.textContent;const all=window.__portalParity.painted;if(all.at(-1)?.signature!==signature)all.push({at:performance.now(),sequence:++window.__portalParity.paintSequence,signature,svg:svg.outerHTML});if(all.length>120)all.shift();}});}).observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
      });
    },{storage:fixture.storage,data:fixture.accountData,key});
    await page.goto(base+'/portal',{waitUntil:'domcontentloaded'});
    const version=await (await page.request.get(base+'/static/app/version.json')).json();assert.equal(version.commit,fixture.sourceSha,'The web export must match the audited source');
    await expect(page.getByRole('button',{name:'Log in',exact:true}).first()).toBeEnabled({timeout:20000});
    await expect(page.getByRole('button',{name:'Navigation menu',exact:true})).toHaveCount(0);
    return {context,page,errors};
  }
  async function details(page){
    return page.evaluate(()=>{
      const box=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
      const stage=document.querySelector('[data-testid="game-stage"]'),svg=stage?.querySelector('svg');
      const nodes=[...(svg?.querySelectorAll('[aria-label],circle,rect,image,text')||[])].slice(0,500).map(node=>({tag:node.tagName,label:node.getAttribute('aria-label'),role:node.getAttribute('role'),disabled:node.getAttribute('aria-disabled'),bbox:box(node),text:node.tagName.toLowerCase()==='text'?node.textContent:undefined,font:node.tagName.toLowerCase()==='text'?{family:getComputedStyle(node).fontFamily,size:getComputedStyle(node).fontSize,weight:getComputedStyle(node).fontWeight}:undefined,attrs:Object.fromEntries([...node.attributes].filter(a=>['x','y','cx','cy','r','width','height','viewBox','transform','alignment-baseline','text-anchor'].includes(a.name)).map(a=>[a.name,a.value]))}));
      const boundary=svg?box(svg):null;
      const clippedText=boundary?nodes.filter(node=>node.text&&node.bbox.width>0&&(node.bbox.x<boundary.x-1||node.bbox.y<boundary.y-1||node.bbox.x+node.bbox.width>boundary.x+boundary.width+1||node.bbox.y+node.bbox.height>boundary.y+boundary.height+1)).map(node=>({...node,overflow:{left:Math.max(0,boundary.x-node.bbox.x),top:Math.max(0,boundary.y-node.bbox.y),right:Math.max(0,node.bbox.x+node.bbox.width-boundary.x-boundary.width),bottom:Math.max(0,node.bbox.y+node.bbox.height-boundary.y-boundary.height)}})):[];
      const heading=document.querySelector('[role="heading"]');
      return {viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},uiFont:heading?getComputedStyle(heading).fontFamily:null,pageHasHorizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,stage:stage?box(stage):null,svg:svg?{bbox:boundary,viewBox:svg.getAttribute('viewBox'),overflow:getComputedStyle(svg).overflow,markup:svg.outerHTML}:null,nodes,clippedText,scenes:window.__portalParity.scenes,painted:window.__portalParity.painted};
    });
  }
  async function capture(page,name){
    await page.screenshot({path:path.join(output,name+'.png')});
    fs.writeFileSync(path.join(output,name+'.a11y.yml'),await page.locator('body').ariaSnapshot());
    const geometry=await details(page);save(name+'.geometry.json',geometry);return geometry;
  }
  async function storedMatch(page,id){return page.evaluate(({key,id})=>JSON.parse(localStorage.getItem(key)).local[id],{key,id});}
  async function settled(page,game,expected,scene,name){
    await expect.poll(async()=>canonical(await storedMatch(page,game.matchId)),{timeout:30000,message:`${name} durable state`}).toBe(canonical(expected));
    await expect.poll(async()=>{const last=await page.evaluate(()=>window.__portalParity.scenes.at(-1)?.scene);return last?digest(last):null;},{timeout:30000,message:`${name} final presentation scene`}).toBe(digest(scene));
    if(expected.status==='ongoing')await expect.poll(()=>page.getByTestId('game-stage').locator('[role="button"][aria-disabled="false"]').count(),{timeout:30000,message:`${name} motion settles and actions become available`}).toBeGreaterThan(0);
    const spec=fixture.accountData.responses[`/games/${game.gameId}/versions/${game.gameVersion}`].declarative_ui;
    const motion=Math.max(spec.motion?.move_ms??1440,...(scene.pieces||[]).map(p=>(p.animation?.duration_ms||0)+(p.animation?.delay_ms||0)))+(spec.motion?.roll_settle_ms??0)+(spec.motion?.turn_pause_ms??0);
    await delay(Math.min(10000,motion+250));
    const stage=page.getByTestId('game-stage');await stage.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,name+'.png')});await stage.screenshot({path:path.join(output,name+'-board.png')});
    fs.writeFileSync(path.join(output,name+'.a11y.yml'),await page.locator('body').ariaSnapshot());
    const geometry=await details(page);save(name+'.geometry.json',geometry);save(name+'-match.json',await storedMatch(page,game.matchId));save(name+'-scene.json',geometry.scenes.at(-1).scene);
    assert.equal(digest(geometry.scenes.at(-1).scene),digest(scene));
    assert.equal(geometry.pageHasHorizontalOverflow,false);
    return {name,moveCount:expected.move_count,matchSha256:digest(expected),sceneSha256:digest(scene),board:geometry.svg?.bbox,actualSceneCount:geometry.scenes.length,actualPaintedFrames:geometry.painted.length,svgFonts:[...new Set(geometry.nodes.filter(node=>node.font).map(node=>node.font.family))],clippedText:geometry.clippedText};
  }
  try{
    const {context,page,errors}=await session();
    for(const [slug,label]of [['catalog','Games'],['matches','Matches'],['local','On this device']]){
      await page.getByRole('button',{name:label,exact:true}).click();await delay(150);
      await capture(page,'page-'+slug);summary.pages.push({name:slug,errorCount:errors.length});
    }
    await page.getByRole('button',{name:'Preferences',exact:true}).first().click();await expect(page.getByRole('heading',{name:'Preferences',exact:true})).toBeVisible();await capture(page,'page-preferences');summary.pages.push({name:'preferences',errorCount:errors.length});
    await page.getByRole('button',{name:'Log in',exact:true}).first().click();await expect(page.getByRole('button',{name:'Close dialog',exact:true})).toBeVisible();await capture(page,'page-account');summary.pages.push({name:'account',errorCount:errors.length});
    assert.deepEqual(errors,[]);await context.close();
    for(const game of fixture.games){
      const {context,page,errors}=await session();
      await page.goto(base+'/portal#match='+encodeURIComponent(game.matchId),{waitUntil:'domcontentloaded'});
      await expect(page.getByTestId('game-stage')).toBeVisible({timeout:20000});
      const focus=page.getByRole('button',{name:'Focus mode',exact:true});if(await focus.count())await focus.click();
      const result={slug:game.slug,name:game.name,gameId:game.gameId,gameVersion:game.gameVersion,initial:await settled(page,game,game.initial,game.initialScene,game.slug+'-initial'),steps:[]};
      for(const step of game.steps){
        const sceneStart=await page.evaluate(()=>window.__portalParity.scenes.length),paintStart=await page.evaluate(()=>window.__portalParity.paintSequence);
        for(const action of step.uiActions){const button=page.getByRole('button',{name:action.label,exact:true});if(touch)await button.tap();else await button.click();}
        const record=await settled(page,game,step.expectedMatch,step.scene,game.slug+'-step'+step.number);
        const frames=await page.evaluate(({sceneStart,paintStart})=>({scenes:window.__portalParity.scenes.slice(sceneStart),painted:window.__portalParity.painted.filter(frame=>frame.sequence>paintStart)}),{sceneStart,paintStart});
        save(game.slug+'-step'+step.number+'.playback.json',frames);
        record.humanMove=step.humanMove;record.uiActions=step.uiActions;record.intermediateSceneHashes=[...new Set(frames.scenes.map(frame=>digest(frame.scene)))];record.paintedFrameCount=frames.painted.length;result.steps.push(record);
        console.log(JSON.stringify({game:game.slug,step:step.number,moveCount:record.moveCount,scenes:frames.scenes.length,paintedFrames:frames.painted.length}));
      }
      const final=game.steps.at(-1);await page.reload({waitUntil:'domcontentloaded'});
      await expect(page.getByTestId('game-stage')).toBeVisible({timeout:20000});
      const restartFocus=page.getByRole('button',{name:'Focus mode',exact:true});if(await restartFocus.count())await restartFocus.click();
      result.restart=await settled(page,game,final.expectedMatch,final.scene,game.slug+'-restart');
      console.log(JSON.stringify({game:game.slug,restart:true,moveCount:result.restart.moveCount}));
      assert.deepEqual(errors,[]);result.pageErrors=errors;summary.games.push(result);save('summary.json',summary);await context.close();
    }
    // Separate real creation flow; its natural seed/date are deliberately not
    // compared against the deterministic resumed-match fixtures.
    const actual=await session();await actual.page.getByRole('link',{name:`Play ${fixture.games[0].name}`,exact:true}).click();
    await actual.page.getByRole('button',{name:'Your seat against computers: Player 2',exact:true}).click();
    await actual.page.getByRole('button',{name:'Practice with computers',exact:true}).click();
    const fresh=()=>actual.page.evaluate(key=>Object.values(JSON.parse(localStorage.getItem(key)).local).find(match=>!match.id.startsWith('local-parity-')),key);
    await expect.poll(async()=>(await fresh())?.move_count,{timeout:30000}).toBe(1);
    const cells=actual.page.getByTestId('game-stage').locator('[role="button"][aria-label^="Cell "][aria-disabled="false"]');
    await expect(cells.first()).toBeVisible({timeout:20000});await capture(actual.page,'created-practice-opening');save('created-practice-opening-match.json',await fresh());
    if(touch)await cells.first().tap();else await cells.first().click();await expect.poll(async()=>(await fresh())?.move_count,{timeout:30000}).toBe(3);
    await delay(2000);await capture(actual.page,'created-practice');
    summary.createdPractice=await actual.page.evaluate(key=>Object.values(JSON.parse(localStorage.getItem(key)).local).find(match=>!match.id.startsWith('local-parity-')),key);
    assert.equal(summary.createdPractice.players.filter(p=>p.kind==='human').length,1);assert.equal(summary.createdPractice.players.filter(p=>p.kind==='computer').length,1);assert.equal(summary.createdPractice.players[1].kind,'human');assert.equal(summary.createdPractice.last_move_player_index,0);assert.deepEqual(summary.createdPractice.turn_of_player_indices,[1]);assert.deepEqual(actual.errors,[]);save('created-practice-match.json',summary.createdPractice);await actual.context.close();
    const findings=[];
    const serif=summary.games.filter(game=>game.initial.svgFonts.some(font=>font.includes('Times'))).map(game=>game.slug);
    if(serif.length)findings.push({title:'SVG text uses the browser serif default',kind:'cosmetic-platform-difference',games:serif,description:'Computed SVG text font is Times New Roman while the app UI uses the system sans-serif stack. Native screenshots use their platform sans-serif default.'});
    for(const game of summary.games){const clipping=game.steps.flatMap(step=>(step.clippedText||[]).map(item=>({stage:step.name,...item})));if(clipping.length)findings.push({title:`${game.name}: text exceeds the canvas`,kind:'visual-clipping',game:game.slug,description:'Text extends outside the actual SVG viewport at the fitted 100% camera. State and scene checks pass; inspect the measured overflow and screenshots.',examples:clipping});}
    summary.assertionsScope='Actual touch gameplay, exact saved matches and final reducer scenes; visual findings are recorded separately and are not considered a clean visual pass.';
    summary.visualFindings=findings;save('visual-findings.json',{sourceSha:fixture.sourceSha,findings});
    summary.finishedAt=new Date().toISOString();summary.result='passed';save('summary.json',summary);fs.rmSync(path.join(output,'failure.png'),{force:true});console.log(JSON.stringify({result:'passed',output,games:summary.games.length,pages:summary.pages.length,visualFindings:findings.length}));
  }catch(error){summary.result='failed';summary.error=error.stack||String(error);save('summary.json',summary);if(active&&!active.isClosed())await active.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
  finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
