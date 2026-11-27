import {test,expect,type Page} from '@playwright/test';
import {createGame,createUser,loginAs,uniqueName} from './helpers';

async function sharedSaves(page:Page){
  return page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(key=>key.startsWith('buildplay.shared.v1.')).map(key=>[key,localStorage.getItem(key)])));
}
async function credentialSaves(page:Page){
  return page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(key=>/^game-platform\.(?:accounts|current-account)\./.test(key)).map(key=>[key,localStorage.getItem(key)])));
}
const storageErrors=/quota|storage|disk|permission|denied|Could not save downloaded data|Saved data needs attention/i;

for(const fault of ['quota','cleanup-denied'] as const)test(`${fault}: cache failures do not block navigation or an authoritative move`,async({page,request,context,baseURL},info)=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Storage quota checks require a disposable loopback server.');
  const name=uniqueName('Quota navigation game'),gameId=await createGame(request,name),user=await createUser(request,'Quota navigation player');
  const headers={'X-User-Id':user.id,'X-User-Password':user.password};
  const created=await request.post('/matches',{headers,data:{game_id:gameId}});
  expect(created.ok(),await created.text()).toBeTruthy();const match=await created.json();
  const opponent=await createUser(request,'Quota navigation opponent');
  const joined=await request.post(`/matches/${match.id}/join`,{headers:{'X-User-Id':opponent.id,'X-User-Password':opponent.password},data:{}});
  expect(joined.ok(),await joined.text()).toBeTruthy();
  const started=await request.post(`/matches/${match.id}/start`,{headers,data:{}});
  expect(started.ok(),await started.text()).toBeTruthy();const startedMatch=await started.json();expect(startedMatch.status).toBe('ongoing');
  const ownerSeat=startedMatch.players.find((player:any)=>player.user_id===user.id).player_index;
  expect(startedMatch.turn_of_player_indices).toContain(ownerSeat);
  await loginAs(page,user);await page.goto('/portal#local');
  await page.getByRole('button',{name:'Pass and play',exact:true}).click();
  // Make real pending progress before exhausting persistence. The same page
  // remains open, so downloaded rules can continue to execute offline.
  await context.setOffline(true);
  await page.getByRole('button',{name:'Cell 1',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible();
  // Bootstrap and a real local move have finished. Only the shared game store
  // is now full; account credentials and unrelated browser storage still work.
  // Capture the baseline and install the fault in one synchronous browser task
  // so a cloud acknowledgement cannot write between these two operations.
  const original=await page.evaluate(fault=>{
    const cleanupKey='game-platform.i18n-bundle.v1:quota-cleanup';
    if(fault==='cleanup-denied')localStorage.setItem(cleanupKey,JSON.stringify({recoverable:'old translation download'}));
    const shared=Object.fromEntries(Object.keys(localStorage).filter(key=>key.startsWith('buildplay.shared.v1.')).map(key=>[key,localStorage.getItem(key)]));
    const credentials=Object.fromEntries(Object.keys(localStorage).filter(key=>/^game-platform\.(?:accounts|current-account)\./.test(key)).map(key=>[key,localStorage.getItem(key)]));
    const write=Storage.prototype.setItem,remove=Storage.prototype.removeItem;
    (window as any).__quotaDeniedWrites=0;
    (window as any).__permissionDeniedWrites=0;
    (window as any).__deniedCacheRemovals=0;
    Storage.prototype.removeItem=function(key:string){
      if(this===localStorage&&fault==='cleanup-denied'&&key===cleanupKey){
        (window as any).__deniedCacheRemovals++;
        throw new DOMException('Device cache cleanup permission denied.','SecurityError');
      }
      remove.call(this,key);
    };
    Storage.prototype.setItem=function(key:string,value:string){
      if(this===localStorage&&key.startsWith('buildplay.shared.v1.')){
        if(fault==='cleanup-denied'&&(window as any).__deniedCacheRemovals>0){
          (window as any).__permissionDeniedWrites++;
          throw new DOMException('Device storage permission denied.','SecurityError');
        }
        (window as any).__quotaDeniedWrites++;
        throw new DOMException('The quota has been exceeded.','QuotaExceededError');
      }
      write.call(this,key,value);
    };
    return {shared,credentials};
  },fault);
  expect(Object.values(original.shared).some(value=>Object.values(JSON.parse(value!).local).some((saved:any)=>saved.move_count===1&&saved.cloud_pending===true&&saved.moves?.length===1))).toBe(true);
  const matchPath=`/matches/${match.id}`,versionPath=`/games/${gameId}/versions/${match.game_version}`;
  const matchPackagePath=matchPath+'/game';
  const prefetchedPackage=Object.values(original.shared).some(value=>{
    const game=JSON.parse(value!).responses?.[versionPath];
    return game?.id===gameId&&game.version===match.game_version&&!!game.server_code&&!!game.declarative_ui;
  });
  const downloads:{path:string;status:number}[]=[];
  page.on('response',response=>{const path=new URL(response.url()).pathname;if([matchPath,matchPackagePath,versionPath,`/games/${gameId}`].includes(path))downloads.push({path,status:response.status()});});
  await context.setOffline(false);
  // Fragment navigation stays in the same document, preserving the quota
  // fault and exercising the app's normal browser navigation handler.
  await page.goto(`/portal#match=${match.id}`);
  await expect(page.getByTestId('game-stage')).toBeVisible();
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  expect(downloads).toContainEqual({path:`/matches/${match.id}`,status:200});
  // A cold match can load its pinned rules in parallel from the match's /game
  // endpoint. Previously downloaded versions also satisfy this same open.
  await expect.poll(()=>prefetchedPackage||downloads.some(item=>
    [versionPath,matchPackagePath].includes(item.path)&&item.status===200)).toBe(true);
  await expect(page.getByText('Loading the match’s saved game version…',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('alert').filter({hasText:storageErrors})).toHaveCount(0);
  expect(await sharedSaves(page)).toEqual(original.shared);expect(await credentialSaves(page)).toEqual(original.credentials);
  const deniedAfterMatch=await page.evaluate(()=>(window as any).__quotaDeniedWrites as number);
  expect(deniedAfterMatch).toBeGreaterThan(0);

  const movePosts:string[]=[];
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname===`/matches/${match.id}/moves`)movePosts.push(request.method());});
  const moved=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/matches/${match.id}/moves`);
  await page.getByRole('button',{name:'Cell 1',exact:true}).click();
  const response=await moved;expect(response.ok(),await response.text()).toBeTruthy();expect((await response.json()).move_count).toBe(1);
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toHaveCount(0);
  const confirmed=await request.get(`/matches/${match.id}`,{headers});expect(confirmed.ok()).toBeTruthy();
  const serverMatch=await confirmed.json();expect(serverMatch.move_count).toBe(1);expect(serverMatch.last_move_player_index).toBe(ownerSeat);
  expect(movePosts).toEqual(['POST']);await expect(page.getByRole('alert').filter({hasText:storageErrors})).toHaveCount(0);
  expect(await sharedSaves(page)).toEqual(original.shared);expect(await credentialSaves(page)).toEqual(original.credentials);
  await page.screenshot({path:info.outputPath(`${fault}-authoritative-move-with-full-storage.png`),fullPage:true});

  await page.goto(`/portal#game=${gameId}`);
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Pass and play',exact:true})).toBeVisible();
  await expect(page.getByTestId('play-online').getByRole('button',{name:'Invite your friends to play',exact:true})).toBeEnabled();
  // The catalog can offer play modes before this package finishes downloading.
  await expect.poll(()=>downloads).toContainEqual({path:`/games/${gameId}`,status:200});
  await expect(page.getByRole('alert').filter({hasText:storageErrors})).toHaveCount(0);
  if(fault==='quota')await expect.poll(()=>page.evaluate(()=>(window as any).__quotaDeniedWrites as number)).toBeGreaterThan(deniedAfterMatch);
  else{
    expect(await page.evaluate(()=>(window as any).__deniedCacheRemovals as number)).toBeGreaterThan(0);
    expect(await page.evaluate(()=>(window as any).__permissionDeniedWrites as number)).toBeGreaterThan(0);
    expect(await page.evaluate(()=>localStorage.getItem('game-platform.i18n-bundle.v1:quota-cleanup'))).toBe(JSON.stringify({recoverable:'old translation download'}));
  }
  expect(await sharedSaves(page)).toEqual(original.shared);expect(await credentialSaves(page)).toEqual(original.credentials);
  await page.screenshot({path:info.outputPath(`${fault}-game-detail-with-full-storage.png`),fullPage:true});
});
