import {test, expect, Page} from '@playwright/test';

// Native renderer fixtures, not completed-game audit evidence. These exercise
// the same shipped CSS/renderer, without an account or a synthetic move trace.
async function denseBoard(page:Page) {
  await page.goto('/static/declarative-test.html');
  await page.evaluate(async()=>{
    const box=document.createElement('div');box.id='readable-test';
    box.style.cssText='position:fixed;inset:0;z-index:9999;background:#102330';document.body.append(box);
    const spec={format:'buildplay-ui',version:1,viewport:{width:920,height:680},
      boards:[{id:'table',kind:'zone',width:920,height:680}],
      piece_types:{man:{shape:'circle',width:40,height:40,color:'#a7f070'}},
      ui_code:`const gameUI={reduce(m){const e=m.type==='ui_event'?m.event:null;return {scene:{
        pieces:[{id:'near',type:'man',board:'table',position:{x:80,y:100},text:'A',actions:['tap']},
          {id:'far',type:'man',board:'table',position:{x:840,y:600},text:'B',actions:['tap']}],
        targets:[{id:'last',board:'table',position:{x:860,y:620}}],
        labels:[{id:'instructions',x:40,y:40,font_size:20,text:'Keep every piece readable'}],
        controls:[{id:'help',kind:'button',label:'A long translated instruction that must wrap within the visible game panel'}]},
        ...(e?.id==='far'?{make_move:{choose:'far'}}:{})};}};`};
    const w=window as any;w.readableMoves=[];w.readableMessage={type:'state_changed',view:{},state:{},status:'ongoing',players:[{player_index:0}],my_player_index:0,acting_for_player_index:0,turn_of_player_indices:[0],move_count:0};
    w.readableHost=w.DeclarativeUI.mount(box,spec,{onMove:(m:any)=>w.readableMoves.push(m)});
    await w.readableHost.send(w.readableMessage);
  });
}

async function visibleSizes(page:Page) {
  return page.locator('#readable-test').evaluate(box=>{
    const stage=box.querySelector('svg.declarative-stage') as SVGSVGElement;
    const body=box.querySelector('.declarative-piece>g>ellipse')!.getBoundingClientRect();
    const target=box.querySelector('.declarative-target-area')!.getBoundingClientRect();
    const text=box.querySelector('.declarative-piece>g>text') as SVGGraphicsElement;
    const m=text.getScreenCTM()!,font=parseFloat(getComputedStyle(text).fontSize)*Math.hypot(m.a,m.b);
    return {piece:Math.min(body.width,body.height),target:Math.min(target.width,target.height),font,
      viewBox:stage.getAttribute('viewBox'),scrollWidth:box.scrollWidth,width:box.clientWidth};
  });
}

test('dense boards retain readable artwork across resize, zoom, replay and a scaled host',async({page})=>{
  await page.setViewportSize({width:390,height:844});await denseBoard(page);
  for(const size of [{width:390,height:844},{width:844,height:390},{width:820,height:1180},{width:1180,height:820}]){
    await page.setViewportSize(size);
    await expect.poll(async()=>Math.round((await visibleSizes(page)).piece*100)/100).toBeGreaterThanOrEqual(32);
    let sizes=await visibleSizes(page);expect(sizes.target).toBeGreaterThanOrEqual(32-.01);expect(sizes.font).toBeGreaterThanOrEqual(16-.01);
    await page.locator('#readable-test [data-camera-action="in"]').click();
    sizes=await visibleSizes(page);expect(sizes.piece).toBeGreaterThanOrEqual(32);
    const before=sizes.viewBox;
    await page.evaluate(async()=>{const w=window as any;await w.readableHost.send({...w.readableMessage,replay:{index:0,total:2}});});
    expect((await visibleSizes(page)).viewBox).toBe(before);
    for(const piece of await page.locator('#readable-test .declarative-piece').all())await expect(piece).not.toHaveClass(/actionable/);
    await page.evaluate(async()=>{const w=window as any;await w.readableHost.send(w.readableMessage);});
    await page.locator('#readable-test [data-camera-action="reset"]').click();
    await expect(page.locator('#readable-test [data-camera-action="out"]')).toBeDisabled();
    expect((await visibleSizes(page)).scrollWidth).toBeLessThanOrEqual((await visibleSizes(page)).width+1);
  }
  // Ancestor transforms must be accounted for in screen CSS pixels too.
  await page.locator('#readable-test').evaluate(node=>{(node as HTMLElement).style.transform='scale(.5)';});
  await page.evaluate(async()=>{const w=window as any;await w.readableHost.send({...w.readableMessage,move_count:1});});
  await expect.poll(async()=>(await visibleSizes(page)).piece).toBeGreaterThanOrEqual(32-.01);
  expect(await page.evaluate(()=>(window as any).readableMoves)).toEqual([]);
});

test('keyboard camera controls reach the last piece without submitting a move',async({page})=>{
  await page.setViewportSize({width:844,height:390});await denseBoard(page);
  const stage=page.locator('#readable-test .declarative-stage');
  const before=await stage.getAttribute('viewBox');
  await stage.focus();
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowDown');
  expect(await stage.getAttribute('viewBox')).not.toBe(before);
  await page.keyboard.press('End');
  const far=page.locator('#readable-test [data-ui-id="far"]');
  const hit=await far.evaluate(node=>{const r=node.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return Boolean(hit&&node.contains(hit));});
  expect(hit).toBe(true);
  expect(await page.evaluate(()=>(window as any).readableMoves)).toEqual([]);
  await far.click();
  await expect.poll(()=>page.evaluate(()=>(window as any).readableMoves)).toEqual([{choose:'far'}]);
  await test.info().attach('readable-landscape',{body:await page.locator('#readable-test').screenshot(),contentType:'image/png'});
});

test('Neon phone landscape keeps a nonzero main pane before chat',async({page})=>{
  await page.setViewportSize({width:844,height:390});await page.goto('/static/declarative-test.html');
  await page.addStyleTag({url:'/static/portal.css'});await page.addStyleTag({url:'/static/experiments.css'});
  await page.evaluate(()=>{
    document.documentElement.dataset.skin='neon';
    document.body.innerHTML='<header style="height:68px;flex:none">Portal</header><div class="app portal-shell"><main class="work portal-main"><button id="native-board">Native board</button><div style="height:600px;flex:none">Board content</div></main><aside class="community-chat"><h2>Chat Preview</h2></aside></div>';
  });
  const main=page.locator('.portal-main');
  expect((await main.boundingBox())!.height).toBeGreaterThanOrEqual(180);
  await page.locator('#native-board').click();
  const last=main.locator('div');await last.scrollIntoViewIfNeeded();
  expect(await last.isVisible()).toBe(true);
});
