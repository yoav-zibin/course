import {test,expect} from '@playwright/test';
import {createGame,createUser,loginAs,uniqueName} from './helpers';

test.beforeEach(async({baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Match menu checks require a disposable loopback server.');
});

for(const width of [390,1440])test(`match opens with the board and one floating bug/menu group at ${width}px`,async({page,request},info)=>{
  const owner=await createUser(request,uniqueName('Menu owner'));
  const gameId=await createGame(request,uniqueName('Match menu game'));
  const response=await request.get(`/games/${gameId}`);expect(response.ok(),await response.text()).toBeTruthy();
  const game=await response.json(),rules=game.game_logic_rules;
  await page.setViewportSize({width,height:900});await loginAs(page,owner);
  await page.goto(`/portal#game=${game.id}`);
  await page.getByTestId('play-pass').getByRole('button',{name:'Pass and play',exact:true}).click();
  const menu=page.getByTestId('match-menu-button'),bug=page.getByTestId('bug-report-button');
  const title=page.getByRole('heading',{name:game.name,exact:true});
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  await expect(page.getByTestId('match-floating-controls')).toHaveCount(1);
  await expect(page.getByText('Your turn',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Game in progress',{exact:true})).toHaveCount(0);
  await expect(menu).toHaveAccessibleName('Match menu');await expect(menu).toHaveAttribute('aria-expanded','false');
  await expect(page.getByTestId('portal-header')).toHaveCount(0);await expect(title).toHaveCount(0);
  await expect(page.getByRole('button',{name:'How to play',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Play history',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/^(?:Focus mode|Exit focus mode)$/})).toHaveCount(0);
  await expect(bug).toBeVisible();
  const bugBox=(await bug.boundingBox())!,menuBox=(await menu.boundingBox())!;
  expect(Math.abs(bugBox.y-menuBox.y)).toBeLessThan(2);
  expect(Math.abs(bugBox.x+bugBox.width-menuBox.x)).toBeLessThanOrEqual(10);
  await page.getByRole('button',{name:'Cell 1',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible();
  await page.getByTestId('game-stage').locator('svg').first().evaluate(node=>{(window as any).__menuBoard=node;});
  const matchUrl=page.url();
  await menu.focus();await page.keyboard.press('Enter');
  await expect(menu).toHaveAttribute('aria-expanded','true');await expect(title).toBeVisible();
  await expect(page.getByTestId('portal-header')).toBeVisible();
  expect(await page.getByTestId('game-stage').locator('svg').first().evaluate(node=>(window as any).__menuBoard===node)).toBe(true);
  await expect(page.getByTestId('match-details').getByText(owner.display_name,{exact:true})).toBeVisible();
  await expect(page.getByTestId('match-details').getByText('Player 2',{exact:true})).toBeVisible();
  await expect(page.getByText('1 moves · 2 players · Pass and play',{exact:true})).toBeVisible();
  await expect(page.getByText('Game in progress',{exact:true})).toBeVisible();
  await expect(page.getByText('Current turn',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Play history',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'How to play',exact:true}).click();
  await expect(page.getByTestId('game-instructions')).toContainText(rules);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'← Previous',exact:true}).click();
  await expect(page.getByText('Replay · move 0 of 1',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Live board',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible();
  await page.getByTestId('game-stage').locator('svg').first().evaluate(node=>{(window as any).__menuBoard=node;});
  await menu.focus();await page.keyboard.press('Space');
  await expect(menu).toHaveAttribute('aria-expanded','false');await expect(title).toHaveCount(0);
  await expect(page.getByTestId('portal-header')).toHaveCount(0);
  expect(await page.getByTestId('game-stage').locator('svg').first().evaluate(node=>(window as any).__menuBoard===node)).toBe(true);
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible();expect(page.url()).toBe(matchUrl);
  await page.screenshot({path:info.outputPath(`board-and-menu-${width}.png`)});
  await page.reload();await expect(menu).toHaveAttribute('aria-expanded','false');
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible();
});


test('a multiplayer lobby retains join and start controls, then opens only the board when started',async({page,browser,request,baseURL})=>{
  const gameId=await createGame(request,uniqueName('Menu lobby game'));
  const host=await createUser(request,uniqueName('Menu lobby host'));
  const guest=await createUser(request,uniqueName('Menu lobby guest'));
  const response=await request.post('/matches',{headers:{'X-User-Id':host.id,'X-User-Password':host.password},data:{game_id:gameId}});
  expect(response.ok(),await response.text()).toBeTruthy();const match=await response.json();
  await loginAs(page,host);await page.goto(`/portal#match=${match.id}`);
  await expect(page.getByTestId('portal-header')).toBeVisible();
  await expect(page.getByRole('button',{name:'Start match',exact:true})).toBeDisabled();
  await expect(page.getByTestId('match-menu-button')).toHaveCount(0);
  const guestContext=await browser.newContext({baseURL});
  try{
    const guestPage=await guestContext.newPage();await loginAs(guestPage,guest);
    await guestPage.goto(`/portal#match=${match.id}`);
    await expect(guestPage.getByTestId('portal-header')).toBeVisible();
    await guestPage.getByRole('button',{name:'Join match',exact:true}).click();
    await expect(page.getByRole('button',{name:'Start match',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Start match',exact:true}).click();
    for(const playerPage of [page,guestPage]){
      await expect(playerPage.getByTestId('game-stage')).toBeVisible();
      await expect(playerPage.getByTestId('portal-header')).toHaveCount(0);
      await expect(playerPage.getByTestId('match-menu-button')).toHaveAttribute('aria-expanded','false');
    }
    await page.getByTestId('match-menu-button').click();
    await page.getByTestId('header-matches').click();
    await page.goto('/portal#local');await page.getByRole('button',{name:'Pass and play',exact:true}).click();
    await expect(page.getByTestId('match-menu-button')).toHaveAttribute('aria-expanded','false');
    await expect(page.getByTestId('portal-header')).toHaveCount(0);
  }finally{await guestContext.close();}
});
