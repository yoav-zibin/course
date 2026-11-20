import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createUser,uniqueName} from './helpers';

const load=(name:string)=>JSON.parse(readFileSync(path.resolve(__dirname,'../../..',name),'utf8'));
const packageBody=load('games/declarative/backgammon.json');
const originalUI=load('tests/fixtures/declarative/backgammon-v7-ui.json');
const game={...packageBody,id:'5f5293c3-2a3a-4eec-b631-9debf59be0ca',version:7,
  name:'Backgammon',renderer_type:'declarative',declarative_ui:originalUI,
  game_schemas:Object.fromEntries(['state','move','view'].map(key=>[key,packageBody.unit_tests[key+'_schema']]))};

async function saved(page:Page,id:string){
  return page.evaluate(id=>{
    const key=Object.keys(localStorage).find(key=>key.startsWith('buildplay.shared.v1.')&&key.endsWith('.'+localStorage.getItem('game-platform.current-account.v1')));
    const data=key?JSON.parse(localStorage.getItem(key)!):null;
    return {match:data?.local[id],pinned:data?.responses['/games/5f5293c3-2a3a-4eec-b631-9debf59be0ca/versions/7']};
  },id);
}

test('saved Backgammon opening ties remain clear after computer rerolls and the human can continue',async({page,request,baseURL,isMobile},info)=>{
  test.setTimeout(90000);
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Backgammon checks require a disposable loopback server.');
  const owner=await createUser(request,uniqueName('Opening owner'));
  await page.addInitScript(owner=>{
    if(window!==window.top)return;
    localStorage.setItem('game-platform.accounts.v1',JSON.stringify([owner]));
    localStorage.setItem('game-platform.current-account.v1',owner.id);
    // Host-only randomness: seat1 and seed2147542395 give opening faces
    // 5,5,5,5,5,6. The isolated authoritative game RNG remains unchanged.
    Math.random=()=>2147542395/4294967296;
  },owner);
  await page.route(url=>new RegExp(`^/games/${game.id}(?:/versions/7)?$`).test(url.pathname),route=>route.fulfill({json:game}));
  // This immutable package fixture has no server catalog record. Model the
  // cloud acknowledgement explicitly; actual persistence is covered separately.
  const cloud=new Map<string,any>();
  await page.route('**/matches/single-player-sync',route=>{
    const body=route.request().postDataJSON();
    const result={...body.match,cloud_revision:body.expected_revision+1,single_player_state:body.match};
    cloud.set(result.id,result);return route.fulfill({json:result});
  });
  await page.route(url=>/^\/matches\/local-/.test(url.pathname),route=>{
    const id=new URL(route.request().url()).pathname.split('/')[2];
    return cloud.has(id)?route.fulfill({json:cloud.get(id)}):route.continue();
  });
  await page.goto(`/portal#game=${game.id}`);
  await page.getByRole('button',{name:'Play against the computer',exact:true}).click();
  await expect(page).toHaveURL(/#match=local-/);
  const id=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('match')!;
  const roll=page.getByRole('button',{name:'Roll one die: Select',exact:true});
  await expect(roll).toBeEnabled();
  await expect(page.getByText('Each player rolls one die.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Die 1: 5: Select',exact:true})).toHaveCount(0);
  await expect(page.getByRole('img',{name:'Die 1: 5',exact:true})).toBeVisible();
  for(const moveCount of [4,6]){
    await roll.click();
    await expect.poll(async()=>(await saved(page,id)).match?.move_count).toBe(moveCount);
    await expect(roll).toBeEnabled();
    await expect(page.getByText('Tie 5–5: roll one die again.',{exact:true})).toBeVisible();
    const position=(await saved(page,id)).match;
    expect(position.logicState).toMatchObject({opening:true,opening_roll:[5,null],cur:1,needRoll:true});
  }
  await page.reload();
  await expect(roll).toBeEnabled();
  await expect(page.getByText('Tie 5–5: roll one die again.',{exact:true})).toBeVisible();
  const retained=await saved(page,id);
  expect(retained.match.game_version).toBe(7);
  expect(retained.pinned.declarative_ui).toEqual(originalUI);
  expect(retained.pinned.server_code).toBe(packageBody.server_code);
  await page.screenshot({path:info.outputPath('opening-tie-retained-version7.png'),fullPage:true});
  await roll.click();
  await expect.poll(async()=>(await saved(page,id)).match?.move_count).toBe(7);
  await expect(page.getByRole('img',{name:'Die 1: 5',exact:true})).toBeVisible();
  await expect(page.getByRole('img',{name:'Die 2: 6',exact:true})).toBeVisible();
  const ready=(await saved(page,id)).match;
  expect(ready.logicState).toMatchObject({opening:false,opening_roll:[5,6],cur:1,needRoll:false});
  const move=ready.state.legalMoves[0];
  const checker=page.getByRole('button',{name:`Player 2: Point ${move.from+1}: Move`,exact:true}).last();
  await expect(checker).toBeEnabled();await checker.scrollIntoViewIfNeeded();
  // Target artwork can overlap a checker. Real board gestures resolve the
  // source geometrically, rather than requiring that SVG node to be on top.
  const sourceBox=(await checker.boundingBox())!;
  if(isMobile)await page.touchscreen.tap(sourceBox.x+sourceBox.width/2,sourceBox.y+sourceBox.height/2);
  else await page.mouse.click(sourceBox.x+sourceBox.width/2,sourceBox.y+sourceBox.height/2);
  const destination=page.getByRole('button',{name:`Point ${move.to+1}`,exact:true});
  await destination.scrollIntoViewIfNeeded();const targetBox=(await destination.boundingBox())!;
  if(isMobile)await page.touchscreen.tap(targetBox.x+targetBox.width/2,targetBox.y+targetBox.height/2);
  else await page.mouse.click(targetBox.x+targetBox.width/2,targetBox.y+targetBox.height/2);
  await expect.poll(async()=>(await saved(page,id)).match?.move_count).toBeGreaterThan(7);
  expect((await saved(page,id)).match.logicState.cnt).not.toEqual(ready.logicState.cnt);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('opening-resolved-legal-checker-move.png'),fullPage:true});
});
