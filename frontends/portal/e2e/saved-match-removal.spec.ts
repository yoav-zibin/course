import {test,expect} from '@playwright/test';
import bundled from '../src/core/bundled-tictactoe.json';
import {createUser,loginAs,uniqueName} from './helpers';

test.beforeEach(async({baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Saved-copy removal checks require a disposable loopback server.');
});

for(const source of ['list','board'])test(`an old unsynced copy can be removed from its ${source} while preserving recovery data`,async({page,request,context,baseURL},info)=>{
  const owner=await createUser(request,uniqueName('Saved-copy owner'));
  const target='local-old-recovery',keep='local-keep-pending',other='retained-other-account';
  await loginAs(page,owner);
  await page.addInitScript(({owner,target,keep,other,game,baseURL})=>{
    if(localStorage.getItem('test.saved-match-removal.seeded'))return;
    const state={board:Array(9).fill(-1),turn:0,scores:[0,0],selected:[],matched:[],roll:0,total:0,winner:-1,turns:0,over:false};
    const view={...state,legal:Array.from({length:9},(_,cell)=>({cell}))};
    const match=(id:string)=>({id,game_id:'tictactoe',game_version:1,owner_user_id:owner.id,match_kind:'pass_and_play',localMode:'pass',
      players:[{id:'player-0',player_index:0,kind:'human',user_id:owner.id,name:'Owner'},{id:'player-1',player_index:1,kind:'human',user_id:null,name:'Player 2'}],
      state:view,logicState:state,initialState:view,initialTurn:[0],practiceSeed:3,turn_of_player_indices:[0],status:'ongoing',move_count:0,moves:[],
      created_at:'2026-11-19T00:00:00Z',local_revision:1,cloud_pending:true});
    const data={version:1,responses:{'/games/tictactoe/versions/1':{...game,id:'tictactoe',version:1}},queues:{},conflicts:{
      [target]:{message:'Cloud saving needs attention: game version not found. Your saved turns are preserved.'},
      [keep]:{message:'A different pending save is preserved.'}},local:{[target]:match(target),[keep]:match(keep)},archives:[],archivedMatches:[],selectedId:null};
    const key=`buildplay.shared.v1.${encodeURIComponent(baseURL!)}.${owner.id}`;
    localStorage.setItem(key,JSON.stringify(data));localStorage.setItem(`${key}.${other}`,JSON.stringify({private:'another account record'}));
    localStorage.setItem('test.saved-match-removal.seeded','1');
  },{owner,target,keep,other,game:bundled,baseURL});
  const matchWrites:string[]=[];
  await page.route(url=>/^\/matches(?:\/|$)/.test(url.pathname),route=>{
    if(['GET','HEAD'].includes(route.request().method()))return route.continue();
    matchWrites.push(route.request().method()+' '+new URL(route.request().url()).pathname);return route.abort('blockedbyclient');
  });
  await page.goto(source==='board'?`/portal#match=${target}`:'/portal#matches');
  const read=()=>page.evaluate(({owner,baseURL,other})=>{
    const key=`buildplay.shared.v1.${encodeURIComponent(baseURL!)}.${owner.id}`;
    return {data:JSON.parse(localStorage.getItem(key)!),other:localStorage.getItem(`${key}.${other}`)};
  },{owner,baseURL,other});
  await expect(page.getByRole('button',{name:'Remove saved copy…',exact:true}).first()).toBeVisible();
  if(source==='board'){
    await expect(page.getByTestId('game-stage')).toBeVisible();
    await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
    await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
    await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
    await context.setOffline(true);
  }
  const before=await read();
  const remove=()=>source==='list'?page.getByTestId(`match-card-${target}`).getByRole('button',{name:'Remove saved copy…',exact:true}):page.getByRole('button',{name:'Remove saved copy…',exact:true});
  await remove().click();await expect(page.getByRole('heading',{name:'Remove this saved copy?',exact:true})).toBeVisible();
  await expect(page.getByText(/A recovery copy is kept in Preserved previous app data\. Any cloud match stays unchanged\./)).toBeVisible();
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  expect((await read()).data.local[target]).toEqual(before.data.local[target]);
  await remove().click();await page.getByRole('button',{name:'Remove saved copy',exact:true}).click();
  await expect(page).toHaveURL(/#matches$/);
  await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
  await expect(page.getByTestId(`match-card-${target}`)).toHaveCount(0);await expect(page.getByTestId(`match-card-${keep}`)).toBeVisible();
  await expect(page.getByText(/1 pending saves/)).toBeVisible();
  await expect(page.getByRole('heading',{name:'Preserved previous app data',exact:true})).toBeVisible();
  const after=await read();
  expect(after.data.local[target]).toBeUndefined();expect(after.data.conflicts[target]).toBeUndefined();
  expect(after.data.archives).toHaveLength(1);expect(after.data.archives[0]).toMatchObject({id:target,kind:'removed-single-player-save',match:before.data.local[target],conflict:before.data.conflicts[target]});
  expect(after.data.local[keep]).toEqual(before.data.local[keep]);expect(after.other).toEqual(before.other);
  expect(matchWrites).toEqual([]);
  await page.getByRole('heading',{name:'Preserved previous app data',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath(`removed-${source}-recovery.png`),fullPage:true});
  await page.reload();await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
  await expect(page.getByTestId(`match-card-${target}`)).toHaveCount(0);await expect(page.getByTestId(`match-card-${keep}`)).toBeVisible();
  expect((await read()).data.archives).toEqual(after.data.archives);
  await context.setOffline(false);await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.getByRole('button',{name:'Copy preserved data',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe(JSON.stringify(after.data.archives,null,2));
  expect(matchWrites).toEqual([]);

  // The cloud copy can still exist after a slow upload. An old browser entry
  // must not reopen it as a board without an active device save.
  const snapshot=before.data.local[target],cloud={...Object.fromEntries(['id','game_id','game_version','owner_user_id','match_kind','players','status','state','turn_of_player_indices','move_count','created_at'].map(key=>[key,snapshot[key]])),
    cloud_revision:1,single_player_state:snapshot};
  let oldLinkReads=0;
  await page.route(url=>url.pathname===`/matches/${target}`,route=>{
    if(route.request().method()!=='GET')return route.fallback();
    oldLinkReads++;return route.fulfill({json:cloud});
  });
  if(source==='board')await page.goBack();else await page.goto(`/portal#match=${target}`);
  await expect(page).toHaveURL(new RegExp(`#match=${target}$`));
  const removedNotice=page.getByText('This saved copy was removed from this device. Its recovery data is available in Preserved previous app data.',{exact:true});
  await expect(removedNotice).toBeVisible();await expect(page.getByTestId('game-stage')).toHaveCount(0);
  await page.reload();await expect(removedNotice).toBeVisible();await expect(page.getByTestId('game-stage')).toHaveCount(0);
  expect(oldLinkReads).toBe(0);expect((await read()).data.archives).toEqual(after.data.archives);expect(matchWrites).toEqual([]);
});
