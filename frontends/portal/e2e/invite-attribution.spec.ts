import {test,expect,type APIRequestContext} from '@playwright/test';
import {createGame,createUser,E2E_ADMIN_HEADERS,uniqueName} from './helpers';
import {verifiedSignInFixtures} from './auth-fixtures';

test.beforeEach(async({baseURL})=>{if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Invite attribution checks require a disposable loopback server.');});
async function lobby(request:APIRequestContext){
  const host=await createUser(request,uniqueName('Invite host')),gameId=await createGame(request,uniqueName('Invite game'));
  const response=await request.post('/matches',{headers:{'X-User-Id':host.id,'X-User-Password':host.password},data:{game_id:gameId}});expect(response.ok(),await response.text()).toBeTruthy();return {host,match:await response.json()};
}
async function inviter(request:APIRequestContext,id:string){const response=await request.get('/admin/invites',{headers:E2E_ADMIN_HEADERS});expect(response.ok()).toBeTruthy();return(await response.json()).users.find((user:any)=>user.id===id)?.invited_by_user_id;}

for(const kind of ['match','invite'] as const)test(`anonymous ${kind} link survives guest signup and credits the match host`,async({page,request})=>{
  const {host,match}=await lobby(request),name=uniqueName('Recruited guest'),calls:{path:string;visitor:string|undefined}[]=[];
  await verifiedSignInFixtures(page,[]);
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(path===`/matches/${match.id}`||path.startsWith('/invites/')||path==='/users')calls.push({path,visitor:request.headers()['x-visitor-id']});});
  await page.goto(kind==='invite'?`/invite/${match.invite_code}`:`/portal#match=${match.id}`);
  if(kind==='invite')await page.getByRole('button',{name:'Log in to join',exact:true}).click();else await page.getByTestId('header-account').click();
  await page.getByRole('button',{name:'Continue with: Guest',exact:true}).click();await page.getByRole('textbox',{name:/Your name|Display name/}).fill(name);
  const created=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/users');
  await page.getByRole('button',{name:'Continue as guest',exact:true}).click();const user=await(await created).json();
  await expect(page.getByTestId('header-account')).toHaveAccessibleDescription(name);
  await expect.poll(()=>inviter(request,user.id)).toBe(host.id);
  const storedMatch=await request.get(`/matches/${match.id}`);const players=(await storedMatch.json()).players;
  if(kind==='invite')await expect.poll(async()=>{const response=await request.get(`/matches/${match.id}`);return(await response.json()).players.some((player:any)=>player.user_id===user.id);}).toBe(true);
  else expect(players.some((player:any)=>player.user_id===user.id)).toBe(false);
  const visitors=calls.map(call=>call.visitor);expect(visitors.length).toBeGreaterThanOrEqual(2);expect(visitors.every(Boolean)).toBe(true);expect(new Set(visitors).size).toBe(1);
  expect((await page.evaluate(()=>JSON.parse(localStorage.getItem('game-platform.accounts.v1')!)))[0]).not.toHaveProperty('referral_code');
});

for(const kind of ['match','invite'] as const)test(`a saved existing account receives attribution after opening an anonymous ${kind} link`,async({page,request})=>{
  const {host,match}=await lobby(request),existing=await createUser(request,uniqueName('Existing recruit'));
  let release!:()=>void,started!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),anonymousStarted=new Promise<void>(resolve=>{started=resolve;});
  const source=kind==='invite'?`/invites/${match.invite_code}`:`/matches/${match.id}`;
  await page.route(`**${source}`,async route=>{
    if(route.request().headers()['x-user-id'])return route.continue();
    const response=await route.fetch();
    started();await gate;await route.fulfill({response});
  });
  await page.addInitScript(account=>{localStorage.setItem('game-platform.accounts.v1',JSON.stringify([account]));localStorage.setItem('game-platform.current-account.v1','visitor');},existing);
  try{
    await page.goto(kind==='invite'?`/invite/${match.invite_code}`:`/portal#match=${match.id}`);await anonymousStarted;
    // The source detail has not returned, so rendered selectedMatch cannot be
    // the account handoff's only source of match/invitation context.
    await page.getByTestId('header-account').click();await page.getByRole('button',{name:`Sign in as ${existing.display_name}`,exact:true}).click();
    await expect(page.getByTestId('header-account')).toHaveAccessibleDescription(existing.display_name);
    await expect.poll(()=>inviter(request,existing.id)).toBe(host.id);
    await expect.poll(()=>page.evaluate(()=>localStorage.getItem('game-platform.invite-match.v1')||localStorage.getItem('game-platform.invite-token.v1'))).toBeNull();
    release();
    await expect.poll(async()=>{const response=await request.get('/admin/conversion-funnel',{headers:E2E_ADMIN_HEADERS,params:{match_id:match.id}});expect(response.ok()).toBeTruthy();return(await response.json()).events.link_opened;}).toBe(1);
  }finally{release();}
});
