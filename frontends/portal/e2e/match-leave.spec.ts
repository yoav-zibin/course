import {test,expect,type APIRequestContext} from '@playwright/test';
import {createGame,createUser,loginAs,uniqueName} from './helpers';

const headers=(user:any)=>({'X-User-Id':user.id,'X-User-Password':user.password});

async function sharedLobby(request:APIRequestContext) {
  const host=await createUser(request,uniqueName('Leave host')),guest=await createUser(request,uniqueName('Leave guest'));
  const name=uniqueName('Leave game'),gameId=await createGame(request,name);
  const created=await request.post('/matches',{headers:headers(host),data:{game_id:gameId}});
  expect(created.ok(),await created.text()).toBeTruthy();const match=await created.json();
  const invitation=await request.post(`/matches/${match.id}/invites`,{headers:headers(host),data:{}});
  expect(invitation.ok(),await invitation.text()).toBeTruthy();const invite=await invitation.json();
  const accepted=await request.post(`/invites/${invite.token}/accept`,{headers:headers(guest)});
  expect(accepted.ok(),await accepted.text()).toBeTruthy();
  return {host,guest,name,match};
}

async function listedMatches(request:APIRequestContext,user:any) {
  const response=await request.get('/matches',{headers:headers(user)});
  expect(response.ok(),await response.text()).toBeTruthy();return response.json();
}

test.beforeEach(async({baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Match leaving acceptance requires a disposable loopback server.');
});

for(const ending of ['played','left'] as const)test(`a guest can leave a finished match after they ${ending} without hiding it from the host`,async({page,request})=>{
  const {host,guest,name,match}=await sharedLobby(request);
  const started=await request.post(`/matches/${match.id}/start`,{headers:headers(host)});
  expect(started.ok(),await started.text()).toBeTruthy();
  if(ending==='played'){
    for(const [index,cell] of [0,3,1,4,2].entries()){
      const moved=await request.post(`/matches/${match.id}/moves`,{headers:headers(index%2?guest:host),data:{move:{cell},expected_move_count:index}});
      expect(moved.ok(),await moved.text()).toBeTruthy();
    }
  }else{
    const preview=await request.post(`/matches/${match.id}/maybeLeave`,{headers:headers(guest)});
    expect(preview.ok(),await preview.text()).toBeTruthy();
    const departed=await request.post(`/matches/${match.id}/playerLeft`,{headers:headers(guest)});
    expect(departed.ok(),await departed.text()).toBeTruthy();const result=await departed.json();
    expect(result.status).toBe('over');expect(result.players.find((player:any)=>player.user_id===guest.id).active).toBe(false);
  }
  expect((await listedMatches(request,guest)).some((item:any)=>item.id===match.id)).toBe(true);
  await loginAs(page,guest);await page.goto(`/portal#match=${match.id}`);
  await expect(page.getByRole('button',{name:'Leave match',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Delete match',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Leave match',exact:true}).click();
  await expect(page.getByText('This removes the match from your list. Other players can still see it.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Preview leaving',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Confirm leaving',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
  await expect(page.getByTestId(`match-card-${match.id}`)).toHaveCount(0);
  expect((await listedMatches(request,guest)).some((item:any)=>item.id===match.id)).toBe(false);
  expect((await listedMatches(request,host)).some((item:any)=>item.id===match.id)).toBe(true);
  const preserved=await request.get(`/matches/${match.id}`,{headers:headers(host)});
  expect(preserved.ok()).toBeTruthy();expect((await preserved.json()).status).toBe('over');
  await page.reload();await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
  await expect(page.getByTestId(`match-card-${match.id}`)).toHaveCount(0);
});

test('the host uses Leave match to close a waiting lobby',async({page,request})=>{
  const {host,guest,name,match}=await sharedLobby(request);
  await loginAs(page,host);await page.goto(`/portal#match=${match.id}`);
  await expect(page.getByRole('button',{name:'Start match',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Delete match',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Leave match',exact:true}).click();
  await expect(page.getByText('Leaving closes this lobby for everyone and refunds any tokens.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Confirm leaving',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
  await expect(page.getByTestId(`match-card-${match.id}`)).toHaveCount(0);
  for(const user of [host,guest])expect((await listedMatches(request,user)).some((item:any)=>item.id===match.id)).toBe(false);
  expect((await request.get(`/matches/${match.id}`,{headers:headers(guest)})).status()).toBe(404);
});
