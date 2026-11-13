import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { createUser, loginAs, uniqueName } from './helpers';

const kinds=['tictactoe','connect4','reversi','nim','mancala','gomoku','hex','domineering','memory','pig'];
const auth=(user:any)=>({'X-User-Id':user.id,'X-User-Password':user.password});

// Real imports and moves, with a disposable local server. The existing local
// JSON-store policy omits Firestore trace recording; all import validators run.
for(const [index,kind] of kinds.entries())test(`declarative ${kind}: submit and finish a two-player portal match`,async({browser,request},testInfo)=>{
  test.setTimeout(360000);
  const payload=JSON.parse(fs.readFileSync(path.resolve(__dirname,`../games/declarative/${kind}.json`),'utf8'));
  const alice=await createUser(request,uniqueName('Declarative Alice'));
  const bob=await createUser(request,uniqueName('Declarative Bob'));
  const catalog=await (await request.get('/games')).json();
  let game=(Array.isArray(catalog)?catalog:catalog.items || []).find((item:any)=>item.name===payload.name&&item.renderer_type==='declarative');
  if(!game){
    payload.game_addition_request_id_and_secret=uniqueName(`declarative-${kind}-secret`);
    let result=await request.post('/games/declarative',{data:payload,timeout:210000});
    for(let i=0;result.status()===429&&i<50;i++){
      await new Promise(resolve=>setTimeout(resolve,1000));
      result=await request.post('/games/declarative',{data:payload,timeout:210000});
    }
    expect(result.status(),await result.text()).toBe(201);game=await result.json();
  }
  const created=await request.post('/matches',{headers:auth(alice),data:{game_id:game.id,num_computer_opponents:0}});
  expect(created.ok(),await created.text()).toBeTruthy();
  const match=await created.json();
  expect((await request.post(`/matches/${match.id}/join`,{headers:auth(bob)})).ok()).toBeTruthy();
  expect((await request.post(`/matches/${match.id}/start`,{headers:auth(alice),data:{}})).ok()).toBeTruthy();
  const contexts=[];const pages=[];const pageErrors:string[]=[];
  for(const user of [alice,bob]){
    const context=await browser.newContext({viewport:index%2?{width:390,height:844}:{width:1280,height:900}});
    contexts.push(context);const page=await context.newPage();pages.push(page);
    page.on('pageerror',error=>pageErrors.push(error.message));
    await loginAs(page,user);await page.goto(`/static/portal.html#match=${match.id}`);
    await expect(page.locator('#game-box .declarative-stage')).toBeVisible();
    await expect(page.locator('#game-box > iframe:visible')).toHaveCount(0);
  }
  const publicMemory=new Map<number,number>();
  let current:any;
  let count=0;
  try {
    for(;count<350;count++){
      current=await (await request.get(`/matches/${match.id}`,{headers:auth(alice)})).json();
      if(current.status==='over')break;
      const seat=current.turn_of_player_indices[0],user=[alice,bob][seat],page=pages[seat];
      const visible=await (await request.get(`/matches/${match.id}`,{headers:auth(user)})).json();
      let options=visible.state.legal;
      expect(options.length).toBeGreaterThan(0);
      let move=options[0];
      if(kind==='pig')move=options.find((option:any)=>option.action===(visible.state.total>=10?'hold':'roll')) || move;
      if(kind==='memory'){
        visible.state.board.forEach((value:number,cell:number)=>{if(value!==-1)publicMemory.set(cell,value);});
        const selected=visible.state.selected,matched=visible.state.matched;
        const single=selected.length===1?selected[0]:null;
        const pairs=options.filter((option:any)=>publicMemory.has(option.cell)&&!matched.includes(option.cell));
        if(single!==null)move=pairs.find((option:any)=>option.cell!==single&&publicMemory.get(option.cell)===publicMemory.get(single)) || options.find((option:any)=>!publicMemory.has(option.cell)) || move;
        else move=pairs.find((option:any)=>pairs.some((other:any)=>other.cell!==option.cell&&publicMemory.get(other.cell)===publicMemory.get(option.cell))) || options.find((option:any)=>!publicMemory.has(option.cell)) || move;
      }
      const id=Object.keys(move).map(key=>`${key}_${move[key]}`).join('_');
      const target=page.locator(`#game-box [data-ui-id="${id}"]`);
      await expect(target).toBeVisible();
      await expect(target).not.toHaveAttribute('aria-disabled','true');
      if(count===0)await testInfo.attach(`${kind}-start`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
      const response=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/matches/${match.id}/moves`);
      await target.click();
      const result=await response;expect(result.ok(),await result.text()).toBeTruthy();
    }
    expect(current?.status,`${kind} should finish via portal controls within 350 moves`).toBe('over');
    expect(count).toBeGreaterThan(0);
    await expect(pages[0].locator('#game-box .declarative-error:visible')).toHaveCount(0);
    await testInfo.attach(`${kind}-finished`,{body:await pages[0].screenshot({fullPage:true}),contentType:'image/png'});
    await testInfo.attach(`${kind}-evidence`,{body:JSON.stringify({kind,game_id:game.id,version:game.version,match_id:match.id,status:current.status,moves:count,viewport:index%2?'390x844':'1280x900',page_errors:pageErrors}),contentType:'application/json'});
    expect(pageErrors).toEqual([]);
  }finally{for(const context of contexts)await context.close();}
});

test('declarative browser engine isolates secrets, rejects loops and keeps text inert',async({page})=>{
  await page.goto('/static/declarative-test.html');
  await expect(page.locator('#preview .declarative-target')).toHaveCount(7);
  const result=await page.evaluate(async()=>{
    const api=(window as any).DeclarativeUI;
    const spec=JSON.parse((document.getElementById('spec') as HTMLTextAreaElement).value);
    const message=JSON.parse((document.getElementById('message') as HTMLTextAreaElement).value);
    const box=document.createElement('div');document.body.append(box);
    const render=(code:string)=>new Promise<any>(resolve=>{
      let host:any;
      spec.ui_code=code;
      host=api.mount(box,spec,{onScene:(scene:any)=>{host.destroy();resolve({scene});},onError:(error:Error)=>{host.destroy();resolve({error:error.message});}});host.send(message);
    });
    const isolation=await render('const gameUI={reduce(){return {scene:{labels:[{id:"probe",text:[typeof localStorage,typeof document,typeof fetch,typeof XMLHttpRequest].join(","),x:0,y:0}]}}}};');
    const loop=await render('const gameUI={reduce(){while(true){}}};');
    let inert='';spec.ui_code='const gameUI={reduce(){return {scene:{labels:[{id:"inert",text:"<img src=x onerror=alert(1)>",x:0,y:0}]}}}};';
    const host=api.mount(box,spec,{onScene:()=>{inert=box.querySelector('text')?.textContent || '';}});await host.send(message);
    const images=box.querySelectorAll('img').length;host.destroy();box.remove();
    return {isolation,loop,inert,images};
  });
  expect(result.isolation.scene.labels[0].text).toBe('undefined,undefined,undefined,undefined');
  expect(result.loop.error).toContain('time limit');
  expect(result.inert).toBe('<img src=x onerror=alert(1)>');expect(result.images).toBe(0);
});

test('declarative authoring page plays the compatibility host and filters hidden state',async({page})=>{
  test.setTimeout(60000);
  await page.goto('/game-test');
  await expect(page.locator('#declarative-example option')).toHaveCount(11);
  await page.locator('#declarative-example').selectOption('/games/declarative/examples/tictactoe');
  await page.locator('#load-declarative-example').click();
  await expect(page.locator('#declarative-spec')).toHaveValue(/buildplay-ui/);
  await page.locator('#new-match').click();
  const host=page.frameLocator('#game-box > iframe');
  await expect(host.locator('.declarative-target')).toHaveCount(9);
  await host.locator('[data-ui-id="cell_0"]').click();
  await expect(host.locator('[data-ui-id="piece_0"]')).toContainText('X');
  await expect.poll(async()=>JSON.parse(await page.locator('#state-out').inputValue()).board[0]).toBe(0);
  await page.locator('#declarative-example').selectOption('/games/declarative/examples/memory');
  await page.locator('#load-declarative-example').click();
  await expect(page.locator('#game-name')).toHaveValue('Memory pairs · Declarative');
  const spec=JSON.parse(await page.locator('#declarative-spec').inputValue());
  spec.ui_code='const gameUI={reduce(message){const m=message.type==="ui_event"?message.state_changed:message;return {scene:{labels:[{id:"privacy",text:JSON.stringify(m.state.board),x:20,y:20}]}}}};';
  await page.locator('#declarative-spec').fill(JSON.stringify(spec));
  await page.locator('#new-match').click();
  await expect(host.locator('text')).toHaveCount(1);
  await expect(host.locator('text')).toHaveText(JSON.stringify(Array(16).fill(-1)));
});

test('declarative local practice survives reload, replay and an offline move',async({page,request,context},testInfo)=>{
  test.setTimeout(60000);
  const user=await createUser(request,uniqueName('Declarative practice'));
  const games=await (await request.get('/games')).json();
  let game=games.find((item:any)=>item.name==='Tic-tac-toe · Declarative');
  const finalPackage=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../games/declarative/tictactoe.json'),'utf8'));
  const current=game?await (await request.get(`/games/${game.id}`)).json():null;
  // A retained local demo may predate an asset/palette edit. Exercise the final
  // submitted source for screenshot evidence without altering the old matches.
  if(!game||current.declarative_ui.piece_types.p0.text_color!==finalPackage.declarative_ui.piece_types.p0.text_color){
    finalPackage.name=uniqueName('Declarative final palette');
    finalPackage.game_addition_request_id_and_secret=uniqueName('declarative-final-palette-secret');
    const imported=await request.post('/games/declarative',{data:finalPackage,timeout:210000});
    expect(imported.ok(),await imported.text()).toBeTruthy();game=await imported.json();
  }
  await loginAs(page,user);
  const writes:string[]=[];
  page.on('request',req=>{if(req.method()!=='GET'&&new URL(req.url()).pathname.startsWith('/matches'))writes.push(req.url());});
  await page.goto(`/static/portal.html?game=${game.id}`);
  await page.locator('#practice').click();
  const stage=page.locator('#game-box .declarative-stage');
  await expect(stage).toBeVisible();
  await expect(page.locator('#game-box')).toHaveCSS('background-color','rgb(16, 35, 48)');
  await page.locator('#game-box [data-ui-id="cell_0"]').click();
  await expect(page.locator('#game-box [data-ui-id="piece_0"]')).toContainText('X');
  await page.locator('#game-box [data-ui-id="cell_1"]').click();
  await expect(page.locator('#game-box [data-ui-id="piece_1"]')).toContainText('O');
  await page.locator('#match-controls-toggle').click();
  await page.locator('#history-back').click();
  await expect(page.locator('#history-position')).toContainText('read only');
  await expect(page.locator('#game-box [role="button"][aria-disabled="false"]')).toHaveCount(0);
  await page.locator('#history-live').click();
  await expect(page.locator('#history-position')).toContainText('Live');
  await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>undefined));
  await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#game-box [data-ui-id="piece_0"]')).toContainText('X');
  await expect(page.locator('#game-box [data-ui-id="piece_1"]')).toContainText('O');
  await page.locator('#game-box [data-ui-id="cell_2"]').click();
  await expect(page.locator('#game-box [data-ui-id="piece_2"]')).toContainText('X');
  expect(writes).toEqual([]);
  if(process.env.DECLARATIVE_EVIDENCE_DIR){
    const output=path.resolve(process.env.DECLARATIVE_EVIDENCE_DIR);fs.mkdirSync(output,{recursive:true});
    await page.screenshot({path:path.join(output,'declarative-practice.png'),fullPage:true});
  }
  await context.setOffline(false);
});

test('declarative covered image pieces render only a declared back asset and inert accessible name',async({page},testInfo)=>{
  await page.goto('/static/declarative-test.html');
  const result=await page.evaluate(async()=>{
    const api=(window as any).DeclarativeUI;
    const spec=JSON.parse((document.getElementById('spec') as HTMLTextAreaElement).value);
    const message=JSON.parse((document.getElementById('message') as HTMLTextAreaElement).value);
    const image='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 60"><rect width="40" height="60" fill="#336699"/></svg>');
    const back='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 60"><rect width="40" height="60" fill="#993366"/></svg>');
    spec.assets={front:{uri:image,media_type:'image/svg+xml'},back:{uri:back,media_type:'image/svg+xml'}};
    spec.piece_types={card:{shape:'image',asset:'front',width:70,height:90}};
    spec.ui_code='const gameUI={reduce(){return {scene:{pieces:[{id:"covered",type:"card",board:"board",position:{cell:"0"},face:"back",text:"Ace of spades"},{id:"hidden",type:"card",board:"board",position:{cell:"1"},hidden:true,text:"King"}]}}}};';
    const box=document.getElementById('preview')!;
    let host=api.mount(box,spec);await host.send(message);
    const generic={images:box.querySelectorAll('image').length,visible:box.textContent,aria:box.querySelector('[data-ui-id="covered"]')?.getAttribute('aria-label'),hidden:box.querySelector('[data-ui-id="hidden"]')!==null};host.destroy();
    spec.piece_types.card.back_asset='back';host=api.mount(box,spec);await host.send(message);
    return {generic,renderedBack:box.querySelector('image')?.getAttribute('href'),expectedBack:back};
  });
  expect(result.generic.images).toBe(0);expect(result.generic.hidden).toBe(false);
  expect(result.generic.visible).not.toContain('Ace');expect(result.generic.aria).toBe('Covered piece');
  expect(result.renderedBack).toBe(result.expectedBack);
  if(process.env.DECLARATIVE_EVIDENCE_DIR){const output=path.resolve(process.env.DECLARATIVE_EVIDENCE_DIR);fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'declarative-covered-card.png'),fullPage:true});}
});

test('declarative piece selection and pointer movement honor targets, transforms and the move gate',async({page})=>{
  await page.goto('/static/declarative-test.html');
  await page.evaluate(async()=>{
    const api=(window as any).DeclarativeUI;
    const box=document.createElement('div');box.id='movement-test';box.style.cssText='position:fixed;inset:0;background:#102330;z-index:9999;';document.body.append(box);
    const spec={format:'buildplay-ui',version:1,viewport:{width:400,height:240},assets:{},boards:[{id:'main',kind:'grid',x:20,y:30,width:360,height:120,rows:1,columns:3}],piece_types:{pawn:{shape:'circle',color:'#a7f070',width:44,height:44}},strings:{},
      ui_code:'const gameUI={reduce(message,localState){const scene={pieces:[{id:"pawn",type:"pawn",board:"main",position:{cell:"0"},text:"P",rotation:45,scale:1.5,draggable:true,move_targets:["legal"]}],targets:[{id:"legal",board:"main",position:{cell:"1"},label:"Legal"},{id:"invalid",board:"main",position:{cell:"2"},label:"Invalid"}],labels:[{id:"event",text:message.type==="ui_event"?message.event.type:"ready",x:20,y:200}]};const result={scene,local_state:{}};if(message.type==="ui_event"&&message.event.type==="drop")result.make_move={from:message.event.piece_id,to:message.event.target_id};return result;}};'};
    (window as any).movementMoves=[];
    const host=api.mount(box,spec,{onMove:(move:any)=>(window as any).movementMoves.push(move)});
    const message={type:'state_changed',state:{},view:{},players:[{player_index:0,player_id:'one',kind:'human',name:'One'}],turn_of_player_indices:[0],my_player_index:0,acting_for_player_index:0,status:'ongoing',move_count:0};
    (window as any).movementHost=host;(window as any).movementMessage=message;await host.send(message);
  });
  const piece=page.locator('#movement-test [data-ui-id="pawn"]');
  const legal=page.locator('#movement-test [data-ui-id="legal"]');
  const invalid=page.locator('#movement-test [data-ui-id="invalid"]');
  await expect(piece).toHaveAttribute('transform','translate(80 90) rotate(45) scale(1.5)');
  await piece.focus();await page.keyboard.press('Enter');
  await expect(page.locator('#movement-test text').last()).toHaveText('tap');
  await legal.focus();await page.keyboard.press('Enter');
  await expect.poll(()=>page.evaluate(()=>(window as any).movementMoves.length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).movementMoves[0])).toEqual({from:'pawn',to:'legal'});
  await expect(legal).toHaveAttribute('aria-disabled','true');
  await invalid.dispatchEvent('click');await legal.dispatchEvent('click');
  expect(await page.evaluate(()=>(window as any).movementMoves.length)).toBe(1);
  await page.evaluate(async()=>{const w=window as any;await w.movementHost.send({...w.movementMessage,move_count:1});});
  const from=(await piece.boundingBox())!,denied=(await invalid.boundingBox())!,allowed=(await legal.boundingBox())!;
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
  await page.mouse.move(denied.x+denied.width/2,denied.y+denied.height/2,{steps:8});await page.mouse.up();
  expect(await page.evaluate(()=>(window as any).movementMoves.length)).toBe(1);
  await piece.dispatchEvent('pointerdown',{pointerId:7,pointerType:'touch',clientX:from.x+from.width/2,clientY:from.y+from.height/2});
  await legal.dispatchEvent('pointerup',{pointerId:7,pointerType:'touch',clientX:allowed.x+allowed.width/2,clientY:allowed.y+allowed.height/2});
  await expect.poll(()=>page.evaluate(()=>(window as any).movementMoves.length)).toBe(2);
  await expect(piece).toHaveAttribute('transform','translate(80 90) rotate(45) scale(1.5)');
  await page.evaluate(()=>(window as any).movementHost.destroy());
});
