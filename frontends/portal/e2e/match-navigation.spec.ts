import {test,expect,type Locator,type Page} from '@playwright/test';
import {createGame,createUser,loginAs,uniqueName} from './helpers';

test.beforeEach(async({baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Match navigation checks require a disposable loopback server.');
});

const viewports=[{width:390,height:844},{width:1440,height:900}];
const backToMatches=(page:Page)=>page.getByRole('button',{name:/^←\s+Matches$/});
const matchesNavigation=(page:Page)=>page.getByRole('button',{name:'Matches',exact:true});
async function activate(control:Locator,touch:boolean){if(touch)await control.tap();else await control.click();}

test('online matches use the shared navigation and retain their public game through focus and browser Back',async({page,request,isMobile},info)=>{
  test.setTimeout(60000);
  const name=uniqueName('Online navigation game'),gameId=await createGame(request,name);
  const host=await createUser(request,'Online navigation host'),opponent=await createUser(request,'Online navigation opponent');
  const headers={'X-User-Id':host.id,'X-User-Password':host.password};
  const created=await request.post('/matches',{headers,data:{game_id:gameId}});
  expect(created.ok(),await created.text()).toBeTruthy();const match=await created.json();
  const joined=await request.post(`/matches/${match.id}/join`,{headers:{'X-User-Id':opponent.id,'X-User-Password':opponent.password},data:{}});
  expect(joined.ok(),await joined.text()).toBeTruthy();
  const started=await request.post(`/matches/${match.id}/start`,{headers,data:{}});
  expect(started.ok(),await started.text()).toBeTruthy();
  const moved=await request.post(`/matches/${match.id}/moves`,{headers,data:{move:{cell:0},expected_move_count:0}});
  expect(moved.ok(),await moved.text()).toBeTruthy();
  const viewerHeaders={'X-User-Id':opponent.id,'X-User-Password':opponent.password};
  const initialResponse=await request.get(`/matches/${match.id}`,{headers:viewerHeaders});expect(initialResponse.ok()).toBeTruthy();
  const initial=await initialResponse.json();expect(initial.status).toBe('ongoing');expect(initial.move_count).toBe(1);expect(initial.state).toBeDefined();expect(initial).not.toHaveProperty('private');
  await loginAs(page,opponent);
  const mutations:string[]=[];
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(/^\/matches(?:\/|$)/.test(path)&&!['GET','HEAD'].includes(request.method()))mutations.push(`${request.method()} ${path}`);});
  await page.goto(`/portal#match=${match.id}`);

  for(const viewport of viewports){
    await page.setViewportSize(viewport);
    await expect(page.getByTestId('game-stage')).toBeVisible();
    await expect(page.getByText(/^(?:Public match|Invite only)$/)).toHaveCount(0);
    await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible();
    await expect(backToMatches(page)).toHaveCount(0);
    await expect(matchesNavigation(page)).toHaveCount(1);
    await activate(page.getByRole('button',{name:'Focus mode',exact:true}),isMobile);
    await expect(matchesNavigation(page)).toHaveCount(0);
    await expect(backToMatches(page)).toHaveCount(0);
    await activate(page.getByRole('button',{name:'Exit focus mode',exact:true}),isMobile);
    await expect(matchesNavigation(page)).toBeVisible();
    await expect(page.getByText(/^(?:Public match|Invite only)$/)).toHaveCount(0);
    await page.screenshot({path:info.outputPath(`online-navigation-${viewport.width}.png`)});

    await activate(matchesNavigation(page),isMobile);
    await expect(page).toHaveURL(/#matches$/);
    await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
    await expect(page.getByTestId(`match-card-${match.id}`).getByRole('heading',{name:`${name} against ${host.display_name}`,exact:true})).toBeVisible();
    const reopen=page.getByRole('button',{name:'Open match',exact:true});
    await expect(reopen).toHaveCount(1);await activate(reopen,isMobile);
    await expect(page).toHaveURL(new RegExp(`#match=${match.id}$`));
    await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible();
    await expect(backToMatches(page)).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/#matches$/);
    await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
    await activate(reopen,isMobile);
    await expect(page).toHaveURL(new RegExp(`#match=${match.id}$`));
  }
  expect(mutations).toEqual([]);
  const response=await request.get(`/matches/${match.id}`,{headers:viewerHeaders});expect(response.ok()).toBeTruthy();
  const current=await response.json();
  expect(current).toMatchObject({id:match.id,game_id:gameId,game_version:initial.game_version,status:'ongoing',move_count:initial.move_count});
  expect(current.players).toEqual(initial.players);
  expect(current.state).toEqual(initial.state);
  expect(current.turn_of_player_indices).toEqual(initial.turn_of_player_indices);
  expect(current).not.toHaveProperty('private');
});

test('the local return control still opens saved local matches and resumes the played board',async({page,request,isMobile},info)=>{
  await loginAs(page,await createUser(request,uniqueName('Single-player navigation owner')));
  await page.setViewportSize(viewports[0]);
  await page.goto('/portal#local');
  await activate(page.getByRole('button',{name:'Pass and play',exact:true}),isMobile);
  await activate(page.getByRole('button',{name:'Cell 1',exact:true}),isMobile);
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible();
  const matchUrl=page.url();expect(matchUrl).toMatch(/#match=local-/);

  for(const viewport of viewports){
    await page.setViewportSize(viewport);
    await expect(backToMatches(page)).toBeVisible();
    await expect(page.getByText('Private to your account',{exact:true})).toBeVisible();
    await activate(backToMatches(page),isMobile);
    await expect(page).toHaveURL(/#matches$/);
    await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
    const reopen=page.getByRole('button',{name:'Open match',exact:true});
    await expect(reopen).toHaveCount(1);await activate(reopen,isMobile);
    await expect(page).toHaveURL(matchUrl);
    await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible();
    await expect(page.getByText('1 moves · 2 players · Pass and play',{exact:true})).toBeVisible();
    await page.screenshot({path:info.outputPath(`local-resumed-${viewport.width}.png`)});
    await page.goBack();
    await expect(page).toHaveURL(/#matches$/);
    await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
    await activate(reopen,isMobile);
    await expect(page).toHaveURL(matchUrl);
    await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible();
  }
});
