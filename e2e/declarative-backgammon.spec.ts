import fs from 'node:fs';
import path from 'node:path';
import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {createUser,loginAs,uniqueName} from './helpers';
import {backgammonAction,ordinaryBackgammonView} from './backgammon-helpers';

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
  let response=await request.post('/games/declarative',{data:payload,timeout:210000});
  for(let i=0;response.status()===429&&i<30;i++){
    await new Promise(resolve=>setTimeout(resolve,1000));
    response=await request.post('/games/declarative',{data:payload,timeout:210000});
  }
  expect(response.ok(),await response.text()).toBeTruthy();return response.json();
}

async function nextAction(page:Page,expectedMoveCount?:number){
  const stage=page.locator('#game-box .declarative-stage');
  await expect(stage).toBeVisible();
  await expect(page.locator('#game-box .declarative-error:visible')).toHaveCount(0);
  // A committed parent response can precede the reducer's rendered snapshot.
  const expected=expectedMoveCount??await page.evaluate(()=>state.match.move_count);
  await expect.poll(()=>page.evaluate(count=>(window as any).backgammonRendered.some((message:any)=>message.host_id===(window as any).backgammonActiveHostId&&message.move_count===count),expected),{timeout:30000}).toBe(true);
  await backgammonAction(page);
  // A tied opening can change only the roll key. Wait for accepted authority
  // progress instead of treating a visually identical pair as a failed move.
  await expect.poll(()=>page.evaluate(()=>state.match.move_count),{timeout:30000}).toBeGreaterThan(expected);
}

test('physical dice roll by pointer and keyboard, then four dice show doubles usage',async({page},testInfo)=>{
  const payload=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../games/declarative/backgammon.json'),'utf8'));
  await page.goto('/static/declarative-test.html');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(async({spec,view})=>{
    const box=document.createElement('div');box.id='dice-test';
    box.style.cssText='position:fixed;inset:0;z-index:9999;background:#102330';document.body.append(box);
    const w=window as any;w.diceMoves=[];w.diceSpec=spec;
    w.diceMessage={type:'state_changed',status:'ongoing',view,state:view,my_player_index:view.cur,
      acting_for_player_index:view.cur,turn_of_player_indices:[view.cur],move_count:0,
      players:[{player_index:0,name:'Alice',kind:'human'},{player_index:1,name:'Bob',kind:'human'}]};
    w.diceHost=w.DeclarativeUI.mount(box,spec,{onMove:(move:any)=>w.diceMoves.push(move),onScene:(scene:any)=>w.diceScene=scene});
    await w.diceHost.send(w.diceMessage);
  },{spec:payload.declarative_ui,view:ordinaryBackgammonView(payload.unit_tests.cases[0].view_of_mover)});
  const host=page.locator('#dice-test'),dice=host.locator('.declarative-piece[data-ui-id^="die_"]');
  await expect(dice).toHaveCount(2);
  await expect(host.locator('.declarative-control [data-ui-id="roll"]')).toHaveCount(0);
  for(const die of await dice.all()){
    await expect(die).toHaveAttribute('data-actions','tap');
    await expect(die).toHaveClass(/actionable/);
  }
  await dice.first().locator(':scope > g[opacity]').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).diceMoves)).toEqual([{action:'roll'}]);
  // A host accepts one move per snapshot. Reset the fixture before proving
  // the independent keyboard path, just as a fresh server snapshot does.
  await page.evaluate(async()=>{const w=window as any;await w.diceHost.send(w.diceMessage);});
  await dice.last().focus();await dice.last().press('Enter');
  await expect.poll(()=>page.evaluate(()=>(window as any).diceMoves)).toEqual([{action:'roll'},{action:'roll'}]);
  for(let used=0;used<4;used++){
    await page.evaluate(async used=>{
      const w=window as any,remaining=Array(4-used).fill(3);
      const view={...w.diceMessage.view,opening:false,opening_roll:null,needRoll:false,dice:remaining,moves:remaining,legalMoves:[]};
      await w.diceHost.send({...w.diceMessage,view,state:view,move_count:used+1});
    },used);
    await expect(dice).toHaveCount(4);
    await expect(host.locator('.declarative-piece[data-ui-id^="die_"].actionable')).toHaveCount(0);
    expect(await page.evaluate(()=>(window as any).diceScene.pieces.filter((piece:any)=>piece.type==='die').map((piece:any)=>piece.asset)))
      .toEqual(Array.from({length:4},(_,i)=>`die_3_used_${i<used?2:0}`));
    if(used===1||used===3)await host.screenshot({path:testInfo.outputPath(`doubles-${used}-used.png`)});
  }
  // A passive die cannot submit another roll while checker moves are pending.
  const passiveDie = (await dice.first().locator(':scope > g[opacity]').boundingBox())!;
  await page.mouse.click(passiveDie.x + passiveDie.width / 2, passiveDie.y + passiveDie.height / 2);
  expect(await page.evaluate(()=>(window as any).diceMoves)).toHaveLength(2);
  // The fourth move advances the turn and clears authoritative dice. Preserve
  // the completed physical pair until the next player actually rolls again.
  await page.evaluate(async()=>{
    const w=window as any;
    const view={...w.diceMessage.view,opening:false,opening_roll:null,needRoll:true,dice:[],moves:[],legalMoves:[],
      cur:1-w.diceMessage.view.cur,n:(w.diceMessage.view.n||0)+1};
    w.diceNextMessage={...w.diceMessage,view,state:view,my_player_index:view.cur,
      acting_for_player_index:view.cur,turn_of_player_indices:[view.cur],move_count:5};
    await w.diceHost.send(w.diceNextMessage);
  });
  expect(await page.evaluate(()=>(window as any).diceScene.pieces.filter((piece:any)=>piece.type==='die').map((piece:any)=>piece.asset)))
    .toEqual(Array(4).fill('die_3_used_2'));
  await expect(host.locator('.declarative-piece[data-ui-id^="die_"].actionable')).toHaveCount(4);
  await host.screenshot({path:testInfo.outputPath('doubles-4-used.png')});
  await dice.first().locator(':scope > g[opacity]').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).diceMoves)).toHaveLength(3);
  await page.evaluate(async()=>{
    const w=window as any,view={...w.diceNextMessage.view,needRoll:false,dice:[2,5],moves:[2,5]};
    await w.diceHost.send({...w.diceNextMessage,view,state:view,move_count:6});
  });
  expect(await page.evaluate(()=>(window as any).diceScene.pieces.filter((piece:any)=>piece.type==='die').map((piece:any)=>piece.asset)))
    .toEqual(['die_2_used_0','die_5_used_0']);
  await page.evaluate(async()=>{
    const w=window as any;await w.diceHost.send({...w.diceMessage,move_count:5,replay:{index:0,total:5}});
  });
  await expect(dice).toHaveCount(2);
  await expect(host.locator('.declarative-piece.actionable')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).diceScene.pieces.filter((piece:any)=>piece.type==='die').map((piece:any)=>piece.asset)))
    .toEqual(['die_0_used_0','die_0_used_0']);
});

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

async function expectOwnMoveAtReferenceSpeed(page:Page,moveCount:number,seat:number,checkerMove:boolean){
  // Wait for the actual reducer/host completion; the HTTP response alone does
  // not prove the accepted state has been drawn yet.
  await expect.poll(()=>page.evaluate(count=>(window as any).backgammonRendered.some((message:any)=>message.host_id===(window as any).backgammonActiveHostId&&message.move_count===count),moveCount),{timeout:30000}).toBe(true);
  const observed=await page.evaluate(({count,seat})=>({messages:(window as any).backgammonRendered.filter((message:any)=>message.host_id===(window as any).backgammonActiveHostId&&message.move_count===count&&message.viewer===seat),animated:(window as any).backgammonAnimationRecords.filter((item:any)=>item.host_id===(window as any).backgammonActiveHostId&&item.move_count===count)}),{count:moveCount,seat});
  expect(observed.messages.length).toBeGreaterThan(0);expect(observed.messages.every((message:any)=>message.actor===seat)).toBe(true);
  const checkerAnimations=observed.animated.filter((item:any)=>item.id?.startsWith('checker_'));
  if(checkerMove){
    expect(checkerAnimations.length).toBeGreaterThan(0);
    expect(checkerAnimations.every((item:any)=>[400,800].includes(item.duration))).toBe(true);
  }else expect(checkerAnimations).toEqual([]);
}

test('Backgammon appears in the ordinary catalog and finishes a two-player portal match',async({browser,request},testInfo)=>{
  test.setTimeout(1080000);
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
    while(current.status==='ongoing'&&moves<1000){
      const seat=current.turn_of_player_indices[0],page=pages[seat];
      const response=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/matches/${created.id}/moves`);
      await nextAction(page,current.move_count);const result=await response;expect(result.ok(),await result.text()).toBeTruthy();
      current=await result.json();moves++;
      expect(current.last_move_player_index).toBe(seat);await expectOwnMoveAtReferenceSpeed(page,current.move_count,seat,result.request().postDataJSON()?.move?.action==='move');
      if(result.request().postDataJSON()?.move?.action==='move'&&current.status==='ongoing'&&!current.turn_of_player_indices.includes(seat))ownTurnEndingCheckerMoves++;
      if(moves===2)await testInfo.attach('backgammon-legal-move',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
    }
    expect(current.status).toBe('over');expect(moves).toBeGreaterThan(2);expect(ownTurnEndingCheckerMoves).toBeGreaterThan(0);
    for(const [seat,page] of pages.entries()){
      await expect.poll(()=>page.evaluate(otherSeat=>(window as any).backgammonAnimationRecords.some((item:any)=>item.actor===otherSeat),1-seat),{timeout:30000}).toBe(true);
      expect(await page.evaluate(()=>(window as any).backgammonAnimationRecords.filter((item:any)=>item.id?.startsWith('checker_')).every((item:any)=>Number.isInteger(item.actor)&&[400,800].includes(item.duration)))).toBe(true);
    }
    await expect(pages[0].locator('#game-box .actionable')).toHaveCount(0);
    await testInfo.attach('backgammon-finished',{body:await pages[0].screenshot({fullPage:true}),contentType:'image/png'});
    await testInfo.attach('backgammon-match-evidence',{body:JSON.stringify({game:game.id,version:game.version,match:created.id,moves,own_turn_ending_checker_moves:ownTurnEndingCheckerMoves,status:current.status,errors}),contentType:'application/json'});
    expect(errors).toEqual([]);
  }finally{for(const context of contexts)await context.close();}
});

test('Backgammon pass-and-play animates at reference speed and computer play uses the ordinary server match',async({page,request},testInfo)=>{
  test.setTimeout(120000);
  const game=await backgammon(request),user=await createUser(request,uniqueName('Backgammon modes'));
  await countAnimations(page);await loginAs(page,user);await page.goto(`/static/portal.html#game=${game.id}`);
  const writes:string[]=[];
  page.on('request',request=>{if(request.method()!=='GET'&&new URL(request.url()).pathname.startsWith('/matches'))writes.push(request.url());});
  await page.locator('#practice').click();
  await expect(page.locator('#game-box .declarative-stage')).toBeVisible();
  for(let i=0;i<18;i++){
    await nextAction(page);
    if(i>=4&&await page.evaluate(()=>(window as any).backgammonAnimationRecords.some((item:any)=>item.id?.startsWith('checker_')&&item.duration===800)))break;
  }
  expect(writes).toEqual([]);
  expect(await page.evaluate(()=>(window as any).backgammonAnimationRecords.some((item:any)=>item.id?.startsWith('checker_')&&item.duration===800))).toBe(true);
  await page.locator('#match-menu-toggle').click();await page.locator('#match-controls-toggle').click();await page.locator('#history-back').click();
  await expect(page.locator('#game-box .actionable')).toHaveCount(0);
  await page.locator('#history-live').click();
  await expect(page.locator('#game-box .declarative-hint-message,.declarative-zoom-controls')).toHaveCount(0);
  await page.goto(`/static/portal.html#game=${game.id}`);
  const created=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/matches');
  await page.locator('#play-computers').click();const response=await created;expect(response.ok(),await response.text()).toBeTruthy();
  const match=await response.json();
  await expect(page.locator('#game-box .declarative-stage')).toBeVisible();
  for(let i=0;i<8;i++){
    const moving=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/matches/${match.id}/moves`);
    await nextAction(page);const accepted=await moving;expect(accepted.ok()).toBeTruthy();const result=await accepted.json();expect(result.last_move_player_index).toBe(0);await expectOwnMoveAtReferenceSpeed(page,result.move_count,0,accepted.request().postDataJSON()?.move?.action==='move');
  }
  const current=await(await request.get(`/matches/${match.id}`,{headers:auth(user)})).json();
  expect(current.players.filter((player:any)=>player.kind==='computer')).toHaveLength(1);
  expect(current.move_count).toBeGreaterThanOrEqual(8);
  await expect.poll(()=>page.evaluate(()=>(window as any).backgammonAnimationRecords.filter((item:any)=>item.actor_kind==='computer'&&item.actor!==item.viewer).length),{timeout:30000}).toBeGreaterThan(0);
  expect(await page.evaluate(()=>(window as any).backgammonAnimationRecords.filter((item:any)=>item.id?.startsWith('checker_')).every((item:any)=>Number.isInteger(item.actor)&&[400,800].includes(item.duration)))).toBe(true);
  await expect(page.locator('#game-box .declarative-error:visible')).toHaveCount(0);
  await testInfo.attach('backgammon-computer',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
});


test('a device computer reply plays every accepted own and opponent step at reference speed',async({page,request},testInfo)=>{
  test.setTimeout(120000);
  const game=await backgammon(request),full=await(await request.get(`/games/${game.id}/versions/${game.version}`)).json(),user=await createUser(request,uniqueName('Backgammon device actors'));
  await countAnimations(page);await loginAs(page,user);await page.goto(`/static/portal.html#game=${game.id}`);
  const writes:string[]=[];page.on('request',request=>{if(request.method()!=='GET'&&new URL(request.url()).pathname.startsWith('/matches'))writes.push(request.url());});
  await page.evaluate(async game=>{const match=await offline.practice(game,'computer',2);selectMatch(match.id);},full);
  await expect(page.locator('#game-box .declarative-stage')).toBeVisible();
  let mixed:any=null;
  for(let i=0;i<24&&!mixed;i++){
    const before=await page.evaluate(()=>({count:state.match.move_count,rendered:(window as any).backgammonRendered.length,checker:!state.match.state.needRoll}));
    await nextAction(page);
    const after=await page.evaluate(()=>state.match.move_count);
    await expect.poll(()=>page.evaluate(count=>(window as any).backgammonRendered.some((message:any)=>message.host_id===(window as any).backgammonActiveHostId&&message.move_count===count),after),{timeout:30000}).toBe(true);
    if(before.checker&&after>before.count+1){
      mixed=await page.evaluate(({start,before,after})=>({before,after,renders:(window as any).backgammonRendered.slice(start).filter((message:any)=>message.host_id===(window as any).backgammonActiveHostId),animations:(window as any).backgammonAnimationRecords.filter((item:any)=>item.host_id===(window as any).backgammonActiveHostId&&item.move_count>before)}),{start:before.rendered,before:before.count,after});
    }
  }
  expect(mixed).not.toBeNull();
  const own=mixed.renders.findIndex((message:any)=>message.move_count===mixed.before+1&&message.actor===0),
    opponent=mixed.renders.findIndex((message:any)=>message.move_count===mixed.after&&message.actor===1);
  expect(own).toBeGreaterThanOrEqual(0);expect(opponent).toBeGreaterThan(own);
  const counts=[...new Set(mixed.renders.map((message:any)=>message.move_count))];
  for(let count=mixed.before+1;count<=mixed.after;count++)expect(counts).toContain(count);
  expect(mixed.renders.every((message:any)=>message.animate_override!==false)).toBe(true);
  expect(mixed.animations.some((item:any)=>item.actor===0&&item.id?.startsWith('checker_')&&[400,800].includes(item.duration))).toBe(true);
  expect(mixed.animations.some((item:any)=>item.actor===1&&item.actor_kind==='computer'&&item.id?.startsWith('checker_')&&[400,800].includes(item.duration))).toBe(true);
  expect(mixed.animations.filter((item:any)=>item.id?.startsWith('checker_')).every((item:any)=>[400,800].includes(item.duration))).toBe(true);
  expect(writes).toEqual([]);await expect(page.locator('#game-box .declarative-error:visible')).toHaveCount(0);
  await testInfo.attach('device-computer-mixed-actor-evidence',{body:JSON.stringify(mixed),contentType:'application/json'});
});
