import fs from 'node:fs';
import path from 'node:path';
import {test,expect,type Page} from '@playwright/test';

declare const offline:any;
declare const state:any;

const accountId='device-only-backgammon-storage-test';
const example=JSON.parse(fs.readFileSync(path.join(__dirname,'../games/declarative/backgammon.json'),'utf8'));
const ordinaryCatalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../tests/fixtures/leave_contract/catalog.json'),'utf8'));
const ordinary=ordinaryCatalog.find((game:any)=>game.id==='20a83777-0f59-4105-a09e-0267b9c15e40');
const game={...example,id:'device-only-backgammon-storage-game',version:1,renderer_type:'declarative',game_schemas:ordinary.game_schemas,code:''};

async function savedMatch(page:Page){return page.evaluate(()=>JSON.parse(JSON.stringify(state.match)));}

async function fillRecoverableCaches(page:Page){
  return page.evaluate(()=>{
    const keys=[];
    for(const prefix of ['game-platform.i18n-bundle.v1:','game-platform.i18n-catalog.v1:','game-platform.i18n-games.v1:'])for(const locale of ['es','fr','de','pt','zh','hi','ar'])keys.push({key:prefix+locale,locale});
    localStorage.setItem('game-platform.i18n-recency.v1',JSON.stringify({clock:keys.length,entries:keys.map(({key},index)=>({key,at:index+1}))}));
    const stored=[];
    for(const {key,locale} of keys){
      try{localStorage.setItem(key,JSON.stringify({etag:'recoverable-old-cache',data:{locale,messages:{},games:{},padding:'x'.repeat(256*1024)}}));stored.push(key);}catch(error){if(!(error instanceof DOMException)||error.name!=='QuotaExceededError')throw error;}
    }
    const newest=stored.at(-1)!;let raw=localStorage.getItem(newest)!;
    for(const chunk of [16384,1024,64,1])for(let i=0;i<64;i++){
      try{localStorage.setItem(newest,raw+' '.repeat(chunk));raw=localStorage.getItem(newest)!;}catch(error){if(!(error instanceof DOMException)||error.name!=='QuotaExceededError')throw error;break;}
    }
    let full=false;
    try{localStorage.setItem('quota-probe','x');localStorage.removeItem('quota-probe');}catch(error){full=error instanceof DOMException&&error.name==='QuotaExceededError';}
    return {full,oldest:stored[0],newest,entries:stored.length};
  });
}

async function checkerMove(page:Page){
  const before=await savedMatch(page);
  if(before.state.needRoll){await page.locator('#game-box [data-ui-id="roll"]').click();await expect.poll(async()=>(await savedMatch(page)).move_count).toBeGreaterThan(before.move_count);}
  const rolled=await savedMatch(page);
  const piece=page.locator('#game-box .declarative-piece.actionable[data-actions~="move"]').first();await expect(piece).toBeVisible();await piece.click();
  const target=page.locator('#game-box .declarative-target[data-drop-state="allowed"]').first();await expect(target).toBeVisible();await target.click();
  await expect.poll(async()=>(await savedMatch(page)).move_count).toBeGreaterThan(rolled.move_count);
  await expect(page.locator('#game-box .declarative-error:visible')).toHaveCount(0);
  return savedMatch(page);
}

test('a full browser automatically reclaims old caches so Backgammon saves without losing queued work',async({page,context},testInfo)=>{
  const errors:string[]=[],writes:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(req.method()!=='GET'||!['127.0.0.1','localhost'].includes(url.hostname)){if(req.method()!=='GET'&&url.pathname!=='/client-errors')writes.push(req.method()+' '+url.pathname);return route.abort();}return route.continue();});
  await page.addInitScript(({game,accountId})=>{
    if(window!==window.top)return;
    Object.defineProperty(Navigator.prototype,'onLine',{get:()=>false,configurable:true});
    const account={id:accountId,password:'browser-only-test-credential',display_name:'Device storage verifier',linked:[]};
    localStorage.setItem('game-platform.accounts.v1',JSON.stringify([account]));localStorage.setItem('game-platform.current-account.v1',accountId);localStorage.setItem('game-platform.locale.v1',JSON.stringify('en'));
    const key=`game-platform.portal.v1.${accountId}`;
    if(!localStorage.getItem(key)&&!localStorage.getItem(key+'.meta'))localStorage.setItem(key,JSON.stringify({responses:{'/games':[{id:game.id,version:game.version,name:game.name,renderer_type:game.renderer_type,allowed_player_counts:game.allowed_player_counts}],[`/games/${game.id}/versions/${game.version}`]:game,'/matches':[],'/matches/open':[],'/games/popular?limit=10':[],'/users/me/recent-games':[]},queues:{},local:{},conflicts:{}}));
  },{game,accountId});
  await page.goto(`/static/portal.html?game=${game.id}`);await expect(page.locator('#practice')).toBeEnabled();
  const original=await page.evaluate(()=>{
    const o=offline;o.clearCache();localStorage.removeItem(o.key());
    const data=o.read();data.queues['retained-online']=[{requestId:'retained-request',body:{expected_move_count:0,move:{safe:true}},baseState:{safe:true},baseTurn:[0]}];data.responses['/matches/retained-online']={id:'retained-online',move_count:0,state:{safe:true}};o.write(data);
    localStorage.setItem('unrelated-builder-draft',JSON.stringify({title:'Keep my unfinished work',source:'retained'}));
    return {account:localStorage.getItem('game-platform.accounts.v1'),queue:localStorage.getItem(o.queueKey('retained-online')),snapshot:localStorage.getItem(o.responseKey('/matches/retained-online')),draft:localStorage.getItem('unrelated-builder-draft')};
  });
  const firstPressure=await fillRecoverableCaches(page);expect(firstPressure.full).toBe(true);expect(firstPressure.entries).toBeGreaterThan(1);
  await page.locator('#practice').click();await expect(page.locator('#game-box .declarative-stage')).toBeVisible();
  await expect(page.locator('#create-message')).not.toContainText('storage is full');
  expect(await page.evaluate(key=>localStorage.getItem(key),firstPressure.oldest)).toBeNull();expect(await page.evaluate(key=>localStorage.getItem(key),firstPressure.newest)).not.toBeNull();
  const moved=await checkerMove(page);expect(moved.localMode).toBe('pass');expect(moved.id).toMatch(/^local-/);expect(moved.move_count).toBeGreaterThanOrEqual(2);
  // Saturate again before reload: a failed write probe must not replace a
  // readable, full Storage object with an empty in-memory account store.
  const secondPressure=await fillRecoverableCaches(page);expect(secondPressure.full).toBe(true);
  await page.reload();await expect(page.locator('#game-box .declarative-stage')).toBeVisible();
  const restored=await savedMatch(page);expect(restored.id).toBe(moved.id);expect(restored.move_count).toBe(moved.move_count);expect(restored.state).toEqual(moved.state);
  const pending=await page.evaluate(()=>{const o=offline;return{queue:o.read().queues['retained-online'],memory:Boolean(o.storage.__portalMemoryFallback)};});expect(pending.queue).toHaveLength(1);expect(pending.memory).toBe(false);
  await checkerMove(page);
  const retained=await page.evaluate(()=>{const o=offline;return{account:localStorage.getItem('game-platform.accounts.v1'),queue:localStorage.getItem(o.queueKey('retained-online')),snapshot:localStorage.getItem(o.responseKey('/matches/retained-online')),draft:localStorage.getItem('unrelated-builder-draft')};});expect(retained).toEqual(original);
  expect(await page.evaluate(key=>localStorage.getItem(key),secondPressure.oldest)).toBeNull();expect(await page.evaluate(key=>localStorage.getItem(key),secondPressure.newest)).not.toBeNull();
  expect(errors).toEqual([]);expect(writes).toEqual([]);
  const screenshot=await page.screenshot({fullPage:true}),evidence={firstPressure,secondPressure,saved_moves:(await savedMatch(page)).move_count,preserved:['credentials','queued move','queued snapshot','unrelated draft'],page_errors:errors,server_writes:writes};
  await testInfo.attach('backgammon-after-automatic-storage-recovery',{body:screenshot,contentType:'image/png'});
  await testInfo.attach('storage-pressure-evidence',{body:JSON.stringify(evidence),contentType:'application/json'});
  if(process.env.DECLARATIVE_STORAGE_EVIDENCE_DIR){
    const output=path.resolve(process.env.DECLARATIVE_STORAGE_EVIDENCE_DIR);fs.mkdirSync(output,{recursive:true});
    fs.writeFileSync(path.join(output,`backgammon-storage-${testInfo.project.name}.png`),screenshot);fs.writeFileSync(path.join(output,`storage-${testInfo.project.name}.json`),JSON.stringify(evidence,null,2)+'\n');
  }
});
