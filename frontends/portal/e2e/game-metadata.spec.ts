import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {ensureMatchMenuOpen,createGame,createUser,E2E_ADMIN_CREDENTIALS,loginAs,uniqueName} from './helpers';

test.beforeEach(async({baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Game metadata checks require a disposable loopback server.');
});

async function cachedPackageIdentity(page:Page,gameId:string,version:number){
  return page.evaluate(({gameId,version})=>{
    for(const key of Object.keys(localStorage).filter(key=>key.startsWith('buildplay.shared.v1.'))){
      const game=JSON.parse(localStorage.getItem(key)!).responses?.[`/games/${gameId}/versions/${version}`];
      if(game)return {id:game.id,version:game.version};
    }
    return null;
  },{gameId,version});
}

async function updateDescription(request:APIRequestContext,gameId:string,description:string){
  const data={description,game_addition_request_id_and_secret:E2E_ADMIN_CREDENTIALS.password};
  let response=await request.patch(`/games/${gameId}`,{data});
  for(let attempt=0;response.status()===429&&attempt<10;attempt++){
    await new Promise(resolve=>setTimeout(resolve,1000));response=await request.patch(`/games/${gameId}`,{data});
  }
  expect(response.status(),await response.text()).toBe(200);return response.json();
}

test('player screens hide game revisions while saved matches retain their exact package',async({page,request},info)=>{
  test.setTimeout(120000);
  const name=uniqueName('Game metadata'),gameId=await createGame(request,name);
  const original=await request.get(`/games/${gameId}`);expect(original.ok()).toBeTruthy();
  const game=await original.json();expect(game.version).toBe(1);
  const host=await createUser(request,'Game metadata player'),opponent=await createUser(request,'Game metadata opponent');
  const headers={'X-User-Id':host.id,'X-User-Password':host.password};
  const created=await request.post('/matches',{headers,data:{game_id:gameId}});
  expect(created.ok(),await created.text()).toBeTruthy();const match=await created.json();expect(match.game_version).toBe(1);
  const joined=await request.post(`/matches/${match.id}/join`,{headers:{'X-User-Id':opponent.id,'X-User-Password':opponent.password},data:{}});
  expect(joined.ok(),await joined.text()).toBeTruthy();
  expect((await joined.json()).game_version).toBe(1);
  await loginAs(page,opponent);
  const detailDownload=page.waitForResponse(response=>new URL(response.url()).pathname===`/games/${gameId}`&&response.status()===200);
  await page.goto(`/portal#game=${gameId}`);
  expect((await(await detailDownload).json()).version).toBe(1);
  await expect(page.getByTestId('play-online')).toBeVisible();
  for(const width of [390,1440]){
    await page.setViewportSize({width,height:900});
    const title=page.getByRole('heading',{name,exact:true}),metadata=title.locator('..');
    await expect(title).toBeVisible();
    await expect(metadata.getByText(game.description,{exact:true})).toBeVisible();
    await expect(metadata.getByText('2 players',{exact:true})).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/\bv\s*1\b|\bversion\s*1\b/i);
    await page.screenshot({path:info.outputPath(`game-detail-metadata-${width}.png`)});
  }
  await expect.poll(()=>cachedPackageIdentity(page,gameId,1)).toEqual({id:gameId,version:1});

  // A later catalog revision must not change the older match's saved package.
  expect((await updateDescription(request,gameId,'Updated catalog wording for a later release.')).version).toBe(2);
  await page.goto(`/portal#match=${match.id}`);
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();await ensureMatchMenuOpen(page);
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/\bv\s*[12]\b|\bversion\s*[12]\b/i);
  await expect.poll(()=>cachedPackageIdentity(page,gameId,1)).toEqual({id:gameId,version:1});
  const preserved=await request.get(`/matches/${match.id}`,{headers});expect(preserved.ok()).toBeTruthy();
  expect(await preserved.json()).toMatchObject({id:match.id,game_id:gameId,game_version:1,status:'ongoing',move_count:0});
  await page.screenshot({path:info.outputPath('pinned-game-metadata.png')});
});
