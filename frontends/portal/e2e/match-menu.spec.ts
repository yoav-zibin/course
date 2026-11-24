import fs from 'node:fs';
import path from 'node:path';
import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import {createGame,createUser,loginAs,uniqueName} from './helpers';

test.beforeEach(async({baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Match menu checks require a disposable loopback server.');
});
const historyIds=['history-start','history-previous','history-play','history-next','history-end'];
const matchMenu=(page:Page)=>page.getByRole('dialog',{name:'Match menu',exact:true});
async function assertBoardUnchanged(page:Page){
  const current=await page.getByTestId('game-stage').evaluate(node=>{
    const previous=(window as any).__menuBoard;
    const box=node.getBoundingClientRect();
    return {same:previous.svg===node.querySelector('svg'),box:{x:box.x,y:box.y,width:box.width,height:box.height},previous:previous.box};
  });
  expect(current.same).toBe(true);
  for(const key of ['x','y','width','height'] as const)expect(Math.abs(current.box[key]-current.previous[key])).toBeLessThan(1);
}
async function rememberBoard(page:Page){
  await page.getByTestId('game-stage').evaluate(node=>{
    const box=node.getBoundingClientRect();(window as any).__menuBoard={svg:node.querySelector('svg'),box:{x:box.x,y:box.y,width:box.width,height:box.height}};
  });
}

for(const width of [390,1440])test(`match keeps its fitted board unchanged beneath a closable menu and floating remote at ${width}px`,async({page,request},info)=>{
  const owner=await createUser(request,uniqueName('Menu owner'));
  const gameId=await createGame(request,uniqueName('Match menu game'));
  const response=await request.get(`/games/${gameId}`);expect(response.ok(),await response.text()).toBeTruthy();
  const game=await response.json();
  await page.setViewportSize({width,height:900});await loginAs(page,owner);
  await page.goto(`/portal#game=${game.id}`);
  await page.getByTestId('play-pass').getByRole('button',{name:'Pass and play',exact:true}).click();
  const menu=page.getByTestId('match-menu-button'),group=page.getByTestId('match-floating-controls');
  const title=page.getByRole('heading',{name:game.name,exact:true});
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  await expect(group).toHaveCount(1);await expect(group.getByRole('button')).toHaveCount(7);
  await expect(page.getByText('Your turn',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Game in progress',{exact:true})).toHaveCount(0);
  await expect(menu).toHaveAccessibleName('Match menu');await expect(menu).toHaveAttribute('aria-expanded','false');
  await expect(page.getByTestId('portal-header')).toHaveCount(0);await expect(title).toHaveCount(0);
  await expect(page.getByRole('button',{name:'How to play',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/^(?:Focus mode|Exit focus mode|← Previous|Next →|Live board)$/})).toHaveCount(0);
  await page.getByRole('button',{name:'Cell 1',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible();
  await expect(page.getByTestId('history-play')).toBeEnabled();
  await rememberBoard(page);const matchUrl=page.url();
  await menu.focus();await page.keyboard.press('Enter');
  await expect(menu).toHaveAttribute('aria-expanded','true');await expect(matchMenu(page)).toBeVisible();
  await expect(title).toBeVisible();await expect(matchMenu(page).getByTestId('portal-header')).toBeVisible();
  await assertBoardUnchanged(page);
  await expect(matchMenu(page).getByTestId('match-details').getByText(owner.display_name,{exact:true})).toBeVisible();
  await expect(matchMenu(page).getByText('Player 2',{exact:true})).toBeVisible();
  await expect(matchMenu(page).getByText('1 moves · 2 players · Pass and play',{exact:true})).toBeVisible();
  await expect(matchMenu(page).getByText('Game in progress',{exact:true})).toBeVisible();
  await expect(matchMenu(page).getByText('Current turn',{exact:true})).toBeVisible();
  for(const id of historyIds)await expect(page.getByTestId(id)).toBeDisabled();
  await matchMenu(page).getByRole('button',{name:'How to play',exact:true}).click();
  await expect(page.getByTestId('game-instructions')).toContainText(game.game_logic_rules);
  await menu.click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(menu).toHaveAttribute('aria-expanded','false');await assertBoardUnchanged(page);
  await menu.click();await expect(matchMenu(page)).toBeVisible();
  await matchMenu(page).getByRole('button',{name:'How to play',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'How to play',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(matchMenu(page).getByRole('button',{name:'How to play',exact:true})).toBeVisible();
  await matchMenu(page).getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(matchMenu(page)).toHaveCount(0);await expect(menu).toHaveAttribute('aria-expanded','false');
  await expect(title).toHaveCount(0);await expect(page.getByTestId('portal-header')).toHaveCount(0);
  await assertBoardUnchanged(page);await expect(page.getByTestId('history-play')).toBeEnabled();
  await menu.click();await expect(matchMenu(page)).toBeVisible();
  await menu.focus();await page.keyboard.press('Space');
  await expect(matchMenu(page)).toHaveCount(0);await assertBoardUnchanged(page);
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible();expect(page.url()).toBe(matchUrl);
  await page.screenshot({path:info.outputPath(`board-and-remote-${width}.png`)});
  await page.reload();await expect(menu).toHaveAttribute('aria-expanded','false');
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible();
});

test('floating history remote disables empty history, seeks frames and returns to live after playback',async({page,request})=>{
  await loginAs(page,await createUser(request,uniqueName('Remote history owner')));
  await page.goto('/portal#local');await page.getByRole('button',{name:'Pass and play',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  const labels=['Go to start','Previous move','Play history','Next move','Go to end'];
  for(const [index,id] of historyIds.entries()){
    const control=page.getByTestId(id);await expect(control).toHaveAccessibleName(labels[index]);await expect(control).toBeDisabled();
    await control.evaluate(node=>(node as HTMLButtonElement).click());
  }
  await expect(page.getByText('Live board',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  for(const cell of [1,4,2]){
    const target=page.getByRole('button',{name:`Cell ${cell}`,exact:true});await target.click();await expect(target).toHaveCount(0);
  }
  await expect(page.getByTestId('history-start')).toBeEnabled();await expect(page.getByTestId('history-previous')).toBeEnabled();
  await expect(page.getByTestId('history-next')).toBeDisabled();await expect(page.getByTestId('history-end')).toBeDisabled();
  await page.getByTestId('history-start').click();await expect(page.getByText('Replay · move 0 of 3',{exact:true})).toBeVisible();
  await expect(page.getByTestId('history-start')).toBeDisabled();await expect(page.getByTestId('history-previous')).toBeDisabled();
  await expect(page.getByTestId('game-stage').getByRole('img',{name:'X',exact:true})).toHaveCount(0);
  await page.getByTestId('history-next').click();await expect(page.getByText('Replay · move 1 of 3',{exact:true})).toBeVisible();
  await expect(page.getByTestId('game-stage').getByRole('img',{name:'X',exact:true})).toHaveCount(1);
  await page.getByTestId('history-next').click();await expect(page.getByText('Replay · move 2 of 3',{exact:true})).toBeVisible();
  await page.getByTestId('history-previous').click();await expect(page.getByText('Replay · move 1 of 3',{exact:true})).toBeVisible();
  await page.getByTestId('history-end').click();await expect(page.getByText('Live board',{exact:true})).toBeVisible();
  await expect(page.getByTestId('history-end')).toBeDisabled();await expect(page.getByRole('button',{name:'Cell 3',exact:true})).toBeVisible();
  await page.getByTestId('history-play').click();await expect(page.getByTestId('history-play')).toHaveAccessibleName('Pause history');
  await page.getByTestId('history-play').click();await expect(page.getByTestId('history-play')).toHaveAccessibleName('Play history');
  await page.getByTestId('history-play').click();
  await expect(page.getByTestId('history-play')).toHaveAccessibleName('Pause history');
  await expect(page.getByText('Live board',{exact:true})).toBeVisible({timeout:15000});
  await expect(page.getByTestId('history-play')).toHaveAccessibleName('Play history');
  await expect(page.getByTestId('history-end')).toBeDisabled();await expect(page.getByRole('button',{name:'Cell 3',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/^(?:← Previous|Next →|Live board)$/})).toHaveCount(0);
});

async function leavingGame(request:APIRequestContext){
  const payload=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../games/declarative/tictactoe.json'),'utf8'));
  payload.name=uniqueName('Menu lobby game');payload.allows_leave_mid_match=true;payload.game_addition_request_id_and_secret=uniqueName('menu-leave-secret');
  let response=await request.post('/games/declarative',{data:payload});
  for(let attempt=0;response.status()===429&&attempt<10;attempt++){await new Promise(resolve=>setTimeout(resolve,1000));response=await request.post('/games/declarative',{data:payload});}
  expect(response.ok(),await response.text()).toBeTruthy();return(await response.json()).id;
}

test('a multiplayer lobby keeps join and start controls, then exposes names, navigation and leaving in a closable menu',async({page,browser,request,baseURL})=>{
  const gameId=await leavingGame(request);
  const host=await createUser(request,uniqueName('Menu lobby host')),guest=await createUser(request,uniqueName('Menu lobby guest'));
  const response=await request.post('/matches',{headers:{'X-User-Id':host.id,'X-User-Password':host.password},data:{game_id:gameId}});
  expect(response.ok(),await response.text()).toBeTruthy();const match=await response.json();
  await loginAs(page,host);await page.goto(`/portal#match=${match.id}`);
  await expect(page.getByTestId('portal-header')).toBeVisible();await expect(page.getByRole('button',{name:'Start match',exact:true})).toBeDisabled();
  await expect(page.getByTestId('match-menu-button')).toHaveCount(0);
  const guestContext=await browser.newContext({baseURL});
  try{
    const guestPage=await guestContext.newPage();await loginAs(guestPage,guest);await guestPage.goto(`/portal#match=${match.id}`);
    await expect(guestPage.getByTestId('portal-header')).toBeVisible();await guestPage.getByRole('button',{name:'Join match',exact:true}).click();
    await expect(page.getByRole('button',{name:'Start match',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Start match',exact:true}).click();
    for(const playerPage of [page,guestPage]){
      await expect(playerPage.getByTestId('game-stage')).toBeVisible();await expect(playerPage.getByTestId('portal-header')).toHaveCount(0);
      await expect(playerPage.getByTestId('match-menu-button')).toHaveAttribute('aria-expanded','false');
    }
    await page.getByTestId('match-menu-button').click();await expect(matchMenu(page)).toBeVisible();
    await expect(matchMenu(page).getByTestId('match-details').getByText(host.display_name,{exact:true})).toBeVisible();
    await expect(matchMenu(page).getByTestId('match-details').getByText(guest.display_name,{exact:true})).toBeVisible();
    await expect(matchMenu(page).getByRole('button',{name:'Games',exact:true})).toBeVisible();
    await expect(matchMenu(page).getByRole('button',{name:'Matches',exact:true})).toBeVisible();
    await matchMenu(page).getByRole('button',{name:'Leave match',exact:true}).click();
    await expect(page.getByText('Leave this match?',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    await expect(matchMenu(page).getByRole('button',{name:'Leave match',exact:true})).toBeVisible();
    await matchMenu(page).getByRole('button',{name:'Close dialog',exact:true}).click();await expect(matchMenu(page)).toHaveCount(0);
    await page.getByTestId('match-menu-button').click();await matchMenu(page).getByTestId('header-matches').click();
    await expect(page).toHaveURL(/#matches$/);
    await page.goto('/portal#local');await page.getByRole('button',{name:'Pass and play',exact:true}).click();
    await expect(page.getByTestId('match-menu-button')).toHaveAttribute('aria-expanded','false');await expect(matchMenu(page)).toHaveCount(0);
  }finally{await guestContext.close();}
});
