import {test,expect,type Page} from '@playwright/test';
import {createGame,createUser,loginAs,uniqueName} from './helpers';

async function sharedSaves(page:Page){
  return page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(key=>key.startsWith('buildplay.shared.v1.')).map(key=>[key,localStorage.getItem(key)])));
}

test('full storage still opens remote matches and game details without changing a saved local game',async({page,request,baseURL},info)=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Storage quota checks require a disposable loopback server.');
  const name=uniqueName('Quota navigation game'),gameId=await createGame(request,name),user=await createUser(request,'Quota navigation player');
  const headers={'X-User-Id':user.id,'X-User-Password':user.password};
  const created=await request.post('/matches',{headers,data:{game_id:gameId}});
  expect(created.ok(),await created.text()).toBeTruthy();const match=await created.json();
  const opponent=await createUser(request,'Quota navigation opponent');
  const joined=await request.post(`/matches/${match.id}/join`,{headers:{'X-User-Id':opponent.id,'X-User-Password':opponent.password},data:{}});
  expect(joined.ok(),await joined.text()).toBeTruthy();
  const started=await request.post(`/matches/${match.id}/start`,{headers,data:{}});
  expect(started.ok(),await started.text()).toBeTruthy();expect((await started.json()).status).toBe('ongoing');
  await loginAs(page,user);await page.goto('/portal#local');
  await page.getByRole('button',{name:'Pass and play',exact:true}).click();
  await page.getByRole('button',{name:'Cell 1',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible();
  const original=await sharedSaves(page);
  expect(Object.values(original).some(value=>Object.values(JSON.parse(value!).local).some((saved:any)=>saved.move_count===1))).toBe(true);
  // Bootstrap and a real local move have finished. Only the shared game store
  // is now full; account credentials and unrelated browser storage still work.
  await page.evaluate(()=>{
    const write=Storage.prototype.setItem;
    (window as any).__quotaDeniedWrites=0;
    Storage.prototype.setItem=function(key:string,value:string){
      if(this===localStorage&&key.startsWith('buildplay.shared.v1.')){
        (window as any).__quotaDeniedWrites++;
        throw new DOMException('The quota has been exceeded.','QuotaExceededError');
      }
      write.call(this,key,value);
    };
  });
  const downloads:{path:string;status:number}[]=[];
  page.on('response',response=>{const path=new URL(response.url()).pathname;if(path===`/matches/${match.id}`||path===`/games/${gameId}`||path===`/games/${gameId}/versions/${match.game_version}`)downloads.push({path,status:response.status()});});
  // Fragment navigation stays in the same document, preserving the quota
  // fault and exercising the app's normal browser navigation handler.
  await page.goto(`/portal#match=${match.id}`);
  await expect(page.getByTestId('game-stage')).toBeVisible();
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  expect(downloads).toContainEqual({path:`/matches/${match.id}`,status:200});
  expect(downloads).toContainEqual({path:`/games/${gameId}/versions/${match.game_version}`,status:200});
  await expect(page.getByText('Loading the match’s saved game version…',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('alert').filter({hasText:/quota|Could not save downloaded data|Saved data needs attention/i})).toHaveCount(0);
  expect(await sharedSaves(page)).toEqual(original);
  const deniedAfterMatch=await page.evaluate(()=>(window as any).__quotaDeniedWrites as number);
  expect(deniedAfterMatch).toBeGreaterThan(0);

  await page.goto(`/portal#game=${gameId}`);
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Pass and play',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/^Create match/})).toBeEnabled();
  expect(downloads).toContainEqual({path:`/games/${gameId}`,status:200});
  await expect(page.getByRole('alert').filter({hasText:/quota|Could not save downloaded data|Saved data needs attention/i})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__quotaDeniedWrites as number)).toBeGreaterThan(deniedAfterMatch);
  expect(await sharedSaves(page)).toEqual(original);
  await page.screenshot({path:info.outputPath('game-detail-with-full-storage.png'),fullPage:true});
});
