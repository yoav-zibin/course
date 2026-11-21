import {test,expect} from '@playwright/test';
import {ensureMatchMenuOpen,createGame,createUser,loginAs,uniqueName} from './helpers';

const headers=(user:any)=>({'X-User-Id':user.id,'X-User-Password':user.password});

test.beforeEach(async({baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Cloud save checks require a disposable loopback server.');
});

for(const source of ['bundled','downloaded'])test(`pass-and-play keeps offline turns through restart and resumes from cloud on another device (${source})`,async({page,request,context,browser,baseURL},info)=>{
  test.setTimeout(90000);
  const owner=await createUser(request,uniqueName('Cloud handoff owner'));
  const stranger=await createUser(request,uniqueName('Cloud handoff stranger'));
  const gameId=source==='downloaded'?await createGame(request,uniqueName('Cloud offline game')):null;
  await loginAs(page,owner);await page.goto(gameId?`/portal#game=${gameId}`:'/portal#local');
  await page.getByRole('button',{name:'Pass and play',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  const id=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('match')!;
  await ensureMatchMenuOpen(page);
  await expect(page.getByText('Saved in the cloud',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Share link',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Join match',exact:true})).toHaveCount(0);
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  for(const cell of [1,4,2])await page.getByRole('button',{name:`Cell ${cell}`,exact:true}).click();
  await expect(page.getByText('Saved locally · waiting to sync',{exact:true})).toBeVisible();
  await expect(page.getByText(/3 moves/)).toBeVisible();
  await page.reload();await ensureMatchMenuOpen(page);
  await expect(page.getByRole('button',{name:'Cell 5',exact:true})).toBeVisible();
  await expect(page.getByText(/3 moves/)).toBeVisible();
  await expect(page.getByText('Saved locally · waiting to sync',{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('offline-private-save.png')});
  await context.setOffline(false);
  await ensureMatchMenuOpen(page);
  await expect(page.getByText('Saved in the cloud',{exact:true})).toBeVisible({timeout:30000});
  const saved=await request.get(`/matches/${id}`,{headers:headers(owner)});
  expect(saved.ok(),await saved.text()).toBeTruthy();
  expect(await saved.json()).toMatchObject({match_kind:'pass_and_play',move_count:3,single_player_state:{move_count:3}});
  expect((await request.get(`/matches/${id}`)).status()).toBe(404);
  expect((await request.get(`/matches/${id}`,{headers:headers(stranger)})).status()).toBe(404);
  expect((await request.post(`/matches/${id}/join`,{headers:headers(stranger)})).ok()).toBeFalsy();
  const other=await browser.newContext({baseURL,viewport:page.viewportSize()!});
  try{
    const second=await other.newPage();await loginAs(second,owner);await second.goto(`/portal#match=${id}`);await ensureMatchMenuOpen(second);
    await expect(second.getByText(/3 moves/)).toBeVisible();
    for(const cell of [5,3])await second.getByRole('button',{name:`Cell ${cell}`,exact:true}).click();
    await expect(second.getByTestId('match-outcome')).toBeVisible();
    await expect(second.getByText('Saved in the cloud',{exact:true})).toBeVisible({timeout:30000});
    const finished=await request.get(`/matches/${id}`,{headers:headers(owner)});
    expect(await finished.json()).toMatchObject({status:'over',move_count:5,single_player_state:{move_count:5}});
    await second.screenshot({path:info.outputPath('cloud-save-another-device.png')});
  }finally{await other.close();}
});

test('computer matches are cloud saved with one owner and no share controls',async({page,request})=>{
  const owner=await createUser(request,uniqueName('Cloud computer owner'));
  await loginAs(page,owner);await page.goto('/portal#local');
  await page.getByRole('button',{name:'Practice with a computer',exact:true}).click();
  await ensureMatchMenuOpen(page);
  await expect(page.getByText('Saved in the cloud',{exact:true})).toBeVisible({timeout:30000});
  const id=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('match')!;
  const response=await request.get(`/matches/${id}`,{headers:headers(owner)});
  expect(response.ok(),await response.text()).toBeTruthy();const match=await response.json();
  expect(match.match_kind).toBe('computer');
  expect(match.players.filter((player:any)=>player.kind==='human').map((player:any)=>player.user_id)).toEqual([owner.id]);
  expect(match.players.some((player:any)=>player.kind==='computer')).toBe(true);
  expect(match.invite_code).toBeNull();
  await expect(page.getByRole('button',{name:'Share link',exact:true})).toHaveCount(0);
  expect((await request.get(`/matches/${id}`)).status()).toBe(404);
});
