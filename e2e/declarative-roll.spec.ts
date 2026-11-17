import {expect, test, type Page} from '@playwright/test';

async function mountDice(page: Page) {
  await page.goto('/static/declarative-test.html');
  await page.evaluate(async () => {
    const box=document.createElement('div');box.id='roll-test';box.style.cssText='position:fixed;inset:0;z-index:9999';document.body.append(box);
    const spec={format:'buildplay-ui',version:1,viewport:{width:400,height:300},
      boards:[{id:'table',kind:'zone',width:400,height:300}],piece_types:{die:{shape:'dice',width:64,height:64}},
      ui_code:`const gameUI={reduce(m){return {scene:{pieces:[{id:'die',type:'die',board:'table',position:{x:200,y:150},
        text:m.view.face,opacity:m.view.used?.5:1,actions:[],animation:{kind:'roll',key:m.view.key}}]}}}};`};
    const w=window as any;w.rollStarts=[];
    const original=Element.prototype.animate;
    Element.prototype.animate=function(...args:any[]){
      if(this.classList.contains('declarative-roll'))w.rollStarts.push({duration:args[1]?.duration});
      return original.apply(this,args as any);
    };
    w.rollSpec=spec;w.rollMessage={type:'state_changed',view:{key:'initial',face:'2'},status:'ongoing',acting_for_player_index:0,my_player_index:0,move_count:0};
    // Pass-and-play deliberately disables checker interpolation. Dice effects
    // remain visible because they describe a new roll rather than piece travel.
    w.rollHost=w.DeclarativeUI.mount(box,spec,{animate:false});await w.rollHost.send(w.rollMessage);
  });
}

test('new roll keys animate once in pass-and-play and polling keeps the existing animation clock',async({page})=>{
  await mountDice(page);
  const die=page.locator('#roll-test [data-ui-id="die"]'),art=die.locator('.declarative-roll');
  expect(await art.evaluate(node=>node.getAnimations().length)).toBe(0);
  const camera=await page.locator('#roll-test svg').getAttribute('viewBox');
  const position=await die.getAttribute('transform');
  await page.evaluate(async()=>{const w=window as any;w.rolled={...w.rollMessage,view:{key:'roll-1',face:'4'},move_count:1,last_move_player_index:0};await w.rollHost.send(w.rolled);});
  expect(await art.evaluate(node=>node.getAnimations().length)).toBe(1);
  await art.evaluate(node=>{(window as any).rolling=node.getAnimations()[0];});
  await page.evaluate(async()=>{const w=window as any;await w.rollHost.send(w.rolled);});
  expect(await art.evaluate(node=>node.getAnimations()[0]===(window as any).rolling)).toBe(true);
  await expect.poll(()=>art.evaluate(node=>node.getAnimations().length)).toBe(0);
  expect(await page.evaluate(()=>(window as any).rollStarts)).toHaveLength(1);
  expect(await art.textContent()).toBe('4');
  expect(await die.getAttribute('transform')).toBe(position);
  expect(await page.locator('#roll-test svg').getAttribute('viewBox')).toBe(camera);
  await page.evaluate(async()=>{const w=window as any;await w.rollHost.send({...w.rolled,view:{...w.rolled.view,used:true},move_count:2});});
  expect(await page.evaluate(()=>(window as any).rollStarts)).toHaveLength(1);
  expect(await art.evaluate(node=>node.getAnimations().length)).toBe(0);
  await page.evaluate(async()=>{const w=window as any;await w.rollHost.send({...w.rolled,view:{key:'roll-2',face:'1'},move_count:3});});
  expect(await page.evaluate(()=>(window as any).rollStarts)).toHaveLength(2);
  await page.evaluate(async()=>{const w=window as any;await w.rollHost.send({...w.rolled,view:{key:'baseline',face:'3'},move_count:4},{animate:false});});
  expect(await art.evaluate(node=>node.getAnimations().length)).toBe(0);
  expect(await page.evaluate(()=>(window as any).rollStarts)).toHaveLength(2);
});

test('roll effects skip initial mounting, reduced motion, replay and returning to live play',async({page})=>{
  await mountDice(page);
  const art=page.locator('#roll-test .declarative-roll');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(async()=>{const w=window as any;await w.rollHost.send({...w.rollMessage,view:{key:'roll-1',face:'5'},move_count:1});});
  expect(await art.evaluate(node=>node.getAnimations().length)).toBe(0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(async()=>{const w=window as any;await w.rollHost.send({...w.rollMessage,view:{key:'roll-2',face:'6'},move_count:2,replay:{index:2,total:4}});});
  await page.evaluate(async()=>{const w=window as any;await w.rollHost.send({...w.rollMessage,view:{key:'roll-3',face:'1'},move_count:3});});
  expect(await page.evaluate(()=>(window as any).rollStarts)).toHaveLength(0);
  await page.evaluate(async()=>{const w=window as any;await w.rollHost.send({...w.rollMessage,view:{key:'roll-4',face:'3'},move_count:4});});
  expect(await art.evaluate(node=>node.getAnimations().length)).toBe(1);
  await art.evaluate(node=>{(window as any).rolling=node.getAnimations()[0];});
  await page.evaluate(()=>(window as any).rollHost.destroy());
  expect(await page.evaluate(()=>(window as any).rolling.playState)).toBe('idle');
  await page.evaluate(async()=>{const w=window as any;w.rollHost=w.DeclarativeUI.mount(document.getElementById('roll-test'),w.rollSpec,{animate:false});await w.rollHost.send({...w.rollMessage,view:{key:'roll-4',face:'3'},move_count:4});});
  expect(await art.evaluate(node=>node.getAnimations().length)).toBe(0);
  expect(await page.evaluate(()=>(window as any).rollStarts)).toHaveLength(1);
});
