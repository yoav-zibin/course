import {test,expect} from '@playwright/test';

test('image targets accept direct placement taps while selected drops and read-only guards stay intact',async({page},testInfo)=>{
  await page.goto('/static/declarative-test.html');
  await page.evaluate(async()=>{
    const box=document.createElement('div');box.id='asset-target-test';
    box.style.cssText='position:fixed;inset:0;z-index:9999;background:#102330';document.body.append(box);
    const spec={format:'buildplay-ui',version:1,viewport:{width:350,height:320},
      boards:[{id:'table',kind:'zone',x:10,y:10,width:330,height:300}],
      piece_types:{token:{shape:'circle',width:44,height:44,color:'#ffcf35'}},
      assets:{arrow:{uri:'data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><path d="M4 8H40L22 36Z" fill="#ffffff"/></svg>'),media_type:'image/svg+xml'}},
      ui_code:`const gameUI={reduce(message,local){
        const m=message.type==='ui_event'?message.state_changed:message;
        const scene={pieces:[
          {id:'disc',type:'token',board:'table',position:{x:45,y:140},actions:['move'],move_targets:['wide']},
          {id:'overlap',type:'token',board:'table',position:{x:150,y:140},actions:['move'],move_targets:['default']},
          {id:'passive',type:'token',board:'table',position:{x:150,y:80},actions:[]}],targets:[
          {id:'wide',board:'table',position:{x:150,y:140},asset:'arrow',label:'Wide destination',hit_area:{x:-45,y:-90,width:90,height:180}},
          {id:'default',board:'table',position:{x:270,y:140},asset:'arrow',label:'Default destination'}]};
        const event=message.event,active=m.status==='ongoing'&&m.acting_for_player_index!=null&&!m.replay;
        return {scene,...(active&&event&&['tap','drop'].includes(event.type)&&['wide','default'].includes(event.target_id||event.id)?{make_move:{kind:event.type,target:event.target_id||event.id}}:{})};
      }};`};
    const w=window as any;w.assetTargetMoves=[];
    w.assetTargetMessage={type:'state_changed',view:{},status:'ongoing',my_player_index:0,acting_for_player_index:0,move_count:0};
    w.assetTargetHost=w.DeclarativeUI.mount(box,spec,{onMove:(move:any)=>w.assetTargetMoves.push(move)});
    await w.assetTargetHost.send(w.assetTargetMessage);
  });
  const wide=page.locator('#asset-target-test [data-ui-id="wide"]');
  const ordinary=page.locator('#asset-target-test [data-ui-id="default"]');
  const disc=page.locator('#asset-target-test [data-ui-id="disc"]');
  const overlap=page.locator('#asset-target-test [data-ui-id="overlap"]');
  const moves=()=>page.evaluate(()=>(window as any).assetTargetMoves);
  const reset=async(count:number,extra:any={})=>page.evaluate(async({count,extra})=>{
    const w=window as any;await w.assetTargetHost.send({...w.assetTargetMessage,move_count:count,...extra});
  },{count,extra});
  const tapAt=async(x:number,y:number)=>{
    if(testInfo.project.use.hasTouch)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
  };
  const tapTarget=async(target:any,edge=false)=>{
    const bounds=(await target.locator('.declarative-target-hit').boundingBox())!;
    await tapAt(edge?bounds.x+4:bounds.x+bounds.width/2,edge?bounds.y+4:bounds.y+bounds.height/2);
  };
  await expect(wide).toHaveAttribute('data-drop-state','placement');
  // Tap outside the arrow's painted triangle, inside the declared hit area.
  await tapTarget(wide,true);
  await expect.poll(moves).toEqual([{kind:'tap',target:'wide'}]);
  await expect(wide).toHaveAttribute('data-drop-state','inactive');
  await tapTarget(ordinary);expect(await moves()).toHaveLength(1);

  await reset(1);
  const passive=(await page.locator('#asset-target-test [data-ui-id="passive"]').boundingBox())!;
  await tapAt(passive.x+passive.width/2,passive.y+passive.height/2);
  await expect.poll(moves).toEqual([{kind:'tap',target:'wide'},{kind:'tap',target:'wide'}]);
  await reset(2);await tapTarget(ordinary);
  await expect.poll(moves).toHaveLength(3);
  await reset(3);await ordinary.focus();await page.keyboard.press('Enter');
  await expect.poll(moves).toHaveLength(4);

  await reset(4);await disc.focus();await page.keyboard.press('Enter');
  await expect(wide).toHaveAttribute('data-drop-state','allowed');
  await expect(ordinary).toHaveAttribute('data-drop-state','unavailable');
  await tapTarget(ordinary);expect(await moves()).toHaveLength(4);
  await disc.focus();await page.keyboard.press("Escape");await page.keyboard.press("Enter");
  await expect(wide).toHaveAttribute("data-drop-state","allowed");
  await tapTarget(wide,true);
  await expect.poll(moves).toHaveLength(5);
  expect((await moves())[4]).toEqual({kind:'drop',target:'wide'});

  await reset(5);
  const source=(await disc.boundingBox())!,destination=(await wide.locator('.declarative-target-hit').boundingBox())!;
  await page.mouse.move(source.x+source.width/2,source.y+source.height/2);await page.mouse.down();
  await page.mouse.move(destination.x+4,destination.y+4,{steps:8});await page.mouse.up();
  await expect.poll(moves).toHaveLength(6);
  expect((await moves())[5]).toEqual({kind:'drop',target:'wide'});

  // An expanded destination must not cover the checker that shares its point.
  await reset(6);
  const checker=(await overlap.boundingBox())!;
  await tapAt(checker.x+checker.width/2,checker.y+checker.height/2);
  await expect(ordinary).toHaveAttribute('data-drop-state','allowed');
  await expect(wide).toHaveAttribute('data-drop-state','unavailable');
  expect(await moves()).toHaveLength(6);
  await tapTarget(ordinary);
  await expect.poll(moves).toHaveLength(7);
  expect((await moves())[6]).toEqual({kind:'drop',target:'default'});

  for(const extra of [{acting_for_player_index:null},{replay:{index:1,total:5}},{status:'over'}]){
    await reset(7,extra);await expect(wide).toHaveAttribute('data-drop-state','inactive');
    await tapTarget(wide);await tapTarget(ordinary);expect(await moves()).toHaveLength(7);
  }
  await page.evaluate(()=>(window as any).assetTargetHost.destroy());
});
