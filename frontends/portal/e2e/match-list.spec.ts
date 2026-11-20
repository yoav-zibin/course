import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {createGame,createUser,loginAs,uniqueName} from './helpers';

const headers=(user:any)=>({'X-User-Id':user.id,'X-User-Password':user.password});
async function profile(request:APIRequestContext,user:any){const response=await request.get(`/users/${user.id}`,{headers:headers(user)});expect(response.ok(),await response.text()).toBeTruthy();return response.json();}
async function matchDetail(request:APIRequestContext,id:string,user:any){const response=await request.get(`/matches/${id}`,{headers:headers(user)});expect(response.ok(),await response.text()).toBeTruthy();return response.json();}
async function listed(request:APIRequestContext,user:any){const response=await request.get('/matches',{headers:headers(user)});expect(response.ok(),await response.text()).toBeTruthy();return response.json();}
const card=(page:Page,id:string)=>page.getByTestId(`match-card-${id}`);

test.beforeEach(async({baseURL})=>{if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Match-list checks require a disposable loopback server.');});

test('list Leave previews settlement before confirmation and finished Delete preserves the opponent match',async({page,request,browser,baseURL},info)=>{
  test.setTimeout(60000);
  const host={id:`paid-${info.project.name}-${info.retry}-alice`,password:'paid-match-test-wallet'},guest={id:`paid-${info.project.name}-${info.retry}-bob`,password:'paid-match-test-wallet'};
  const beforeHost=await profile(request,host),beforeGuest=await profile(request,guest);
  expect(beforeHost.token_balance).toBeGreaterThanOrEqual(1);expect(beforeGuest.token_balance).toBeGreaterThanOrEqual(1);
  const name=uniqueName('List settlement'),gameId=await createGame(request,name);
  const created=await request.post('/matches',{headers:headers(host),data:{game_id:gameId,bet_per_player:1}});expect(created.ok(),await created.text()).toBeTruthy();const match=await created.json();
  const joined=await request.post(`/matches/${match.id}/join`,{headers:headers(guest)});expect(joined.ok(),await joined.text()).toBeTruthy();
  const started=await request.post(`/matches/${match.id}/start`,{headers:headers(host)});expect(started.ok(),await started.text()).toBeTruthy();
  const stakedHost=await profile(request,host),stakedGuest=await profile(request,guest);
  expect(stakedHost.token_balance).toBe(beforeHost.token_balance-1);expect(stakedGuest.token_balance).toBe(beforeGuest.token_balance-1);
  await loginAs(page,{...beforeGuest,...guest});await page.goto('/portal#matches');
  const row=card(page,match.id);await expect(row.getByRole('heading',{name:`${name} against ${beforeHost.display_name}`,exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('opponent-names.png')});
  await expect(row.getByRole('button',{name:'Hide from list',exact:true})).toHaveCount(0);await expect(row.getByRole('button',{name:'Delete',exact:true})).toHaveCount(0);
  const mutations:string[]=[];page.on('request',request=>{if(new URL(request.url()).pathname.startsWith(`/matches/${match.id}`)&&!['GET','HEAD'].includes(request.method()))mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);});
  await row.getByRole('button',{name:'Leave',exact:true}).click();await expect(page.getByRole('button',{name:'Preview leaving',exact:true})).toBeVisible();expect(mutations).toEqual([]);
  const firstPreview=page.waitForResponse(response=>new URL(response.url()).pathname===`/matches/${match.id}/maybeLeave`&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Preview leaving',exact:true}).click();expect((await firstPreview).ok()).toBeTruthy();
  await expect(page.getByText('Your payout:',{exact:false})).toBeVisible();await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  const uncommitted=await matchDetail(request,match.id,guest);expect(uncommitted.status).toBe('ongoing');expect(uncommitted.token_pot).toBe(2);expect(uncommitted.players.find((player:any)=>player.user_id===guest.id).active).not.toBe(false);
  expect((await profile(request,host)).token_balance).toBe(stakedHost.token_balance);expect((await profile(request,guest)).token_balance).toBe(stakedGuest.token_balance);
  expect(mutations).toEqual([`POST /matches/${match.id}/maybeLeave`]);
  await row.getByRole('button',{name:'Leave',exact:true}).click();
  const secondPreview=page.waitForResponse(response=>new URL(response.url()).pathname===`/matches/${match.id}/maybeLeave`&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Preview leaving',exact:true}).click();const previewResponse=await secondPreview;expect(previewResponse.ok()).toBeTruthy();const preview=await previewResponse.json();
  await page.getByRole('button',{name:'Confirm leaving',exact:true}).click();await expect(row.getByRole('button',{name:'Delete',exact:true})).toBeVisible();await expect(row.getByRole('button',{name:'Leave',exact:true})).toHaveCount(0);
  const finished=await matchDetail(request,match.id,guest);expect(finished.status).toBe('over');expect(finished.players.find((player:any)=>player.user_id===guest.id).active).toBe(false);
  const afterHost=await profile(request,host),afterGuest=await profile(request,guest);
  expect(afterGuest.token_balance).toBe(stakedGuest.token_balance+preview.pending_leave_payout);expect(afterHost.token_balance+afterGuest.token_balance).toBe(beforeHost.token_balance+beforeGuest.token_balance);
  expect(mutations).toEqual([`POST /matches/${match.id}/maybeLeave`,`POST /matches/${match.id}/maybeLeave`,`POST /matches/${match.id}/playerLeft`]);
  // Compare the same player's filtered view before/after deletion: a departed
  // seat can legitimately receive a different view from the remaining player.
  const opponentBeforeDelete=await matchDetail(request,match.id,host);
  await row.getByRole('button',{name:'Delete',exact:true}).click();await expect(page.getByText('This removes the match from your list. Other players can still see it.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Delete',exact:true}).last().click();await expect(row).toHaveCount(0);
  expect((await listed(request,guest)).some((item:any)=>item.id===match.id)).toBe(false);expect((await listed(request,host)).some((item:any)=>item.id===match.id)).toBe(true);
  const preserved=await matchDetail(request,match.id,host);expect(preserved.state).toEqual(opponentBeforeDelete.state);expect(preserved.players).toEqual(opponentBeforeDelete.players);expect(preserved.token_payouts).toEqual(opponentBeforeDelete.token_payouts);
  await page.reload();await expect(card(page,match.id)).toHaveCount(0);
  const opponentContext=await browser.newContext({baseURL,viewport:page.viewportSize()!});
  try{const opponentPage=await opponentContext.newPage();await loginAs(opponentPage,{...afterHost,...host});await opponentPage.goto('/portal#matches');await expect(card(opponentPage,match.id).getByRole('heading',{name:`${name} against ${beforeGuest.display_name}`,exact:true})).toBeVisible();}finally{await opponentContext.close();}
});

test('list Leave frees a waiting guest seat while preserving the host lobby',async({page,request})=>{
  const host=await createUser(request,uniqueName('List lobby host')),guest=await createUser(request,uniqueName('List lobby guest')),gameId=await createGame(request,uniqueName('List lobby'));
  const created=await request.post('/matches',{headers:headers(host),data:{game_id:gameId}});expect(created.ok()).toBeTruthy();const match=await created.json();
  const joined=await request.post(`/matches/${match.id}/join`,{headers:headers(guest)});expect(joined.ok()).toBeTruthy();
  await loginAs(page,guest);await page.goto('/portal#matches');const row=card(page,match.id);await row.getByRole('button',{name:'Leave',exact:true}).click();
  await expect(page.getByRole('button',{name:'Preview leaving',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Confirm leaving',exact:true}).click();await expect(row).toHaveCount(0);
  const remaining=await matchDetail(request,match.id,host);expect(remaining.status).toBe('waiting_for_players');expect(remaining.players.some((player:any)=>player.user_id===guest.id&&player.active!==false)).toBe(false);
  expect((await listed(request,host)).some((item:any)=>item.id===match.id)).toBe(true);expect((await listed(request,guest)).some((item:any)=>item.id===match.id)).toBe(false);
});

test('local carousels are newest first, show opponent labels and disappear independently when emptied',async({page,request},info)=>{
  test.setTimeout(60000);
  await loginAs(page,await createUser(request,uniqueName('Single-player list owner')));
  await page.goto('/portal#matches');await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
  await expect(page.getByTestId('computer-local-matches')).toHaveCount(0);await expect(page.getByTestId('pass-local-matches')).toHaveCount(0);
  async function start(computer:boolean){await page.goto('/portal#local');await page.getByRole('button',{name:computer?'Practice with a computer':'Pass and play',exact:true}).click();await expect(page).toHaveURL(/#match=local-/);return new URLSearchParams(new URL(page.url()).hash.slice(1)).get('match')!;}
  const oldComputer=await start(true),newComputer=await start(true),oldPass=await start(false),newPass=await start(false);
  for(const cell of [1,4,2,5,3])await page.getByRole('button',{name:`Cell ${cell}`,exact:true}).click();
  await expect(page.getByTestId('match-outcome')).toContainText('won');await page.getByTestId('header-matches').click();
  const computers=page.getByTestId('computer-local-matches'),passes=page.getByTestId('pass-local-matches');
  await expect(computers).toBeVisible();await expect(passes).toBeVisible();
  await page.screenshot({path:info.outputPath('local-carousels.png')});
  expect(await computers.locator('[data-testid^="match-card-"]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-testid')))).toEqual([`match-card-${newComputer}`,`match-card-${oldComputer}`]);
  expect(await passes.locator('[data-testid^="match-card-"]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-testid')))).toEqual([`match-card-${newPass}`,`match-card-${oldPass}`]);
  expect((await computers.boundingBox())!.y).toBeLessThan((await passes.boundingBox())!.y);
  await expect(card(page,newComputer).getByRole('heading',{name:/Tic-tac-toe against Computer/})).toBeVisible();await expect(card(page,newPass).getByRole('heading',{name:'Tic-tac-toe against Player 2',exact:true})).toBeVisible();
  await expect(card(page,newPass).getByRole('button',{name:'Delete',exact:true})).toBeVisible();
  for(const id of [newComputer,oldComputer]){await card(page,id).getByRole('button',{name:'Delete',exact:true}).click();await expect(page.getByText('This deletes your private match from your account and this device.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Delete',exact:true}).last().click();await expect(card(page,id)).toHaveCount(0);}
  await expect(computers).toHaveCount(0);await expect(passes).toBeVisible();
  await card(page,newPass).getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('button',{name:'Delete',exact:true}).last().click();await expect(card(page,newPass)).toHaveCount(0);await expect(card(page,oldPass)).toBeVisible();
  await card(page,oldPass).getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('button',{name:'Delete',exact:true}).last().click();await expect(passes).toHaveCount(0);
  await page.reload();await expect(page.getByTestId('computer-local-matches')).toHaveCount(0);await expect(page.getByTestId('pass-local-matches')).toHaveCount(0);
});

test('every multiplayer category scrolls horizontally and keeps its match state when reopened',async({page,request,isMobile},info)=>{
  test.setTimeout(90000);
  const owner=await createUser(request,uniqueName('Carousel owner')),opponent=await createUser(request,uniqueName('Carousel opponent'));
  const gameId=await createGame(request,uniqueName('Carousel game'));
  const groups=[{id:'your-turn',status:'ongoing',turn:true},{id:'ongoing',status:'ongoing',turn:false},{id:'waiting',status:'waiting_for_players'},{id:'finished',status:'over'}];
  const saved=new Map<string,any[]>();
  for(const group of groups){
    const matches=[];
    for(let i=0;i<2;i++){
      const created=await request.post('/matches',{headers:headers(owner),data:{game_id:gameId}});expect(created.ok(),await created.text()).toBeTruthy();const match=await created.json();
      if(group.status!=='waiting_for_players'){
        const joined=await request.post(`/matches/${match.id}/join`,{headers:headers(opponent)});expect(joined.ok(),await joined.text()).toBeTruthy();
        const started=await request.post(`/matches/${match.id}/start`,{headers:headers(owner)});expect(started.ok(),await started.text()).toBeTruthy();
        if(group.id==='ongoing'){
          const moved=await request.post(`/matches/${match.id}/moves`,{headers:headers(owner),data:{move:{cell:0},expected_move_count:0}});expect(moved.ok(),await moved.text()).toBeTruthy();
        }else if(group.status==='over'){
          const left=await request.post(`/matches/${match.id}/leave`,{headers:headers(opponent)});expect(left.ok(),await left.text()).toBeTruthy();
        }
      }
      matches.push(await matchDetail(request,match.id,owner));
    }
    saved.set(group.id,matches);
  }
  await loginAs(page,owner);await page.goto('/portal#matches');
  await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
  await expect(page.getByText(/^(?:On this device|Saved on this device)$/)).toHaveCount(0);
  const mutations:string[]=[];page.on('request',request=>{if(/^\/matches(?:\/|$)/.test(new URL(request.url()).pathname)&&!['GET','HEAD'].includes(request.method()))mutations.push(request.method());});
  for(const group of groups){
    const carousel=page.getByTestId(`multiplayer-${group.id}-carousel`),matches=saved.get(group.id)!;
    await expect(carousel).toBeVisible();
    const cards=carousel.locator('[data-testid^="match-card-"]');await expect(cards).toHaveCount(2);
    const geometry=await cards.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width};}));
    expect(Math.abs(geometry[0].y-geometry[1].y)).toBeLessThan(1);expect(geometry[0].width).toBe(300);expect(geometry[1].x-geometry[0].x).toBeGreaterThanOrEqual(300);
    expect(await carousel.evaluate(node=>['auto','scroll'].includes(getComputedStyle(node).overflowX))).toBe(true);
    if(isMobile){
      expect(await carousel.evaluate(node=>node.scrollWidth>node.clientWidth)).toBe(true);
      await carousel.evaluate(node=>{node.scrollLeft=node.scrollWidth;});expect(await carousel.evaluate(node=>node.scrollLeft)).toBeGreaterThan(0);
    }
    const target=cards.last(),targetId=(await target.getAttribute('data-testid'))!.replace('match-card-','');
    await target.getByRole('button',{name:'Open match',exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`#match=${targetId}$`));
    await expect(page.getByRole('button',{name:/^←\s+Matches$/})).toHaveCount(0);
    await page.getByTestId('header-matches').click();await expect(carousel).toBeVisible();
    for(const before of matches){
      const after=await matchDetail(request,before.id,owner);
      expect(after).toMatchObject({status:before.status,move_count:before.move_count,turn_of_player_indices:before.turn_of_player_indices,players:before.players,state:before.state});
    }
  }
  expect(mutations).toEqual([]);await page.screenshot({path:info.outputPath('all-match-carousels.png'),fullPage:true});
});
