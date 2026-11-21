import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createUser,uniqueName} from './helpers';

test.use({serviceWorkers:'block'});
const packageBody=JSON.parse(readFileSync(path.resolve(__dirname,'../../../games/declarative/backgammon.json'),'utf8'));
const game={...packageBody,id:'5f5293c3-2a3a-4eec-b631-9debf59be0ca',version:1,
  name:'Backgammon',renderer_type:'declarative',
  game_schemas:Object.fromEntries(['state','move','view'].map(key=>[key,packageBody.unit_tests[key+'_schema']]))};

test('an unavailable reviewed presentation preserves play and sends a safe warning with a manual report',async({page,request,baseURL})=>{
  test.setTimeout(45000);
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Presentation faults require a disposable loopback server.');
  const origin=new URL(baseURL).origin;
  const owner=await createUser(request,uniqueName('Presentation fallback owner'));
  await page.addInitScript(owner=>{
    if(window!==window.top)return;
    localStorage.setItem('game-platform.accounts.v1',JSON.stringify([owner]));
    localStorage.setItem('game-platform.current-account.v1',owner.id);
    Math.random=()=>0.1;
  },owner);
  await page.route(url=>url.origin===origin&&new RegExp(`^/games/${game.id}(?:/versions/1)?$`).test(url.pathname),route=>route.fulfill({json:game}));
  let failedChunks=0;
  await page.route(url=>url.origin===origin&&/^\/static\/app\/_expo\/static\/js\/web\/presentation-[A-Za-z0-9._-]+\.js$/.test(url.pathname),route=>{
    failedChunks++;return route.fulfill({status:503,contentType:'application/javascript',body:'/* Optional presentation unavailable in this loopback test. */'});
  });
  // The package fixture has no catalog record. Keep all simulated cloud
  // acknowledgements and bug report submissions inside this disposable test.
  const cloud=new Map<string,any>();
  await page.route(url=>url.origin===origin&&url.pathname==='/matches/single-player-sync',route=>{
    const body=route.request().postDataJSON();
    const result={...body.match,cloud_revision:body.expected_revision+1,single_player_state:body.match};
    cloud.set(result.id,result);return route.fulfill({json:result});
  });
  await page.route(url=>url.origin===origin&&/^\/matches\/local-/.test(url.pathname),route=>{
    const id=new URL(route.request().url()).pathname.split('/')[2];
    return cloud.has(id)?route.fulfill({json:cloud.get(id)}):route.continue();
  });
  const reports:any[]=[];
  await page.route(url=>url.origin===origin&&url.pathname==='/bug-reports',route=>{
    reports.push(route.request().postDataJSON());
    return route.fulfill({status:201,json:{id:'presentation-fallback-fixture',status:'open'}});
  });
  await page.goto(`/portal#game=${game.id}`);
  await page.getByRole('button',{name:'Play against the computer',exact:true}).click();
  await expect(page).toHaveURL(/#match=local-/);
  const id=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('match')!;
  const start=page.getByRole('button',{name:'Start game: Select',exact:true});
  await expect(start).toBeEnabled();await start.click();
  const roll=page.getByRole('button',{name:/^Roll (?:one die|dice)(?:: Select)?$/}).first();
  await expect(roll).toBeEnabled();
  expect(failedChunks).toBeGreaterThan(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const savedMoves=()=>page.evaluate(id=>{
    const owner=localStorage.getItem('game-platform.current-account.v1');
    const key=Object.keys(localStorage).find(key=>key.startsWith('buildplay.shared.v1.')&&key.endsWith('.'+owner));
    return key?JSON.parse(localStorage.getItem(key)!).local[id]?.move_count:0;
  },id);
  const beforeRoll=await savedMoves();await roll.click();
  await expect.poll(savedMoves).toBeGreaterThan(beforeRoll);
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.getByRole('button',{name:'Report a bug or request a feature',exact:true}).click();
  await page.getByRole('textbox',{name:'Bug or feature request'}).fill('The optional display update could not load, but this match still works.');
  await page.getByRole('button',{name:'Send report',exact:true}).click();
  await expect(page.getByText('Thanks! Your report was sent.')).toBeVisible();
  const manual=reports.filter(report=>report.automatic!==true);
  expect(manual).toHaveLength(1);
  const logs=manual[0].diagnostics.logs;
  const prefix='reviewed_presentation_fallback ';
  const fallback=logs.filter((entry:any)=>typeof entry.message==='string'&&entry.message.startsWith(prefix));
  expect(fallback.length).toBeGreaterThan(0);
  for(const entry of fallback){
    expect(entry.level).toBe('warn');
    // The warning carries only stable public package identity. Neither raw
    // exceptions nor account credentials may enter this diagnostic message.
    expect(JSON.parse(entry.message.slice(prefix.length))).toEqual({gameId:game.id,gameVersion:game.version});
  }
  const encodedLogs=JSON.stringify(logs);
  expect(encodedLogs).not.toContain(owner.password);
  expect(encodedLogs).not.toContain('Optional presentation unavailable in this loopback test.');
});
