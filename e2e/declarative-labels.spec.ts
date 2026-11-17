import {test, expect, Page} from '@playwright/test';

async function labelContrasts(page:Page){
  return page.locator('#contrast-test .declarative-target text').evaluateAll(texts=>{
      const rgb=(s:string)=>s.match(/[\d.]+/g)!.slice(0,3).map(Number);
      const luminance=(color:number[])=>color.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      const contrast=(a:number[],b:number[])=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
      return texts.map((text,i)=>{
        const style=getComputedStyle(text),area=getComputedStyle(text.parentElement!.querySelector('rect')!);
        const board=i%2?[7,17,27]:[255,255,255],hintAlpha=Number(area.opacity),paint=rgb(area.fill);
        const background=board.map((n,j)=>n*(1-hintAlpha)+paint[j]*hintAlpha);
        // An opaque halo painted beneath the glyph supplies a stable text
        // background independent of the game palette and selected hint fill.
        const halo=style.stroke!=='none'&&parseFloat(style.strokeWidth)>=2&&style.paintOrder.startsWith('stroke');
        let alpha=1;
        for(let parent:Element|null=text;parent&&parent.id!=='contrast-test';parent=parent.parentElement)alpha*=Number(getComputedStyle(parent).opacity);
        const rendered=(color:number[])=>color.map((n,j)=>n*alpha+background[j]*(1-alpha));
        return contrast(rendered(rgb(style.fill)),halo?rendered(rgb(style.stroke)):background);
      });
    });
}

// A native scene fixture; this is not finished-game or publication evidence.
test('location labels retain contrast over light and dark boards and hints', async({page})=>{
  await page.goto('/static/declarative-test.html');
  await page.evaluate(async()=>{
    const box=document.createElement('div');box.id='contrast-test';
    box.style.cssText='position:fixed;inset:0;z-index:9999;background:#102330';document.body.append(box);
    const spec={format:'buildplay-ui',version:1,viewport:{width:420,height:300},
      boards:[{id:'table',kind:'grid',width:420,height:240,rows:2,columns:3,color:'#fff',alternate_color:'#07111b'}],
      piece_types:{},ui_code:`const gameUI={reduce(m){return {scene:{targets:
        ['Choose','اختيار','选择','Choose','اختيار','选择'].map((label,i)=>({id:String(i),board:'table',position:{cell:String(i)},label}))},
        ...(m.type==='ui_event'?{make_move:{choose:m.event.id}}:{})};}};`};
    const w=window as any;w.contrastMoves=[];
    w.contrastMessage={type:'state_changed',view:{},status:'ongoing',players:[{player_index:0}],my_player_index:0,acting_for_player_index:0,turn_of_player_indices:[0],move_count:0};
    w.contrastHost=w.DeclarativeUI.mount(box,spec,{onMove:(m:any)=>w.contrastMoves.push(m)});
    await w.contrastHost.send(w.contrastMessage);
  });
  for(const size of [{width:390,height:844},{width:844,height:390},{width:820,height:1180},{width:1180,height:820}]){
    await page.setViewportSize(size);
    const host=page.locator('#contrast-test');
    if(await host.locator('[data-camera-action="reset"]').isEnabled())await host.locator('[data-camera-action="reset"]').click();
    const font=()=>host.locator('.declarative-target text').first().evaluate(t=>{
      const m=(t as SVGGraphicsElement).getScreenCTM()!;
      return parseFloat(getComputedStyle(t).fontSize)*Math.hypot(m.a,m.b);
    });
    // Start with the full-board overview, then use the host's magnification
    // controls when location labels need a closer view on a small screen.
    for(let i=0;await font()<16-.01&&i<8;i++)await host.locator('[data-camera-action="in"]').click();
    expect(await font()).toBeGreaterThanOrEqual(16-.01);
    const ratios=await labelContrasts(page);
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
    if(size.width===390||size.width===844){
      // After user magnification, native camera controls still expose the
      // complete first and last labels, including their halo.
      const stage=page.locator('#contrast-test .declarative-stage');
      await stage.focus();await stage.press('Home');
      const first=await page.locator('#contrast-test [data-ui-id="0"] text').boundingBox();
      const canvas=await stage.boundingBox();
      expect(first!.x).toBeGreaterThanOrEqual(canvas!.x+2);
      const path=test.info().outputPath(`location-labels-${size.width}x${size.height}.png`);
      await page.locator('#contrast-test').screenshot({path});
      await test.info().attach('light-dark-location-labels',{path,contentType:'image/png'});
      await stage.press('End');
      const last=await page.locator('#contrast-test [data-ui-id="5"] text').boundingBox();
      expect(last!.x+last!.width).toBeLessThanOrEqual(canvas!.x+canvas!.width-2);
    }
  }
  const first=page.locator('#contrast-test [data-ui-id="0"]');
  await first.focus();await first.press('Enter');
  await expect.poll(()=>page.evaluate(()=>(window as any).contrastMoves)).toEqual([{choose:'0'}]);
  await page.evaluate(async()=>{const w=window as any;await w.contrastHost.send({...w.contrastMessage,replay:{index:0,total:1}});});
  expect(Math.min(...await labelContrasts(page))).toBeGreaterThanOrEqual(4.5);
  for(const target of await page.locator('#contrast-test .declarative-target').all())await expect(target).toHaveAttribute('aria-disabled','true');
});
