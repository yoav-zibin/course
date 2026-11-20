import {test,expect} from '@playwright/test';
import {createGame,createUser,loginAs,uniqueName} from './helpers';

test.beforeEach(async({baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Offline match checks require a disposable loopback server.');
});

test('match names and playable packages download without catalog entries and survive an offline restart',async({page,request,context},info)=>{
  test.setTimeout(90000);
  const name=uniqueName('Offline library game'),gameId=await createGame(request,name);
  const host=await createUser(request,uniqueName('Offline library host'));
  const opponent=await createUser(request,uniqueName('Offline library opponent'));
  const headers={'X-User-Id':host.id,'X-User-Password':host.password};
  const created=await request.post('/matches',{headers,data:{game_id:gameId}});
  expect(created.ok(),await created.text()).toBeTruthy();const match=await created.json();
  const joined=await request.post(`/matches/${match.id}/join`,{headers:{'X-User-Id':opponent.id,'X-User-Password':opponent.password},data:{}});
  expect(joined.ok(),await joined.text()).toBeTruthy();
  const started=await request.post(`/matches/${match.id}/start`,{headers,data:{}});
  expect(started.ok(),await started.text()).toBeTruthy();
  expect(await started.json()).toMatchObject({status:'ongoing',move_count:0,turn_of_player_indices:[0]});

  // None of the visible catalog/library lists can provide this match's title.
  let offline=false;
  const catalogPaths=new Set(['/games','/v2/games','/games/popular','/users/me/recent-games','/users/me/saved-games','/v2/users/me/saved-games']);
  await page.route(url=>catalogPaths.has(url.pathname),route=>{
    if(offline)return route.abort('internetdisconnected');
    const url=new URL(route.request().url());
    return route.fulfill({json:url.pathname.startsWith('/v2/')?{items:[],next_cursor:null}:[]});
  });
  await loginAs(page,host);await page.goto('/portal#matches');
  await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
  const cardTitle=page.getByTestId(`match-card-${match.id}`).getByRole('heading',{name:`${name} against ${opponent.display_name}`,exact:true});
  await expect(cardTitle).toBeVisible({timeout:30000});

  const downloaded=()=>page.evaluate(({userId,matchId,gameId,version})=>{
    const key=Object.keys(localStorage).find(key=>key.startsWith('buildplay.shared.v1.')&&key.endsWith(`.${userId}`));
    const data=key?JSON.parse(localStorage.getItem(key)!):null,responses=data?.responses||{};
    const snapshot=responses[`/matches/${matchId}`],game=responses[`/games/${gameId}/versions/${version}`];
    return {
      indexed:Array.isArray(responses['/matches'])&&responses['/matches'].some((item:any)=>item.id===matchId),
      snapshot:!!snapshot&&Object.hasOwn(snapshot,'state')&&snapshot.move_count===0,
      package:game?.id===gameId&&game.version===version&&!!game.server_code&&!!game.declarative_ui,
      name:responses['/portal/match-games']?.[`${gameId}@${version}`]?.name,
      catalogHasGame:(responses['/games']||[]).some((item:any)=>item.id===gameId),
    };
  },{userId:host.id,matchId:match.id,gameId,version:match.game_version});
  await expect.poll(downloaded,{timeout:30000}).toEqual({indexed:true,snapshot:true,package:true,name,catalogHasGame:false});
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);

  offline=true;await context.setOffline(true);await page.reload();
  await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
  await expect(cardTitle).toBeVisible();
  await page.getByRole('button',{name:'Open match',exact:true}).click();
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Cell 1',exact:true}).click();
  await expect(page.getByText(/Your move is saved and waiting for server confirmation/)).toBeVisible();
  const queued=()=>page.evaluate(({userId,matchId,gameId,version})=>{
    const key=Object.keys(localStorage).find(key=>key.startsWith('buildplay.shared.v1.')&&key.endsWith(`.${userId}`));
    const data=key?JSON.parse(localStorage.getItem(key)!):null;
    return {moves:data?.queues?.[matchId]?.map((item:any)=>item.body),packageSaved:!!data?.responses?.[`/games/${gameId}/versions/${version}`]?.server_code};
  },{userId:host.id,matchId:match.id,gameId,version:match.game_version});
  await expect.poll(queued).toEqual({moves:[{move:{cell:0},expected_move_count:0}],packageSaved:true});
  await page.reload();
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  await expect(page.getByText(/Your move is saved and waiting for server confirmation/)).toBeVisible();
  await expect.poll(queued).toEqual({moves:[{move:{cell:0},expected_move_count:0}],packageSaved:true});
  await page.screenshot({path:info.outputPath('downloaded-offline-match.png')});
});
