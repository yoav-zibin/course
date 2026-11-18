import {test, expect} from '@playwright/test';
import {createUser,loginAs,uniqueName} from './helpers';

declare const state:any;
declare const frame:any;
declare function syncGame():Promise<void>;
declare function render():void;
declare function syncPortalScreen():void;
declare const offline:any;
declare const Auth:any;
declare const I18n:any;
declare let onMakeMove:any;

// Constructed host fixtures exercise the real visible renderer, not gameplay.
const spec = {
  format:'buildplay-ui', version:1, viewport:{width:400,height:300},
  boards:[{id:'table',kind:'zone',width:400,height:300}],
  piece_types:{token:{shape:'circle',width:48,height:48}},
  ui_code:`const gameUI={reduce(m){return {scene:{pieces:[
    {id:'stable-token',type:'token',board:'table',position:{x:60+(m.view.n||0)*80,y:150},actions:['tap']}
  ]}};}};`,
};

test('history animates forward and backward for the reviewer and remains read only',async({page})=>{
  await page.goto('/static/declarative-test.html');
  const result=await page.evaluate(async spec=>{
    const box=document.createElement('div');box.style.cssText='position:fixed;inset:0;z-index:9999;background:#102330';document.body.append(box);
    const moves:any[]=[];const host=(window as any).DeclarativeUI.mount(box,spec,{animate:false,onMove:(move:any)=>moves.push(move)});
    const message={type:'state_changed',status:'ongoing',my_player_index:0,acting_for_player_index:0,last_move_player_index:0,move_count:0,view:{n:0},replay:{index:0,total:2}};
    await host.send(message,{animate:false});
    const timings=[];
    for(const count of [1,2,1,0]){
      await host.send({...message,move_count:count,view:{n:count},replay:{index:count,total:2}},{animate:true});
      const node=box.querySelector('.declarative-piece')!;
      const animation=node.getAnimations()[0];
      if(!animation)throw new Error('Missing history animation at '+count);
      timings.push(animation.effect!.getComputedTiming().duration);
      animation.finish();await host.whenIdle();
      (node as SVGElement).dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    }
    const disabled=[...box.querySelectorAll('[data-ui-id]')].every(node=>node.getAttribute('aria-disabled')==='true');
    host.destroy();return {timings,moves,disabled};
  },spec);
  expect(result.timings).toEqual([1440,1440,1440,1440]);expect(result.moves).toEqual([]);expect(result.disabled).toBe(true);
});

test('Portal history play, pause, stepping and return to live preserve the authoritative match',async({page,request},testInfo)=>{
  page.setDefaultTimeout(5000);
  await loginAs(page,await createUser(request,uniqueName('History controls')));
  await page.goto('/static/portal.html');
  await page.waitForFunction(()=>typeof state!=='undefined'&&!state.refreshing);
  await page.evaluate(async spec=>{
    Object.defineProperty(document,'hidden',{value:true,configurable:true});
    const game={id:'history-fixture',version:1,name:'History fixture',allowed_player_counts:[2],declarative_ui:spec};
    state.games=[game];state.gameCache.set('history-fixture@1',game);
    const moves=[1,2,3].map((n,index)=>({player_index:index%2,new_state:{n},next_turn_player_indices:[(index+1)%2]}));
    state.match={id:'local-history-fixture',game_id:game.id,game_version:1,localMode:'pass',
      owner_user_id:Auth.current().id, // Match host; Game records have no creator field.
      players:[0,1].map(i=>({id:'fixture-'+i,player_index:i,kind:'human',display_name:'Fixture '+i})),
      status:'ongoing',turn_of_player_indices:[1],move_count:3,state:{n:3},last_move_player_index:0,moves};
    state.selectedId=state.match.id;state.replay=null;
    const original=offline.api.bind(offline);
    offline.api=(method:string,path:string,...args:any[])=>path==='/matches/local-history-fixture/history'
      ?Promise.resolve({moves,initial_state:{n:0},initial_turn_player_indices:[0]})
      :original(method,path,...args);
    I18n.gameText=async()=>({locale:'en',strings:{}});
    (window as any).historyFixtureEmissions=[];
    onMakeMove=async(move:any)=>{(window as any).historyFixtureEmissions.push(move);};
    frame.load(spec,{animate:false});state.loaded='local-history-fixture@history-fixture@1';state.lastSent=null;
    const nativeSend=frame.declarative.send.bind(frame.declarative);
    frame.declarative.send=async(message:any,options:any)=>{
      (window as any).historyFixtureLastActor=message.last_move_player_index;
      return nativeSend(message,options);
    };
    history.replaceState(null,'','#match=local-history-fixture');syncPortalScreen();
    render();await syncGame();
  },spec);
  await page.locator('#match-menu-toggle').click();
  const menu=page.locator('#match-controls-toggle');
  if(await menu.count())await menu.click();
  await page.locator('#history-play').click();
  await expect.poll(()=>page.evaluate(()=>state.replay?.index)).toBe(1);
  await expect.poll(()=>page.locator('#game-box .declarative-piece').evaluate(node=>node.getAnimations().length)).toBe(1);
  await expect.poll(()=>page.evaluate(()=>(window as any).historyFixtureLastActor)).toBe(0);
  await page.locator('#history-play').click();
  await expect(page.locator('#history-play')).toHaveAttribute('aria-pressed','false');
  await page.waitForTimeout(1800);
  expect(await page.evaluate(()=>state.replay.index)).toBe(1);
  for(const id of ['history-back','history-forward','history-play','history-live']){
    const bounds=await page.locator('#'+id).boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(32);expect(bounds!.height).toBeGreaterThanOrEqual(32);
  }
  await page.screenshot({path:testInfo.outputPath('history-paused.png')});
  await page.locator('#history-forward').click();
  await expect.poll(()=>page.evaluate(()=>state.replay.index)).toBe(2);
  await expect.poll(()=>page.evaluate(()=>(window as any).historyFixtureLastActor)).toBe(1);
  await page.locator('#history-back').click();
  await expect.poll(()=>page.evaluate(()=>state.replay.index)).toBe(1);
  await page.locator('#game-box .declarative-piece').dispatchEvent('keydown',{key:'Enter',bubbles:true});
  expect(await page.evaluate(()=>(window as any).historyFixtureEmissions)).toEqual([]);
  await page.locator('#history-live').click();
  await expect.poll(()=>page.evaluate(()=>state.replay)).toBe(null);
  expect(await page.evaluate(()=>({count:state.match.move_count,n:state.match.state.n}))).toEqual({count:3,n:3});
});

test('reduced-motion history is immediate and read only',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/static/declarative-test.html');
  const result=await page.evaluate(async spec=>{
    const box=document.createElement('div');box.style.cssText='position:fixed;inset:0';document.body.append(box);
    const moves:any[]=[];const host=(window as any).DeclarativeUI.mount(box,spec,{animate:true,onMove:(m:any)=>moves.push(m)});
    const message={type:'state_changed',status:'ongoing',my_player_index:0,acting_for_player_index:0,move_count:0,view:{n:0},replay:{index:0,total:1}};
    await host.send(message,{animate:false});
    await host.send({...message,move_count:1,view:{n:1},replay:{index:1,total:1}},{animate:true});
    const animations=box.getAnimations({subtree:true}).length;
    await host.whenIdle();host.destroy();return{animations,moves};
  },spec);
  expect(result).toEqual({animations:0,moves:[]});
});

test('a seat change clears an already fading private face on an unchanged scene',async({page})=>{
  await page.goto('/static/declarative-test.html');
  const result=await page.evaluate(async spec=>{
    spec.ui_code=`const gameUI={reduce(m){return {scene:{pieces:m.view.show?[{
      id:'private-card',type:'token',board:'table',position:{x:150,y:150},
      text:'Seat zero private face',actions:[]
    }]:[]}};}};`;
    const cases=[];
    for(const [viewer,count] of [[1,1],[1,2],[null,1]]){
      const box=document.createElement('div');box.style.cssText='position:fixed;inset:0';document.body.append(box);
      const host=(window as any).DeclarativeUI.mount(box,spec,{animate:false});
      const message={type:'state_changed',status:'ongoing',my_player_index:0,acting_for_player_index:null,
        move_count:0,view:{show:true},replay:{index:0,total:2}};
      await host.send(message,{animate:false});
      const empty={...message,move_count:1,view:{show:false},replay:{index:1,total:2}};
      await host.send(empty,{animate:true});
      // Keep the transition in progress without depending on test-machine speed.
      for(const animation of box.getAnimations({subtree:true}))animation.pause();
      const fadingBefore=box.querySelectorAll('.declarative-history-ghost').length;
      await host.send({...empty,my_player_index:viewer,move_count:count,replay:{index:count,total:2}},{animate:true});
      const fadingAfter=box.querySelectorAll('.declarative-history-ghost').length;
      const oldFaceVisible=box.textContent!.includes('Seat zero private face');
      host.destroy();box.remove();cases.push({viewer,count,fadingBefore,fadingAfter,oldFaceVisible});
    }
    return cases;
  },structuredClone(spec));
  for(const row of result){
    expect(row.fadingBefore).toBe(1);
    expect(row.fadingAfter).toBe(0);
    expect(row.oldFaceVisible).toBe(false);
  }
});

test('history makes placements, counter changes and removals visible without actionable ghosts',async({page})=>{
  await page.goto('/static/declarative-test.html');
  const result=await page.evaluate(async spec=>{
    const box=document.createElement('div');box.style.cssText='position:fixed;inset:0';document.body.append(box);
    spec.ui_code=`const gameUI={reduce(m){return {scene:{pieces:m.view.n===0||m.view.n===3?[]:[
      {id:'counter',type:'token',board:'table',position:{x:150,y:150},text:String(m.view.n),actions:['tap']}
    ]}};}};`;
    const host=(window as any).DeclarativeUI.mount(box,spec,{animate:false});
    const message={type:'state_changed',status:'ongoing',my_player_index:0,acting_for_player_index:0,move_count:0,view:{n:0},replay:{index:0,total:3}};
    await host.send(message,{animate:false});const effects=[];
    for(const count of [1,2,3,2,1,0]){
      await host.send({...message,move_count:count,view:{n:count},replay:{index:count,total:3}},{animate:true});
      const animations=box.getAnimations({subtree:true});
      if(!animations.length)throw new Error('Missing visible history effect for '+count);
      effects.push({count,durations:animations.map(a=>a.effect!.getComputedTiming().duration),
        ghosts:[...box.querySelectorAll('.declarative-history-ghost')].map(node=>({hidden:node.getAttribute('aria-hidden'),interactive:node.hasAttribute('data-ui-id'),pointer:(node as SVGElement).style.pointerEvents}))});
      for(const animation of animations)animation.finish();await host.whenIdle();
      await new Promise(requestAnimationFrame);
    }
    const remainingGhosts=box.querySelectorAll('.declarative-history-ghost').length;
    await host.send({...message,move_count:1,view:{n:1},replay:{index:1,total:3}},{animate:false});
    await host.send({...message,my_player_index:1,move_count:2,view:{n:3},replay:{index:2,total:3}},{animate:true});
    const crossViewerOldFaces=box.querySelectorAll('.declarative-piece,.declarative-history-ghost').length;
    host.destroy();return{effects,remainingGhosts,crossViewerOldFaces};
  },structuredClone(spec));
  expect(result.effects).toHaveLength(6);
  for(const row of result.effects){expect(row.durations.every(value=>value===1440)).toBe(true);for(const ghost of row.ghosts)expect(ghost).toEqual({hidden:'true',interactive:false,pointer:'none'});}
  expect(result.remainingGhosts).toBe(0);
  expect(result.crossViewerOldFaces).toBe(0);
});
