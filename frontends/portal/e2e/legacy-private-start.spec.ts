import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import {createUser,uniqueName} from './helpers';

const id='legacy-private-computer',gameId='legacy-private-game';
const game={id:gameId,version:1,name:'Legacy computer game',description:'Private waiting-match fixture.',allowed_player_counts:[2],renderer_type:'declarative',all_state_public:true,
  server_code:`const game={newMatch(ctx){return {state:{n:0,seat:0},turn:[ctx.players[0].id]};},applyMove(s,id,m,ctx){if(id!==ctx.players[s.seat].id||!m.advance)throw new InvalidMove('Wrong move');const next={n:s.n+1,seat:1-s.seat};return {state:next,turn:[ctx.players[next.seat].id]};},computerMove(){return {advance:true};},viewFor(s){return s;}};`,
  declarative_ui:{format:'buildplay-ui',version:1,viewport:{width:400,height:200},boards:[{id:'board',kind:'zone',x:0,y:0,width:400,height:200}],piece_types:{token:{shape:'circle',width:40,height:40}},ui_code:`const gameUI={reduce(message){const m=message.type==='ui_event'?message.state_changed:message;return {scene:{labels:[{id:'n',x:20,y:30,text:'Accepted moves '+m.view.n}],controls:m.acting_for_player_index===0?[{id:'advance',kind:'button',label:'Advance'}]:[]},...(message.type==='ui_event'?{make_move:{advance:true}}:{})};}};`}};

async function fixture(page:Page,request:APIRequestContext,isOwner=true){
  const account=await createUser(request,uniqueName('Legacy draft owner'));
  const canonical=account.id+'-canonical';
  await page.addInitScript(account=>{if(window!==window.top)return;localStorage.setItem('game-platform.accounts.v1',JSON.stringify([account]));localStorage.setItem('game-platform.current-account.v1',account.id);},{...account,canonical_user_id:canonical});
  await page.route(url=>url.pathname===`/users/${account.id}`,route=>route.fulfill({json:{...account,id:canonical,password:undefined}}));
  const players=[{id:'legacy-human',player_index:0,kind:'human',user_id:canonical,name:'Owner'},{id:'computer-1',player_index:1,kind:'computer',user_id:null}];
  const initial={n:0,seat:0},created='2026-11-20T00:00:00Z';
  let match:any={id,game_id:gameId,game_version:1,match_kind:'computer',owner_user_id:isOwner?canonical:'another-account',players,status:'waiting_for_players',state:null,turn_of_player_indices:null,move_count:0,created_at:created,cloud_revision:1,invite_code:null};
  const starts:string[]=[];
  await page.route(url=>new RegExp(`^/games/${gameId}(?:/versions/1)?$`).test(url.pathname)||url.pathname===`/matches/${id}/game`,route=>route.fulfill({json:game}));
  await page.route(url=>url.pathname===`/matches/${id}`,route=>route.fulfill({json:match}));
  await page.route(url=>url.pathname==='/matches',route=>route.fulfill({json:[match]}));
  await page.route(url=>url.pathname===`/matches/${id}/start`,async route=>{
    expect(route.request().method()).toBe('POST');starts.push(route.request().headers()['x-user-id']);
    const snapshot={...match,status:'ongoing',localMode:'computer',state:initial,logicState:initial,practiceSeed:123,initialState:initial,initialTurn:[0],moves:[],turn_of_player_indices:[0]};
    match={...match,status:'ongoing',state:initial,turn_of_player_indices:[0],cloud_revision:2,single_player_state:snapshot};
    await route.fulfill({json:match});
  });
  return {account,starts};
}

test.beforeEach(async({baseURL})=>{if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Legacy-match checks require a disposable loopback server.');});

test('canonical owner explicitly starts a preserved private computer draft and continues offline',async({page,request,context,isMobile})=>{
  const {account,starts}=await fixture(page,request);
  await page.goto(`/portal#match=${id}`);
  const start=page.getByRole('button',{name:'Start match',exact:true});await expect(start).toBeEnabled();
  await expect(page.getByText('Ready to start with 2 players.',{exact:true})).toBeVisible();
  await expect(page.getByTestId('game-stage')).toHaveCount(0);
  for(const name of ['Join match','Share link','Copy code'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
  expect(starts).toEqual([]);
  if(isMobile)await start.tap();else await start.click();
  await expect(page.getByRole('button',{name:'Advance',exact:true})).toBeVisible();
  expect(starts).toEqual([account.id]);await expect(start).toHaveCount(0);
  await context.setOffline(true);
  await page.getByRole('button',{name:'Advance',exact:true}).click();
  await expect(page.getByText('Accepted moves 2',{exact:true})).toBeVisible();
  await expect(page.getByText('Saved locally · waiting to sync',{exact:true})).toBeVisible();
});

test('another account cannot start a cached private draft',async({page,request})=>{
  const {starts}=await fixture(page,request,false);await page.goto(`/portal#match=${id}`);
  await expect(page.getByText('Private to your account',{exact:true})).toBeVisible();
  for(const name of ['Start match','Join match','Share link'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
  await expect(page.getByTestId('game-stage')).toHaveCount(0);expect(starts).toEqual([]);
});
