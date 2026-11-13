import fs from 'node:fs';
import path from 'node:path';
import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {createUser,loginAs,uniqueName} from './helpers';

declare const state:any;
declare const offline:any;
declare function selectMatch(id:string):void;

const auth=(user:any)=>({'X-User-Id':user.id,'X-User-Password':user.password});

async function backgammon(request:APIRequestContext){
  const catalog=await(await request.get('/games')).json();
  const known=(Array.isArray(catalog)?catalog:catalog.items||[]).find((game:any)=>game.name==='Backgammon (Declarative)');
  if(known)return known;
  const payload=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../games/declarative/backgammon.json'),'utf8'));
  payload.game_addition_request_id_and_secret=uniqueName('backgammon-test-secret');
  let response=await request.post('/games',{data:payload,timeout:210000});
  for(let i=0;response.status()===429&&i<30;i++){
    await new Promise(resolve=>setTimeout(resolve,1000));
    response=await request.post('/games',{data:payload,timeout:210000});
  }
  expect(response.ok(),await response.text()).toBeTruthy();return response.json();
}

async function nextAction(page:Page){
  const stage=page.locator('#game-box .declarative-stage');
  await expect(stage).toBeVisible();
  await expect(page.locator('#game-box .declarative-error:visible')).toHaveCount(0);
  const signature=()=>stage.evaluate(node=>JSON.stringify([
    Array.from(node.querySelectorAll('.declarative-piece')).map(piece=>[piece.getAttribute('data-ui-id'),piece.getAttribute('transform'),piece.textContent]),
    Array.from(node.querySelectorAll(':scope > text')).map(label=>label.textContent),
  ]));
  const before=await signature();
  await expect.poll(async()=>await page.locator('#game-box .declarative-control.actionable button:enabled').count()+await page.locator('#game-box .declarative-piece.actionable').count(),{timeout:20000}).toBeGreaterThan(0);
  const button=page.locator('#game-box .declarative-control.actionable button:enabled').first();
  if(await button.count())await button.click();
  else{
    const checker=page.locator('#game-box .declarative-piece.actionable').first();
    await expect(checker).toHaveAttribute('data-actions','move');
    await checker.click();
    await expect(stage).toHaveClass(/show-drop-hints/);
    const target=page.locator('#game-box .declarative-target[data-drop-state="allowed"]').first();
    await expect(target).toBeVisible();await target.click();
  }
  // Local QuickJS moves do not have an HTTP response to await. Wait for the
  // actual new scene before choosing the next action from its DOM.
  await expect.poll(signature,{timeout:20000}).not.toBe(before);
}

async function countAnimations(page:Page){
  await page.addInitScript(()=>{
    const w=window as any,original=Element.prototype.animate;
    w.backgammonAnimations=[];w.backgammonAnimationRecords=[];w.backgammonRendered=[];w.backgammonMountCount=0;
    Element.prototype.animate=function(...args:any[]){
      const animation=original.apply(this,args as any);
      if(this.classList?.contains('declarative-piece')){
        const id=this.getAttribute('data-ui-id'),message=w.backgammonLastSent;
        w.backgammonAnimations.push(id);
        w.backgammonAnimationRecords.push({id,host_id:message?.host_id,move_count:message?.move_count,actor:message?.last_move_player_index,viewer:message?.my_player_index,actor_kind:message?.players?.find((player:any)=>player.player_index===message?.last_move_player_index)?.kind,duration:animation.effect?.getTiming().duration});
      }
      return animation;
    };
    let api:any;
    Object.defineProperty(w,'DeclarativeUI',{configurable:true,get:()=>api,set:value=>{
      api=value;const mount=api.mount;
      api.mount=(...args:any[])=>{
        const host=mount(...args),send=host.send.bind(host),hostId=++w.backgammonMountCount;w.backgammonActiveHostId=hostId;
        host.send=async(message:any,options:any)=>{
          w.backgammonLastSent={...message,host_id:hostId};const applied=await send(message,options);
          if(applied===true)w.backgammonRendered.push({host_id:hostId,move_count:message.move_count,actor:message.last_move_player_index,viewer:message.my_player_index,animate_override:options?.animate});
          return applied;
        };
        return host;
      };
    }});
  });
}

async function expectOwnMoveImmediate(page:Page,moveCount:number,seat:number){
  // Wait for the actual reducer/host completion; the HTTP response alone does
  // not prove the accepted state has been drawn yet.
  await expect.poll(()=>page.evaluate(count=>(window as any).backgammonRendered.some((message:any)=>message.host_id===(window as any).backgammonActiveHostId&&message.move_count===count),moveCount)).toBe(true);
  const observed=await page.evaluate(({count,seat})=>({messages:(window as any).backgammonRendered.filter((message:any)=>message.host_id===(window as any).backgammonActiveHostId&&message.move_count===count&&message.viewer===seat),animated:(window as any).backgammonAnimationRecords.filter((item:any)=>item.host_id===(window as any).backgammonActiveHostId&&item.move_count===count)}),{count:moveCount,seat});
  expect(observed.messages.length).toBeGreaterThan(0);expect(observed.messages.every((message:any)=>message.actor===seat)).toBe(true);expect(observed.animated).toEqual([]);
}

test('Backgammon appears in the ordinary catalog and finishes a two-player portal match',async({browser,request},testInfo)=>{
  test.setTimeout(720000);
  const game=await backgammon(request);
  const alice=await createUser(request,uniqueName('Backgammon Alice'));
  const bob=await createUser(request,uniqueName('Backgammon Bob'));
  const contexts=[],pages:Page[]=[],errors:string[]=[];
  try{
    for(const user of [alice,bob]){
      const context=await browser.newContext({viewport:testInfo.project.name==='mobile'?{width:390,height:844}:{width:1280,height:900}});
      contexts.push(context);const page=await context.newPage();pages.push(page);await countAnimations(page);
      page.on('pageerror',error=>errors.push(error.message));await loginAs(page,user);
    }
    await pages[0].goto('/static/portal.html');
    await pages[0].getByRole('combobox',{name:'Search games'}).fill('Backgammon');
    const choice=pages[0].getByRole('option',{name:/Backgammon \(Declarative\)/}).first();
    await expect(choice).toBeVisible();await choice.click();
    await expect(pages[0].locator('#practice')).toBeEnabled();
    await expect(pages[0].locator('#play-computers')).toBeEnabled();
    const create=await request.post('/matches',{headers:auth(alice),data:{game_id:game.id,num_computer_opponents:0}});
    expect(create.ok(),await create.text()).toBeTruthy();const created=await create.json();
    expect((await request.post(`/matches/${created.id}/join`,{headers:auth(bob)})).ok()).toBeTruthy();
    expect((await request.post(`/matches/${created.id}/start`,{headers:auth(alice),data:{}})).ok()).toBeTruthy();
    for(const page of pages){
      await page.goto(`/static/portal.html#match=${created.id}`);
      await expect(page.locator('#game-box .declarative-stage')).toBeVisible();
      await expect(page.locator('#game-box > iframe:visible')).toHaveCount(0);
      await expect(page.locator('#game-box .declarative-piece[data-ui-id^="checker_"]')).toHaveCount(30);
    }
    let current=await(await request.get(`/matches/${created.id}`,{headers:auth(alice)})).json();
    let moves=0,ownTurnEndingCheckerMoves=0;
    while(current.status==='ongoing'&&moves<305){
      const seat=current.turn_of_player_indices[0],page=pages[seat];
      const response=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/matches/${created.id}/moves`);
      await nextAction(page);const result=await response;expect(result.ok(),await result.text()).toBeTruthy();
      current=await result.json();moves++;
      expect(current.last_move_player_index).toBe(seat);await expectOwnMoveImmediate(page,current.move_count,seat);
      if(result.request().postDataJSON()?.move?.action==='move'&&current.status==='ongoing'&&!current.turn_of_player_indices.includes(seat))ownTurnEndingCheckerMoves++;
      if(moves===2)await testInfo.attach('backgammon-legal-move',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
    }
    expect(current.status).toBe('over');expect(moves).toBeGreaterThan(2);expect(ownTurnEndingCheckerMoves).toBeGreaterThan(0);
    for(const [seat,page] of pages.entries()){
      await expect.poll(()=>page.evaluate(otherSeat=>(window as any).backgammonAnimationRecords.some((item:any)=>item.actor===otherSeat),1-seat)).toBe(true);
      expect(await page.evaluate(()=>(window as any).backgammonAnimationRecords.every((item:any)=>Number.isInteger(item.actor)&&item.actor!==item.viewer))).toBe(true);
    }
    await expect(pages[0].locator('#game-box .actionable')).toHaveCount(0);
    await testInfo.attach('backgammon-finished',{body:await pages[0].screenshot({fullPage:true}),contentType:'image/png'});
    await testInfo.attach('backgammon-match-evidence',{body:JSON.stringify({game:game.id,version:game.version,match:created.id,moves,own_turn_ending_checker_moves:ownTurnEndingCheckerMoves,status:current.status,errors}),contentType:'application/json'});
    expect(errors).toEqual([]);
  }finally{for(const context of contexts)await context.close();}
});

test('Backgammon pass-and-play is immediate and computer play uses the ordinary server match',async({page,request},testInfo)=>{
  test.setTimeout(120000);
  const game=await backgammon(request),user=await createUser(request,uniqueName('Backgammon modes'));
  await countAnimations(page);await loginAs(page,user);await page.goto(`/static/portal.html#game=${game.id}`);
  const writes:string[]=[];
  page.on('request',request=>{if(request.method()!=='GET'&&new URL(request.url()).pathname.startsWith('/matches'))writes.push(request.url());});
  await page.locator('#practice').click();
  await expect(page.locator('#game-box .declarative-stage')).toBeVisible();
  for(let i=0;i<5;i++)await nextAction(page);
  expect(writes).toEqual([]);
  expect(await page.evaluate(()=>(window as any).backgammonAnimations.length)).toBe(0);
  await page.locator('#match-controls-toggle').click();await page.locator('#history-back').click();
  await expect(page.locator('#game-box .actionable')).toHaveCount(0);
  await page.locator('#history-live').click();
  await expect(page.locator('#game-box .declarative-hint-message')).toBeVisible();
  await page.goto(`/static/portal.html#game=${game.id}`);
  const created=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/matches');
  await page.locator('#play-computers').click();const response=await created;expect(response.ok(),await response.text()).toBeTruthy();
  const match=await response.json();
  await expect(page.locator('#game-box .declarative-stage')).toBeVisible();
  for(let i=0;i<8;i++){
    const moving=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/matches/${match.id}/moves`);
    await nextAction(page);const accepted=await moving;expect(accepted.ok()).toBeTruthy();const result=await accepted.json();expect(result.last_move_player_index).toBe(0);await expectOwnMoveImmediate(page,result.move_count,0);
  }
  const current=await(await request.get(`/matches/${match.id}`,{headers:auth(user)})).json();
  expect(current.players.filter((player:any)=>player.kind==='computer')).toHaveLength(1);
  expect(current.move_count).toBeGreaterThanOrEqual(8);
  await expect.poll(()=>page.evaluate(()=>(window as any).backgammonAnimationRecords.filter((item:any)=>item.actor_kind==='computer'&&item.actor!==item.viewer).length)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>(window as any).backgammonAnimationRecords.every((item:any)=>Number.isInteger(item.actor)&&item.actor!==item.viewer))).toBe(true);
  await expect(page.locator('#game-box .declarative-error:visible')).toHaveCount(0);
  await testInfo.attach('backgammon-computer',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
});


test('a device computer reply snaps the accepted own baseline before animating the combined opponent snapshot',async({page,request},testInfo)=>{
  test.setTimeout(120000);
  const game=await backgammon(request),full=await(await request.get(`/games/${game.id}/versions/${game.version}`)).json(),user=await createUser(request,uniqueName('Backgammon device actors'));
  await countAnimations(page);await loginAs(page,user);await page.goto(`/static/portal.html#game=${game.id}`);
  const writes:string[]=[];page.on('request',request=>{if(request.method()!=='GET'&&new URL(request.url()).pathname.startsWith('/matches'))writes.push(request.url());});
  await page.evaluate(async game=>{const match=await offline.practice(game,'computer',2);selectMatch(match.id);},full);
  await expect(page.locator('#game-box .declarative-stage')).toBeVisible();
  let mixed:any=null;
  for(let i=0;i<12&&!mixed;i++){
    const before=await page.evaluate(()=>({count:state.match.move_count,rendered:(window as any).backgammonRendered.length,checker:!state.match.state.needRoll}));
    await nextAction(page);
    const after=await page.evaluate(()=>state.match.move_count);
    await expect.poll(()=>page.evaluate(count=>(window as any).backgammonRendered.some((message:any)=>message.host_id===(window as any).backgammonActiveHostId&&message.move_count===count),after)).toBe(true);
    if(before.checker&&after>before.count+1){
      mixed=await page.evaluate(({start,before,after})=>({before,after,renders:(window as any).backgammonRendered.slice(start).filter((message:any)=>message.host_id===(window as any).backgammonActiveHostId),animations:(window as any).backgammonAnimationRecords.filter((item:any)=>item.host_id===(window as any).backgammonActiveHostId&&item.move_count>before)}),{start:before.rendered,before:before.count,after});
    }
  }
  expect(mixed).not.toBeNull();
  const baseline=mixed.renders.findIndex((message:any)=>message.move_count===mixed.before+1&&message.actor===0&&message.animate_override===false),opponent=mixed.renders.findIndex((message:any)=>message.move_count===mixed.after&&message.actor===1);
  expect(baseline).toBeGreaterThanOrEqual(0);expect(opponent).toBeGreaterThan(baseline);
  expect(mixed.animations.some((item:any)=>item.actor===1&&item.actor_kind==='computer'&&item.duration===1440)).toBe(true);
  expect(mixed.animations.every((item:any)=>item.actor!==item.viewer)).toBe(true);
  expect(writes).toEqual([]);await expect(page.locator('#game-box .declarative-error:visible')).toHaveCount(0);
  await testInfo.attach('device-computer-mixed-actor-evidence',{body:JSON.stringify(mixed),contentType:'application/json'});
});
