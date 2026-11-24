import {test,expect,type Page} from '@playwright/test';
import {ensureMatchMenuOpen,ensureMatchMenuClosed,createUser,loginAs,uniqueName} from './helpers';

test.beforeEach(async({baseURL,page,request})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Practice checks require a disposable loopback server.');
  await loginAs(page,await createUser(request,uniqueName('Practice owner')));
  // These renderer/seat fixtures deliberately have no catalog records. Keep the
  // cloud transport explicit; real persistence is covered by cloud-single-player.
  const cloud=new Map<string,any>();
  await page.route('**/matches/single-player-sync',async route=>{
    const body=route.request().postDataJSON(),snapshot=body.match;
    const fields=['id','game_id','game_version','owner_user_id','match_kind','players','status','state','turn_of_player_indices','move_count','created_at','end_reason','last_move_player_index'];
    const saved={...Object.fromEntries(fields.filter(key=>key in snapshot).map(key=>[key,snapshot[key]])),
      updated_at:snapshot.created_at,cloud_revision:body.expected_revision+1,single_player_state:snapshot,
      invite_code:null,bet_per_player:0,max_loss:0,token_pot:0,token_payouts:null,rematch_match_id:null};
    cloud.set(snapshot.id,saved);await route.fulfill({json:saved});
  });
  await page.route(url=>/^\/matches\/local-[\w-]+$/.test(url.pathname),async route=>{
    const saved=cloud.get(new URL(route.request().url()).pathname.split('/').at(-1)!);
    if(saved&&route.request().method()==='GET')await route.fulfill({json:saved});else await route.continue();
  });
  await page.route(url=>url.pathname==='/matches',route=>route.fulfill({json:[...cloud.values()].map(({state,single_player_state,last_move_player_index,...summary})=>summary)}));
});

// A private host fixture: one round in seat order, with a private viewer marker.
// This exercises the ordinary local controls, never a production game or audit.
const fixture={id:'practice-seat-fixture',version:1,name:'Practice seat fixture',description:'Local player-count and seat regression fixture.',allowed_player_counts:[2,4],renderer_type:'declarative',all_state_public:false,
  server_code:`const game={
    newMatch(ctx){return {state:{turn:0,winner:-1,done:false},turn:[ctx.players[0].id]};},
    applyMove(s,id,m,ctx){if(id!==ctx.players[s.turn].id||m.go!==true)throw new InvalidMove('Wrong player');s.turn++;s.done=s.turn===ctx.players.length;if(s.done)s.winner=ctx.players.length-1;return {state:s,turn:s.done?null:[ctx.players[s.turn].id]};},
    viewFor(s,id,ctx){return {...s,private_for:id};},computerMove(){return {go:true};}
  };`,
  declarative_ui:{format:'buildplay-ui',version:1,viewport:{width:400,height:300},boards:[{id:'board',kind:'zone',x:0,y:0,width:400,height:300}],piece_types:{token:{shape:'circle',width:64,height:64}},
    ui_code:`const gameUI={reduce(message){const m=message.type==='ui_event'?message.state_changed:message;const active=m.status==='ongoing'&&!m.replay&&m.acting_for_player_index!==null;return {scene:{labels:[{id:'viewer',x:20,y:30,text:'Your seat '+(m.my_player_index+1),font_size:20},{id:'private',x:20,y:65,text:'Hand belongs to '+m.state.private_for,font_size:16}],controls:active?[{id:'advance',kind:'button',label:'Advance'}]:[]},...(message.type==='ui_event'&&active?{make_move:{go:true}}:{})};}};`}};

async function savedMatch(page:Page,id:string){
  return page.evaluate(matchId=>{
    const key=Object.keys(localStorage).find(key=>key.startsWith('buildplay.shared.v1.')&&key.endsWith('.'+localStorage.getItem('game-platform.current-account.v1')));
    return key?JSON.parse(localStorage.getItem(key)!).local[matchId]:null;
  },id);
}

async function reloadMatch(page:Page,id:string){
  // The restored board appears before bootstrap finishes its route selection.
  // Observe that read and the first ordinary refresh before exercising controls.
  let reads=0;
  const refreshed=page.waitForResponse(response=>response.request().method()==='GET'
    &&new URL(response.url()).pathname===`/matches/${id}`&&response.ok()&&++reads===2);
  await page.reload();await (await refreshed).finished();
  await ensureMatchMenuOpen(page);
  await expect(page.getByTestId('header-matches')).toHaveAttribute('aria-current','page');
  await ensureMatchMenuClosed(page);
}

async function randomSeat(page:Page,value:number){
  // Only host selection is deterministic; sandboxed game randomness is intact.
  await page.addInitScript(value=>{if(window===window.top)Math.random=()=>value;},value);
}

test('game details order the three play cards and keep variable player counts independent',async({page})=>{
  await page.route(url=>/^\/games\/practice-seat-fixture(?:\/versions\/1)?$/.test(url.pathname),route=>route.fulfill({json:fixture}));
  await page.goto('/portal#game=practice-seat-fixture');
  const cards=page.locator('[data-testid="play-computer"], [data-testid="play-online"], [data-testid="play-pass"]');
  await expect(cards).toHaveCount(3);
  expect(await cards.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-testid')))).toEqual(['play-computer','play-online','play-pass']);
  for(const [id,title] of [['play-computer','Play against the computer'],['play-online','Multiplayer'],['play-pass','Pass and play']]){
    await expect(page.getByTestId(id).getByRole('heading',{name:title,exact:true})).toBeVisible();
    await expect(page.getByTestId(id).getByRole('button',{name:id==='play-online'?'Invite your friends to play':title,exact:true})).toBeVisible();
  }
  const computer=page.getByTestId('play-computer'),pass=page.getByTestId('play-pass');
  await expect(page.getByText('Your seat against computers',{exact:true})).toHaveCount(0);
  await computer.getByRole('button',{name:'Players: 4',exact:true}).click();
  await expect(computer.getByRole('button',{name:'Players: 4',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(computer.getByRole('button',{name:'Players: 2',exact:true})).toHaveAttribute('aria-pressed','false');
  await expect(pass.getByRole('button',{name:'Players: 2',exact:true})).toHaveAttribute('aria-pressed','true');
  await pass.getByRole('button',{name:'Players: 4',exact:true}).click();
  await computer.getByRole('button',{name:'Players: 2',exact:true}).click();
  await expect(pass.getByRole('button',{name:'Players: 4',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(computer.getByRole('button',{name:'Players: 2',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('fixed-count and solo details hide player selectors and solo omits computer play',async({page})=>{
  const fixed={...fixture,id:'practice-fixed',allowed_player_counts:[2]},solo={...fixture,id:'practice-solo',allowed_player_counts:[1]};
  await page.route(url=>/^\/games\/practice-(?:fixed|solo)(?:\/versions\/1)?$/.test(url.pathname),route=>route.fulfill({json:new URL(route.request().url()).pathname.includes('practice-solo')?solo:fixed}));
  await page.goto('/portal#game=practice-fixed');
  await expect(page.getByTestId('play-computer')).toBeVisible();await expect(page.getByTestId('play-pass')).toBeVisible();
  await expect(page.getByRole('button',{name:/^Players: /})).toHaveCount(0);
  await page.goto('/portal#game=practice-solo');
  await expect(page.getByTestId('play-computer')).toHaveCount(0);
  await expect(page.getByRole('button',{name:/^Players: /})).toHaveCount(0);
  const local=page.getByTestId('play-pass');
  await expect(local.getByRole('heading',{name:'Single player',exact:true})).toBeVisible();
  await local.getByRole('button',{name:'Start game',exact:true}).click();
  await expect(page.getByRole('button',{name:'Advance',exact:true})).toBeVisible();
});

test('computer batch playback keeps the full host queue outside the twelve-entry reducer history',async({page})=>{
  const batch={...fixture,id:'practice-batch',server_code:`const game={
    newMatch(ctx){return {state:{n:0,seat:0,left:0},turn:[ctx.players[0].id]};},
    applyMove(s,id,m,ctx){if(id!==ctx.players[s.seat].id||m.go!==true)throw new InvalidMove('Wrong player');s.n++;s.left--;if(s.seat===0||s.left===0){s.seat=(s.seat+1)%ctx.players.length;s.left=4;}return {state:s,turn:[ctx.players[s.seat].id]};},
    viewFor(s,id){return {...s,private_for:id};},computerMove(){return {go:true};}
  };`,declarative_ui:{...fixture.declarative_ui,motion:{move_ms:120},ui_code:`const gameUI={reduce(message){const m=message.type==='ui_event'?message.state_changed:message;return {scene:{pieces:[{id:'token',type:'token',board:'board',position:{x:40+(m.view.n%8)*40,y:140},aria_label:'Batch token',actions:[]}],labels:[{id:'step',x:10,y:30,text:'Accepted step '+m.view.n},{id:'history',x:10,y:65,text:'Reducer history '+m.presentation_history.length}],controls:m.acting_for_player_index===0?[{id:'advance',kind:'button',label:'Advance'}]:[]},...(message.type==='ui_event'?{make_move:{go:true}}:{})};}};`}};
  await page.emulateMedia({reducedMotion:'no-preference'});
  await randomSeat(page,0);
  await page.route(url=>/^\/games\/practice-batch(?:\/versions\/1)?$/.test(url.pathname),route=>route.fulfill({json:batch}));
  await page.goto('/portal#game=practice-batch');const computer=page.getByTestId('play-computer');await computer.getByRole('button',{name:'Players: 4',exact:true}).click();
  await computer.getByRole('button',{name:'Play against the computer',exact:true}).click();
  await expect(page.getByText('Accepted step 0',{exact:true})).toBeVisible();
  await page.evaluate(()=>{
    (window as any).__batchPaint=[];
    new MutationObserver(()=>{const labels=[...document.querySelectorAll('[data-testid="game-stage"] svg text')];const n=Number(labels.find(node=>node.textContent?.startsWith('Accepted step '))?.textContent?.slice(14)),history=Number(labels.find(node=>node.textContent?.startsWith('Reducer history '))?.textContent?.slice(16)),seen=(window as any).__batchPaint;if(Number.isInteger(n)&&n!==seen.at(-1)?.n)seen.push({n,history});}).observe(document.body,{subtree:true,childList:true,characterData:true});
  });
  await page.getByRole('button',{name:'Advance',exact:true}).click();
  // Every accepted frame includes the package's settle/turn pause, so the
  // complete ordered batch can outlast the usual five-second UI assertion.
  await expect(page.getByText('Accepted step 13',{exact:true})).toBeVisible({timeout:20000});
  const frames=await page.evaluate(()=>(window as any).__batchPaint as {n:number;history:number}[]);
  expect(frames.filter(frame=>frame.n>=2).map(frame=>frame.n)).toEqual(Array.from({length:12},(_,i)=>i+2));
  expect(frames.every(frame=>frame.history<=12)).toBe(true);
  const id=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('match')!;
  expect((await savedMatch(page,id)).moves).toHaveLength(13);
});

test('pass-and-play replay keeps each private hand attributed to its frame viewer after reload',async({page,isMobile},info)=>{
  await page.route(url=>/^\/games\/practice-seat-fixture(?:\/versions\/1)?$/.test(url.pathname),route=>route.fulfill({json:fixture}));
  await page.goto('/portal#game=practice-seat-fixture');const pass=page.getByTestId('play-pass');await pass.getByRole('button',{name:'Players: 4',exact:true}).click();
  await pass.getByRole('button',{name:'Pass and play',exact:true}).click();await expect(page).toHaveURL(/#match=local-/);
  const id=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('match')!;
  await ensureMatchMenuOpen(page);
  await expect(page.getByText('Saved in the cloud',{exact:true})).toBeVisible();
  await ensureMatchMenuClosed(page);
  for(let seat=0;seat<4;seat++){
    if(seat){
      await expect(page.getByRole('button',{name:'I’m ready',exact:true})).toBeVisible();await expect(page.getByTestId('game-stage')).toHaveCount(0);
      if(seat===1){await reloadMatch(page,id);await expect(page.getByRole('button',{name:'I’m ready',exact:true})).toBeVisible();await expect(page.getByTestId('game-stage')).toHaveCount(0);}
      await page.getByRole('button',{name:'I’m ready',exact:true}).click();
    }
    await expect(page.getByText(`Your seat ${seat+1}`,{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Advance',exact:true}).click();
  }
  await ensureMatchMenuOpen(page);
  await expect(page.getByTestId('match-outcome')).toHaveText('Player 4 won');await reloadMatch(page,id);
  for(let frame=3;frame>=0;frame--){
    const previous=page.getByRole('button',{name:'Previous move',exact:true});
    if(isMobile)await previous.tap();else await previous.click();
    await expect(page.getByText(`Replay · move ${frame} of 4`,{exact:true})).toBeVisible();
    await expect(page.getByText(`Your seat ${frame+1}`,{exact:true})).toBeVisible();
    await expect(page.getByText(`Hand belongs to local-player-${frame}`,{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Advance',exact:true})).toHaveCount(0);
  }
  expect((await savedMatch(page,id)).move_count).toBe(4);
  await page.getByRole('button',{name:'Go to end',exact:true}).click();
  await expect(page.getByText('Your seat 1',{exact:true})).toBeVisible();await ensureMatchMenuOpen(page);await expect(page.getByTestId('match-outcome')).toHaveText('Player 4 won');
  await page.screenshot({path:info.outputPath('pass-replay-private-view.png'),fullPage:true});
});

for(const count of [2,4])for(const humanSeat of [0,count-1])test(`computer practice retains randomly chosen seat ${humanSeat+1} of ${count} through replay and chooses again for a rematch`,async({page},info)=>{
  await randomSeat(page,humanSeat===0?0:0.999999);
  await page.route(url=>/^\/games\/practice-seat-fixture(?:\/versions\/1)?$/.test(url.pathname),route=>route.fulfill({json:fixture}));
  await page.goto('/portal#game=practice-seat-fixture');
  await expect(page.getByRole('heading',{name:fixture.name,exact:true})).toBeVisible();
  const computer=page.getByTestId('play-computer');
  await computer.getByRole('button',{name:`Players: ${count}`,exact:true}).click();
  await expect(page.getByRole('button',{name:/^Your seat against computers:/})).toHaveCount(0);
  await computer.getByRole('button',{name:'Play against the computer',exact:true}).click();
  await expect(page).toHaveURL(/#match=local-/);const id=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('match')!;
  await expect(page.getByText(`Your seat ${humanSeat+1}`,{exact:true})).toBeVisible();
  const opened=await savedMatch(page,id);expect(opened.players).toHaveLength(count);expect(opened.players[humanSeat]).toMatchObject({kind:'human',user_id:opened.owner_user_id});
  expect(opened.move_count).toBe(humanSeat);expect(opened.state.private_for).toBe(`local-player-${humanSeat}`);
  await page.getByRole('button',{name:'Advance',exact:true}).click();
  await ensureMatchMenuOpen(page);
  await expect(page.getByTestId('match-outcome')).toHaveText(humanSeat===count-1?'You won':'You lost');
  expect((await savedMatch(page,id)).move_count).toBe(count);
  await reloadMatch(page,id);await ensureMatchMenuOpen(page);await expect(page.getByTestId('match-outcome')).toHaveText(humanSeat===count-1?'You won':'You lost');
  expect((await savedMatch(page,id)).players[humanSeat].kind).toBe('human');
  await ensureMatchMenuClosed(page);await page.getByRole('button',{name:'Previous move',exact:true}).click();await expect(page.getByText(`Replay · move ${count-1} of ${count}`,{exact:true})).toBeVisible();
  await expect(page.getByText(`Your seat ${humanSeat+1}`,{exact:true})).toBeVisible();
  await expect(page.getByText(`Hand belongs to local-player-${humanSeat}`,{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Advance',exact:true})).toHaveCount(0);expect((await savedMatch(page,id)).move_count).toBe(count);
  await page.getByRole('button',{name:'Go to end',exact:true}).click();
  const rematchSeat=humanSeat===0?count-1:0;
  await page.evaluate(value=>{Math.random=()=>value;},rematchSeat===0?0:0.999999);
  await ensureMatchMenuOpen(page);
  await page.getByRole('button',{name:'Play again',exact:true}).click();
  await expect(page).not.toHaveURL(new RegExp(`#match=${id}$`));await expect(page.getByRole('button',{name:'Advance',exact:true})).toBeVisible();
  const nextId=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('match')!,next=await savedMatch(page,nextId);
  expect(next.players).toHaveLength(count);expect(next.players.filter((player:any)=>player.kind==='human')).toHaveLength(1);
  expect(next.players[rematchSeat]).toMatchObject({kind:'human',user_id:next.owner_user_id});expect(next.move_count).toBe(rematchSeat);
  await expect(page.getByText(`Your seat ${rematchSeat+1}`,{exact:true})).toBeVisible();
  await expect(page.getByText(`Hand belongs to local-player-${rematchSeat}`,{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('computer-practice-seat.png'),fullPage:true});
});

for(const portable of [false,true])test(`Play again from a finished cloud computer match starts playable computer seats (${portable?'portable save':'legacy detail'})`,async({page},info)=>{
  await randomSeat(page,0.999999);
  const originalId='finished-cloud-computer',created='2026-01-01T00:00:00Z';
  let original:any;const rematchRequests:string[]=[];
  await page.route(url=>/^\/games\/practice-seat-fixture(?:\/versions\/1)?$/.test(url.pathname),route=>route.fulfill({json:fixture}));
  await page.route(url=>url.pathname===`/matches/${originalId}`,async route=>{
    const owner=route.request().headers()['x-user-id'];
    const players=[{id:owner,user_id:owner,player_index:0,kind:'human',active:true,name:'Original owner'},
      {id:'original-computer',user_id:null,player_index:1,kind:'computer',active:true,name:'Computer 2'}];
    const state={turn:2,winner:1,done:true,private_for:owner};
    const snapshot={id:originalId,game_id:fixture.id,game_version:1,owner_user_id:owner,match_kind:'computer',localMode:'computer',
      players,status:'over',state,logicState:state,practiceSeed:1,moves:[],initialState:state,initialTurn:[0],
      turn_of_player_indices:null,move_count:0,created_at:created,awaitingHandoff:false};
    original={...snapshot,localMode:undefined,cloud_revision:portable?1:0,single_player_state:portable?snapshot:null};
    await route.fulfill({json:original});
  });
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.endsWith('/rematch'))rematchRequests.push(request.url());});
  await page.goto(`/portal#match=${originalId}`);
  await ensureMatchMenuOpen(page);
  await expect(page.getByTestId('match-outcome')).toBeVisible();
  await expect(page.getByRole('button',{name:'Play again',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Play again',exact:true}).click();
  await expect(page).toHaveURL(/#match=local-/);
  await expect(page.getByRole('button',{name:'Advance',exact:true})).toBeVisible();
  await expect(page.getByText('Your seat 2',{exact:true})).toBeVisible();
  await expect(page.getByText('Waiting for players',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Share link',exact:true})).toHaveCount(0);
  const nextId=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('match')!;
  const next=await savedMatch(page,nextId);
  expect(next).toMatchObject({match_kind:'computer',status:'ongoing',move_count:1,turn_of_player_indices:[1]});
  expect(next.players.filter((player:any)=>player.kind==='human')).toHaveLength(1);
  expect(next.players[1]).toMatchObject({kind:'human',user_id:original.owner_user_id});
  expect(next.players[0].kind).toBe('computer');expect(nextId).not.toBe(originalId);
  await ensureMatchMenuOpen(page);
  await expect(page.getByText('Saved in the cloud',{exact:true})).toBeVisible();
  await reloadMatch(page,nextId);await expect(page.getByRole('button',{name:'Advance',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Advance',exact:true}).click();
  await ensureMatchMenuOpen(page);
  await expect(page.getByTestId('match-outcome')).toHaveText('You won');
  expect((await savedMatch(page,nextId)).move_count).toBe(2);
  expect(rematchRequests).toEqual([]);
  const retained=await page.evaluate(id=>{
    const key=Object.keys(localStorage).find(key=>key.startsWith('buildplay.shared.v1.')&&key.endsWith('.'+localStorage.getItem('game-platform.current-account.v1')));
    const data=JSON.parse(localStorage.getItem(key!)!);return data.local[id]||data.responses[`/matches/${id}`];
  },originalId);
  expect(retained).toMatchObject({id:originalId,status:'over',players:original.players});
  await page.screenshot({path:info.outputPath('cloud-computer-play-again.png'),fullPage:true});
});
