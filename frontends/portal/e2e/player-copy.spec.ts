import {test,expect,type Page} from '@playwright/test';
import {createGame,createUser,E2E_ADMIN_CREDENTIALS,loginAs,uniqueName} from './helpers';

test.beforeEach(async({baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Player copy checks require a disposable loopback server.');
});

async function cachedName(page:Page,gameId:string,version:number){
  return page.evaluate(({gameId,version})=>{
    for(const key of Object.keys(localStorage).filter(key=>key.startsWith('buildplay.shared.v1.'))){
      const game=JSON.parse(localStorage.getItem(key)!).responses?.[`/games/${gameId}/versions/${version}`];
      if(game)return {name:game.name,id:game.id,version:game.version};
    }
    return null;
  },{gameId,version});
}

test('account settings omit the player code while profile editing and notification controls remain available',async({page,request},info)=>{
  const user=await createUser(request,'Account copy player');
  const headers={'X-User-Id':user.id,'X-User-Password':user.password};
  const response=await request.get(`/users/${user.id}`,{headers});expect(response.ok()).toBeTruthy();
  const profile=await response.json();expect(profile.referral_code).toBeTruthy();
  await loginAs(page,user);await page.goto('/portal');
  await page.getByTestId('header-account').click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('heading',{name:'Your account',exact:true})).toBeVisible();
  await expect(dialog.getByRole('heading',{name:user.display_name,exact:true})).toBeVisible();
  await expect(dialog).not.toContainText('Your player code');
  await expect(dialog).not.toContainText(profile.referral_code);
  await expect(dialog.getByRole('heading',{name:'Push notifications',exact:true})).toBeVisible();
  await expect(dialog.getByRole('switch',{name:'Push notifications',exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Log out',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Edit profile',exact:true}).click();
  const nextName='Updated account copy player';
  await dialog.getByRole('textbox',{name:'Display name',exact:true}).fill(nextName);
  await dialog.getByRole('button',{name:'Save',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:nextName,exact:true})).toBeVisible();
  await expect(dialog).not.toContainText('Your player code');
  const saved=await request.get(`/users/${user.id}`,{headers});expect(saved.ok()).toBeTruthy();
  expect(await saved.json()).toMatchObject({id:user.id,display_name:nextName,referral_code:profile.referral_code});
  await page.screenshot({path:info.outputPath('account-without-player-code.png')});
});

test('legacy title tags stay hidden for cached pinned matches after the catalog name changes',async({page,request},info)=>{
  test.setTimeout(90000);
  const name=uniqueName('Legacy game title'),rawName=`${name} (Declarative)`,gameId=await createGame(request,rawName);
  const originalResponse=await request.get(`/games/${gameId}/versions/1`);expect(originalResponse.ok()).toBeTruthy();
  const original=await originalResponse.json();expect(original.name).toBe(rawName);
  const host=await createUser(request,'Legacy title host'),opponent=await createUser(request,'Legacy title opponent');
  const headers={'X-User-Id':host.id,'X-User-Password':host.password};
  const created=await request.post('/matches',{headers,data:{game_id:gameId}});expect(created.ok(),await created.text()).toBeTruthy();
  const match=await created.json();
  const joined=await request.post(`/matches/${match.id}/join`,{headers:{'X-User-Id':opponent.id,'X-User-Password':opponent.password},data:{}});expect(joined.ok(),await joined.text()).toBeTruthy();
  const started=await request.post(`/matches/${match.id}/start`,{headers,data:{}});expect(started.ok(),await started.text()).toBeTruthy();
  await loginAs(page,host);await page.goto(`/portal#match=${match.id}`);
  await expect(page.getByTestId('game-stage')).toBeVisible();
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:rawName,exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  await expect.poll(()=>cachedName(page,gameId,1)).toEqual({id:gameId,version:1,name:rawName});

  // Only a disposable fixture is renamed through the required PATCH contract.
  const updated=await request.patch(`/games/${gameId}`,{data:{name,game_addition_request_id_and_secret:E2E_ADMIN_CREDENTIALS.password}});
  expect(updated.status(),await updated.text()).toBe(200);expect((await updated.json()).version).toBe(2);
  await page.route(`**/games/${gameId}/versions/1`,route=>route.abort());
  await page.reload();
  await expect(page.getByTestId('game-stage')).toBeVisible();
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:rawName,exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  await expect.poll(()=>cachedName(page,gameId,1)).toEqual({id:gameId,version:1,name:rawName});
  const pinned=await request.get(`/games/${gameId}/versions/1`);expect(pinned.ok()).toBeTruthy();
  expect(await pinned.json()).toEqual(original);
  const current=await request.get(`/matches/${match.id}`,{headers});expect(current.ok()).toBeTruthy();
  expect(await current.json()).toMatchObject({id:match.id,game_id:gameId,game_version:1,status:'ongoing',move_count:0});
  await page.screenshot({path:info.outputPath('legacy-pinned-title.png')});
});
