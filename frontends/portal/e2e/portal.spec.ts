import {test,expect,Page,APIRequestContext} from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {ensureMatchMenuOpen,createGame,createUser,loginAs,E2E_ADMIN_HEADERS,uniqueName} from './helpers';
import sharedCopy from '../src/platform/ui-copy.json';

const fixture=JSON.parse(readFileSync(path.resolve(__dirname,'../../../games/declarative/tictactoe.json'),'utf8'));
test.beforeEach(async({baseURL,page,request},info)=>{if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Portal acceptance tests require a disposable loopback server.');if(/^(?:host controls|short screens|empty fitted|browser Back from a local|full localized|a delayed browser Back|bundled public-state|a genuinely finished)/.test(info.title))await restore(page,await account(request,'Player 1'));});
async function account(request:APIRequestContext,name:string){const response=await request.post('/users',{data:{display_name:name}});expect(response.ok()).toBeTruthy();return response.json();}
async function restore(page:Page,user:any){await page.addInitScript(user=>{localStorage.setItem('game-platform.accounts.v1',JSON.stringify([user]));localStorage.setItem('game-platform.current-account.v1',user.id);},user);}
async function game(request:APIRequestContext,name:string){const id=await createGame(request,name);const response=await request.get(`/games/${id}`);expect(response.ok(),await response.text()).toBeTruthy();return response.json();}

test('host controls and the offline starter game retain all eight languages without changing saves',async({page,request})=>{
  test.setTimeout(120000);
  const copy=(source:string,locale:string)=>locale==='en'?source:(sharedCopy as Record<string,Record<string,string>>)[source][locale];
  const locales=(await (await request.get('/i18n/locales')).json()).locales;
  await page.goto('/portal#local');
  await page.getByRole('button',{name:'Pass and play',exact:true}).click();await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  // Constructed roster fixtures exercise the API's valid 200-codepoint names;
  // they are local layout evidence, not a claim of multiplayer browser play.
  const names=['مرحباالعالم世界🙂Ω'.repeat(20), 'Alice العربية 中文 👩🏽‍🚀🦊'.repeat(20)].map(name=>Array.from(name).slice(0,200).join(''));
  await page.evaluate(names=>{for(const key of Object.keys(localStorage).filter(key=>key.startsWith('buildplay.shared.v1.'))){const data=JSON.parse(localStorage.getItem(key)!);for(const match of Object.values(data.local||{}) as any[])match.players.forEach((player:any,index:number)=>{player.name=names[index%names.length];});localStorage.setItem(key,JSON.stringify(data));}},names);
  await page.reload();await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  const saves=()=>page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(key=>key.startsWith('buildplay.shared.v1.')).map(key=>[key,JSON.parse(localStorage.getItem(key)!).local])));
  const original=await saves();let current='en';
  await ensureMatchMenuOpen(page);
  const board=await page.getByTestId('game-stage').locator('svg').first().elementHandle();
  for(const locale of ['es','fr','de','pt','zh','hi','ar','en']){
    await page.getByRole('button',{name:copy('Account menu',current),exact:true}).click();
    const entry=locales.find((item:any)=>item.code===locale),endonym=entry.native_name||entry.name||locale;
    const language=page.getByRole('button').filter({hasText:endonym});await language.last().click();
    await expect(page.locator('html')).toHaveAttribute('lang',locale);await expect(page.locator('html')).toHaveAttribute('dir',locale==='ar'?'rtl':'ltr');
    await page.getByRole('button',{name:copy('Close dialog',locale),exact:true}).click();
    await expect(page.getByRole('button',{name:copy('Play history',locale),exact:true})).toBeVisible();
    const cell=locale==='en'?'Cell {n}':fixture.translations[locale].client_strings.cell;
    await expect(page.getByRole('button',{name:cell.replace('{n}','1'),exact:true})).toBeVisible();
    expect(await board!.evaluate(node=>node===document.querySelector('[data-testid="game-stage"] svg'))).toBe(true);
    for(const size of [{width:320,height:480},{width:480,height:320},{width:820,height:1180},{width:1180,height:820}]){
      await page.setViewportSize(size);
      for(const name of names){const label=page.getByText(name,{exact:true});await expect(label).toHaveText(name);await expect.poll(async()=>{const box=(await label.boundingBox())!;return box.x>=-1&&box.x+box.width<=size.width+1;}).toBe(true);}
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);current=locale;
  }
  expect(await saves()).toEqual(original);
});

test('short screens refit the complete board after rotation and resizing without page scrolling',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/portal#local');
  await page.getByRole('button',{name:'Pass and play',exact:true}).click();
  const board=page.getByLabel('Game board. Use pieces and highlighted destinations.');
  const canvas=board.locator('svg').first();await expect(page.getByRole('button',{name:'Cell 9',exact:true})).toBeAttached();
  const route=page.url(),id=decodeURIComponent(new URL(route).hash.slice('#match='.length));
  const savedMoves=()=>page.evaluate(id=>{for(const key of Object.keys(localStorage).filter(key=>key.startsWith('buildplay.shared.v1.'))){const match=JSON.parse(localStorage.getItem(key)!).local?.[id];if(match)return match.move_count;}return null;},id);
  for(const [index,viewport] of [{width:320,height:480},{width:480,height:320},{width:844,height:390},{width:390,height:844},{width:1024,height:600},{width:600,height:1024}].entries()){
    const original=await canvas.elementHandle(),cell=page.getByRole('button',{name:`Cell ${9-index}`,exact:true});
    await expect(cell).toHaveAttribute('aria-disabled','false');
    await board.focus();await page.keyboard.press('+');await page.keyboard.press('ArrowRight');
    await expect(canvas).not.toHaveAttribute('viewBox','0 0 600 560');
    await page.setViewportSize(viewport);
    await expect(canvas).toHaveAttribute('viewBox','0 0 600 560');
    await expect.poll(async()=>{const box=(await board.boundingBox())!;return box.x>=-1&&box.y>=-1&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1;}).toBe(true);
    const geometry=(await board.boundingBox())!;expect(geometry.width).toBeCloseTo(viewport.width,0);
    await expect.poll(()=>cell.evaluate(node=>{const r=node.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
    expect(await board.evaluate(node=>{for(let p:HTMLElement|null=node as HTMLElement;p;p=p.parentElement)if(p.scrollHeight>p.clientHeight+1||p.scrollWidth>p.clientWidth+1)return false;return true;})).toBe(true);
    expect(await original!.evaluate(node=>node.isConnected)).toBe(true);expect(page.url()).toBe(route);
    await page.screenshot({path:info.outputPath(`fitted-board-${viewport.width}x${viewport.height}.png`)});
    // The very first physical pointer gesture after resize and keyboard zoom
    // must play the intended square in this same saved match.
    await cell.click();await expect(cell).toHaveCount(0);await expect.poll(savedMoves).toBe(index+1);
    await expect(page.getByRole('button',{name:'I’m ready'})).toHaveCount(0);
  }
  await ensureMatchMenuOpen(page);
  const port=await page.getByTestId('match-details').evaluateHandle(node=>{for(let p=node.parentElement;p;p=p.parentElement)if(/auto|scroll/.test(getComputedStyle(p).overflowY))return p;throw new Error('Missing details scroll view');});
  await page.mouse.move(15,500);await page.mouse.wheel(0,1800);
  await expect.poll(()=>port.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
  await page.getByTestId('match-menu-button').click();
  await expect(page.getByTestId('match-menu-button')).toHaveAttribute('aria-expanded','false');
  await expect.poll(()=>port.evaluate(node=>node.scrollTop)).toBe(0);
  await expect(canvas).toHaveAttribute('viewBox','0 0 600 560');
  await expect.poll(async()=>{const box=(await board.boundingBox())!;return box.y>=-1&&box.y+box.height<=1025;}).toBe(true);
  await page.getByRole('button',{name:'Cell 2',exact:true}).click();
  await expect.poll(savedMoves).toBe(7);expect(page.url()).toBe(route);
});

test('empty fitted board space does not scroll or pan and retains real piece taps',async({page,isMobile})=>{
  test.skip(!isMobile,'Uses the mobile project’s native touch input');
  await page.setViewportSize({width:480,height:180});await page.goto('/portal#local');await page.getByRole('button',{name:'Pass and play',exact:true}).click();
  const board=page.getByLabel('Game board. Use pieces and highlighted destinations.');
  const cell=page.getByRole('button',{name:'Cell 9',exact:true});await expect(cell).toBeInViewport();
  const before=await board.evaluate(node=>{const values=[];for(let p:HTMLElement|null=node as HTMLElement;p;p=p.parentElement)values.push(p.scrollTop);return values;});
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:5,y:160,id:1}]});
  for(let step=1;step<=8;step++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:5,y:160-140*step/8,id:1}]});await page.waitForTimeout(16);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect(await board.evaluate(node=>{const values=[];for(let p:HTMLElement|null=node as HTMLElement;p;p=p.parentElement)values.push(p.scrollTop);return values;})).toEqual(before);
  await expect(board.locator('svg').first()).toHaveAttribute('viewBox','0 0 600 560');await expect(cell).toBeVisible();
  await cell.tap();await expect(cell).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeAttached();await expect(page.getByRole('button',{name:'I’m ready'})).toHaveCount(0);
});

test('online matches have human-only controls and stay selected after reload',async({page,request})=>{
  const user=await account(request,'Reload player'),created=await game(request,uniqueName('Reload game'));
  await restore(page,user);await page.goto(`/portal#game=${created.id}`);
  await expect(page.getByText('Computer opponents',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Who can join?',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Find an open match',exact:true})).toHaveCount(0);
  await expect(page.getByTestId('play-computer').getByRole('button',{name:'Play against the computer',exact:true})).toBeVisible();
  const creation=page.waitForRequest(request=>request.method()==='POST'&&new URL(request.url()).pathname==='/matches');
  await page.getByTestId('play-online').getByRole('button',{name:'Invite your friends to play',exact:true}).click();
  const submitted=await creation,body=submitted.postDataJSON();
  expect(body).toEqual({game_id:created.id,bet_per_player:0,turn_seconds:null,match_kind:'multiplayer',num_computer_opponents:0,client_match_id:expect.any(String)});
  expect(body.client_match_id).toBeTruthy();expect(submitted.headers()['idempotency-key']).toBe(body.client_match_id);
  await expect(page.getByRole('button',{name:'Share link',exact:true})).toBeVisible();
  await expect(page).toHaveURL(/#match=/);
  await expect(page.getByText(/^(?:Public match|Invite only)$/)).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Add a computer',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Remove a computer',exact:true})).toHaveCount(0);
  const current=new URL(page.url()),selected=new URLSearchParams(current.hash.slice(1)).get('match');
  expect(selected).toBe(body.client_match_id);
  const state=await (await request.get(`/matches/${selected}`)).json();
  expect(state.id).toBe(body.client_match_id);expect(state.match_kind).toBe('multiplayer');
  expect(state.players).toHaveLength(1);expect(state.players[0].kind).toBe('human');
  expect(state).not.toHaveProperty('private');
  const resumed=page.waitForResponse(response=>new URL(response.url()).pathname===(selected?`/matches/${selected}`:`/games/${created.id}`));
  await page.reload();
  await resumed;
  await expect(page.getByRole('button',{name:'Share link',exact:true})).toBeVisible();
  expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('match')).toBe(body.client_match_id);
  expect(await page.evaluate(id=>Object.keys(localStorage).filter(key=>key.startsWith('buildplay.shared.v1.')).some(key=>{const data=JSON.parse(localStorage.getItem(key)!);return data.selectedId===id&&data.responses?.[`/matches/${id}`]?.id===id;}),body.client_match_id)).toBe(true);
  const opened:string[]=[];page.on('request',request=>opened.push(new URL(request.url()).pathname));
  await page.goto('/portal#matches');
  await expect(page.getByText('Open matches you can join',{exact:true})).toHaveCount(0);
  expect(opened).not.toContain('/matches/open');expect(opened).not.toContain('/v2/matches/open');
});

test('visitors can watch existing matches after the game leaves the catalog',async({page,request})=>{
  const host=await account(request,'Archived match host'),opponent=await account(request,'Archived match opponent'),created=await game(request,uniqueName('Archived public match'));
  const headers={'X-User-Id':host.id,'X-User-Password':host.password};
  const response=await request.post('/matches',{headers,data:{game_id:created.id}});expect(response.ok()).toBeTruthy();const match=await response.json();
  const joined=await request.post(`/matches/${match.id}/join`,{headers:{'X-User-Id':opponent.id,'X-User-Password':opponent.password}});expect(joined.ok()).toBeTruthy();
  const started=await request.post(`/matches/${match.id}/start`,{headers});expect(started.ok()).toBeTruthy();
  const moved=await request.post(`/matches/${match.id}/moves`,{headers,data:{move:{cell:0},expected_move_count:0}});expect(moved.ok()).toBeTruthy();
  const withdrawal=await request.post(`/games/${created.id}/unpublish`,{headers:E2E_ADMIN_HEADERS});expect(withdrawal.ok(),await withdrawal.text()).toBeTruthy();
  expect((await request.get(`/games/${created.id}/versions/${created.version}`)).status()).toBe(404);
  const packageResponse=page.waitForResponse(response=>new URL(response.url()).pathname===`/matches/${match.id}/game`);
  await page.goto(`/portal#match=${match.id}`);expect((await packageResponse).ok()).toBeTruthy();await ensureMatchMenuOpen(page);
  await expect(page.getByRole('heading',{name:created.name,exact:true})).toBeVisible();
  await expect(page.getByTestId('game-stage')).toBeVisible();
  await expect(page.getByText('Game in progress',{exact:true})).toBeVisible();
  await expect(page.getByText(/^(?:Public match|Invite only)$/)).toHaveCount(0);
  await page.reload();await ensureMatchMenuOpen(page);await expect(page.getByRole('heading',{name:created.name,exact:true})).toBeVisible();
  await expect(page.getByTestId('game-stage')).toBeVisible();
  await expect(page.getByText('Game in progress',{exact:true})).toBeVisible();
});

test('browser Back from a local match restores its game detail screen and play controls',async({page,request})=>{
  const created=await game(request,uniqueName('History game'));await page.goto(`/portal#game=${created.id}`);
  await page.getByTestId('play-pass').getByRole('button',{name:'Pass and play',exact:true}).click();await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  await expect(page).toHaveURL(/#match=local-/);await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#game=${created.id}$`));await expect(page.getByRole('heading',{name:created.name,exact:true})).toBeVisible();
  await expect(page.getByTestId('play-pass').getByRole('button',{name:'Pass and play',exact:true})).toBeVisible();
});

test('full localized instructions remain available between public turns, at game end and read-only replay',async({page,request})=>{
  const created=await game(request,uniqueName('Instruction game'));await page.goto(`/portal#game=${created.id}`);
  await page.getByTestId('header-account').click();await page.getByRole('button').filter({hasText:'العربية'}).last().click();
  await expect(page.locator('html')).toHaveAttribute('lang','ar');await page.getByRole('button',{name:sharedCopy['Close dialog'].ar,exact:true}).click();
  await expect(page.getByTestId('game-instructions')).toContainText(created.translations.ar.game_logic_rules);
  await expect(page.getByTestId('game-instructions')).toContainText(created.translations.ar.game_ui_rules);
  await page.getByTestId('header-account').click();await page.getByRole('button').filter({hasText:'English'}).last().click();
  await expect(page.locator('html')).toHaveAttribute('lang','en');await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(page.getByTestId('game-instructions')).toContainText(created.game_logic_rules);
  await expect(page.getByTestId('game-instructions')).not.toContainText(created.translations.ar.game_logic_rules);
  await page.getByTestId('play-pass').getByRole('button',{name:'Pass and play',exact:true}).click();
  await expect(page.getByTestId('game-stage')).toBeVisible();await ensureMatchMenuOpen(page);
  await expect(page.getByText('Saved in the cloud',{exact:true})).toBeVisible();
  const helpButton=page.getByRole('button',{name:'How to play',exact:true});
  const helpBounds=await helpButton.boundingBox(),boardBounds=await page.getByTestId('game-stage').boundingBox();
  expect(helpBounds).not.toBeNull();expect(boardBounds).not.toBeNull();
  expect(Math.abs(helpBounds!.x+helpBounds!.width-(boardBounds!.x+boardBounds!.width))).toBeLessThan(4);
  expect(helpBounds!.y+helpBounds!.height).toBeLessThanOrEqual(boardBounds!.y);
  for(const [index,cell] of [1,4,2,5,3].entries()){
    if(index){
      await expect(page.getByTestId('game-stage')).toBeVisible();await expect(page.getByRole('button',{name:'I’m ready'})).toHaveCount(0);
      await page.getByRole('button',{name:'How to play',exact:true}).click();await expect(page.getByTestId('game-instructions')).toContainText(created.game_logic_rules);
      await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    }
    const target=page.getByRole('button',{name:`Cell ${cell}`,exact:true});await target.click();await expect(target).toHaveCount(0);
  }
  await expect(page.getByTestId('match-outcome')).toHaveText('Player 1 won');
  const svg=await page.getByTestId('game-stage').locator('svg').first().elementHandle();
  await page.getByRole('button',{name:'How to play',exact:true}).click();await expect(page.getByTestId('game-instructions')).toContainText(created.game_ui_rules);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();expect(await svg!.evaluate(node=>node===document.querySelector('[data-testid="game-stage"] svg'))).toBe(true);
  await page.getByRole('button',{name:'← Previous',exact:true}).click();await expect(page.getByText('Replay · move 4 of 5')).toBeVisible();
  await page.getByRole('button',{name:'How to play',exact:true}).click();await expect(page.getByTestId('game-instructions')).toContainText(created.game_logic_rules);
  await expect(page.getByTestId('game-stage').locator('[role="button"][aria-disabled="false"]')).toHaveCount(0);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(page.getByTestId('match-outcome')).toHaveText('Player 1 won');
});

test('a delayed browser Back response cannot replace newer Matches navigation',async({page,request})=>{
  const created=await game(request,uniqueName('Delayed history game'));await page.goto(`/portal#game=${created.id}`);
  await page.getByTestId('play-pass').getByRole('button',{name:'Pass and play',exact:true}).click();await expect(page).toHaveURL(/#match=local-/);
  let release!:()=>void,started!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;}),requested=new Promise<void>(resolve=>{started=resolve;});
  await page.route(`**/games/${created.id}`,async route=>{started();await held;await route.continue();});
  await page.goBack();await requested;
  await page.getByRole('button',{name:'Matches',exact:true}).click();await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
  const response=page.waitForResponse(response=>new URL(response.url()).pathname===`/games/${created.id}`);
  release();await (await response).finished();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(page).toHaveURL(/#matches$/);await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
});

test('campaign arrival persists before login and attributes the guest signup',async({page,request})=>{
  const name=uniqueName('Arrival campaign');
  const key=uniqueName('arrival-campaign').toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,50);
  const created=await request.post('/admin/experiments/campaign-links',{headers:E2E_ADMIN_HEADERS,data:{name,key}});
  expect(created.status()).toBe(201);
  const campaign=await created.json();
  try{
    await page.goto(`/c/${key}`);
    await expect(page).toHaveURL(new RegExp(`/portal\\?campaign=${key}$`));
    await expect.poll(()=>page.evaluate(()=>localStorage.getItem('game-platform.experiment-campaign.v1'))).toBe(key);
    // Drop the query before logging in: attribution must survive navigation.
    await page.goto('/portal');
    await page.getByRole('button',{name:'Log in',exact:true}).first().click();
    const guestName=uniqueName('Campaign guest');
    await page.getByRole('textbox',{name:/Your name|Display name/}).fill(guestName);
    const signupRequest=page.waitForRequest(request=>request.method()==='POST'&&new URL(request.url()).pathname==='/users');
    await page.getByRole('button',{name:'Continue as guest',exact:true}).click();
    const signup=await signupRequest;
    expect(signup.headers()['x-campaign-code']).toBe(key);
    expect(signup.headers()['authorization']).toBeUndefined();
    await expect(page.getByRole('button',{name:'Account menu'})).toHaveAccessibleDescription(guestName);
    await page.reload();
    await expect(page.getByRole('button',{name:'Account menu'})).toHaveAccessibleDescription(guestName);
    expect(await page.evaluate(()=>localStorage.getItem('game-platform.experiment-campaign.v1'))).toBe(key);
    const stats=await request.get('/admin/experiments',{headers:E2E_ADMIN_HEADERS});
    expect(stats.ok()).toBeTruthy();
    const variant=(await stats.json()).campaign_experiment.variants.find((item:{key:string})=>item.key===key);
    expect(variant).toMatchObject({clicks:1,signups:1});
  }finally{
    await request.delete(`/admin/experiments/ad-campaigns/variants/${campaign.variant_id}`,{headers:E2E_ADMIN_HEADERS});
  }
});

for(const savedLayout of ['hamburger','left'])test(`navigation stays directly accessible with the saved ${savedLayout} layout`,async({page})=>{
  await page.addInitScript(layout=>localStorage.setItem('buildplay.navigation.v2',layout),savedLayout);
  await page.goto('/portal');
  await expect(page.getByRole('button',{name:'Navigation menu',exact:true})).toHaveCount(0);
  await expect(page.getByText('☰',{exact:true})).toHaveCount(0);
  for(const name of ['Games','Matches'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(1);
  await expect(page.getByRole('button',{name:'On this device',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Invites',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Matches',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Log in',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Close dialog',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(page.getByRole('button',{name:'Preferences',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Privacy',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Navigation layout: Menu',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Navigation layout: Top navigation',exact:true})).toHaveCount(0);
  for(const width of [1200,900,390]){
    await page.setViewportSize({width,height:850});
    await page.getByRole('button',{name:'Matches',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Matches',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Navigation menu',exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
});

test('a full legacy browser cache is evicted automatically while durable saves and new offline play survive',async({page,request,context})=>{
  const created=await game(request,uniqueName('Quota recovery game'));
  await page.addInitScript(()=>{
    const write=Storage.prototype.setItem;
    const pending={requestId:'preserved-legacy-request',body:{move:{cell:2},expected_move_count:4},baseState:{original:true},baseTurn:[1]};
    if(!sessionStorage.getItem('quota-test-seeded')){
      const legacy={responses:{'/old-unused-download':'x'.repeat(350000),'/matches/pending':{id:'pending',game_id:'preserved',game_version:7},'/games/preserved/versions/7':{server_code:'exact saved rules'}},cacheAccess:{'/old-unused-download':1},queues:{pending:[pending]},conflicts:{},local:{},archives:[{source:'original recovery'}],archivedMatches:[],selectedId:null,unknownRecovery:{keep:true}};
      write.call(localStorage,'game-platform.portal.v1.visitor',JSON.stringify(legacy));
      write.call(localStorage,'game-platform.i18n-bundle.v1:unused',JSON.stringify({data:'y'.repeat(100000)}));
      write.call(localStorage,'game-platform.i18n-recency.v1',JSON.stringify({clock:Date.now(),entries:[{key:'game-platform.i18n-bundle.v1:unused',at:Date.now()}]}));
      write.call(localStorage,'game-platform.accounts.v1','[]');
      write.call(localStorage,'game-platform.current-account.v1','visitor');
      write.call(localStorage,'buildplay.shared.v1.other-account','protected other account bytes');
      sessionStorage.setItem('quota-test-seeded','1');
    }
    const size=()=>Object.keys(localStorage).reduce((n,key)=>n+new TextEncoder().encode(key+localStorage.getItem(key)).length,0);
    const limit=Number(sessionStorage.getItem('quota-test-limit'))||size()+1024;sessionStorage.setItem('quota-test-limit',String(limit));
    Storage.prototype.setItem=function(key:string,value:string){
      const replaced=new TextEncoder().encode(key+(this.getItem(key)||'')).length;
      if(this===localStorage&&size()-replaced+new TextEncoder().encode(key+value).length>limit)throw new DOMException('The quota has been exceeded.','QuotaExceededError');
      write.call(this,key,value);
    };
  });
  await page.goto(`/portal#game=${created.id}`);
  await expect(page.getByTestId('play-pass').getByRole('button',{name:'Pass and play',exact:true})).toBeVisible();
  await expect(page.getByText(/Could not save downloaded data|Saved data needs attention/)).toHaveCount(0);
  const preserved=await page.evaluate(()=>{
    const legacy=JSON.parse(localStorage.getItem('game-platform.portal.v1.visitor')!);
    const current=Object.keys(localStorage).find(key=>key.startsWith('buildplay.shared.v1.')&&key.endsWith('.visitor'))!;
    return {legacy,saved:JSON.parse(localStorage.getItem(current)!),credentials:localStorage.getItem('game-platform.accounts.v1'),selection:localStorage.getItem('game-platform.current-account.v1'),other:localStorage.getItem('buildplay.shared.v1.other-account')};
  });
  expect(preserved.legacy.responses['/old-unused-download']).toBeUndefined();
  expect(preserved.saved.responses['/old-unused-download']).toBeUndefined();
  expect(preserved.legacy.queues.pending[0].requestId).toBe('preserved-legacy-request');
  expect(preserved.saved.queues).toEqual(preserved.legacy.queues);
  expect(preserved.saved.archives).toEqual([{source:'original recovery'}]);
  expect(preserved.legacy.unknownRecovery).toEqual({keep:true});
  expect(preserved.saved.responses['/games/preserved/versions/7'].server_code).toBe('exact saved rules');
  expect(preserved.credentials).toBe('[]');expect(preserved.selection).toBe('visitor');expect(preserved.other).toBe('protected other account bytes');
  const owner=await createUser(request,'Player 1');await loginAs(page,owner);await page.reload();await expect(page.getByTestId('header-account')).toHaveAccessibleName('Account menu');await expect(page.getByRole('heading',{name:created.name,exact:true})).toBeVisible();
  await page.evaluate(async()=>{if('serviceWorker'in navigator)await navigator.serviceWorker.ready;});await context.setOffline(true);
  await page.getByTestId('play-pass').getByRole('button',{name:'Pass and play',exact:true}).click();
  await page.getByRole('button',{name:'Cell 1',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'I’m ready',exact:true})).toHaveCount(0);
  await expect(page.getByText(/Could not save downloaded data|Saved data needs attention/)).toHaveCount(0);
});

test('guest identity survives reload, shared navigation stays responsive, and bug reporting works',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/portal');await page.getByRole('button',{name:'Log in',exact:true}).first().click();
  await page.getByRole('textbox',{name:/Your name|Display name/}).fill('Shared guest');
  await page.getByRole('button',{name:/Continue as guest/}).click();
  await expect(page.getByRole('button',{name:'Account menu'})).toHaveAccessibleDescription('Shared guest');
  await page.reload();await expect(page.getByRole('button',{name:'Account menu'})).toHaveAccessibleDescription('Shared guest');
  await page.getByRole('button',{name:'Report a bug or request a feature',exact:true}).click();
  await page.getByRole('textbox',{name:'Bug or feature request'}).fill('The shared portal feedback acceptance check.');
  await page.getByRole('button',{name:'Send report',exact:true}).click();await expect(page.getByText('Thanks! Your report was sent.')).toBeVisible();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Matches',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Account menu',exact:true}).click();
  await expect(page.getByRole('button',{name:'Privacy',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();
  expect(errors).toEqual([]);
});

test('bundled public-state game is playable offline without handoffs, persists, and replays',async({page,context})=>{
  await page.goto('/portal#local');
  await page.getByRole('button',{name:'Pass and play',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  // Account preferences stay reachable through the match menu.
  await ensureMatchMenuOpen(page);
  await page.getByRole('button',{name:'Account menu',exact:true}).click();await expect(page.getByRole('button',{name:/Language:.*English/})).toBeVisible();await page.getByRole('button',{name:'Close dialog'}).click();await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  // Install/cache the universal shell before taking the device offline.
  await page.evaluate(async()=>{if('serviceWorker'in navigator)await navigator.serviceWorker.ready;});
  await context.setOffline(true);
  await page.getByRole('button',{name:'Cell 1',exact:true}).click();await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'I’m ready'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Play history',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'← Previous',exact:true})).toBeEnabled();
  await page.reload();await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible();await ensureMatchMenuOpen(page);
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'I’m ready'})).toHaveCount(0);
  for(const cell of [4,2,5,3]){await page.getByRole('button',{name:`Cell ${cell}`,exact:true}).click();await expect(page.getByRole('button',{name:'Cell '+cell,exact:true})).toHaveCount(0);}
  await expect(page.getByText('Finished',{exact:true}).first()).toBeVisible();
  await expect(page.getByTestId('match-outcome')).toHaveText('Player 1 won');
  await page.getByRole('button',{name:'← Previous',exact:true}).click();await expect(page.getByText('Replay · move 4 of 5')).toBeVisible();
  await page.getByRole('button',{name:'Play history',exact:true}).click();await expect(page.getByText('Replay · move 5 of 5')).toBeVisible();await expect(page.getByRole('button',{name:'Play history',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Live board',exact:true}).click();await expect(page.getByText('Live board',{exact:true}).first()).toBeVisible();
  await context.setOffline(false);
  await page.goto('/portal#local');
  await expect(page.getByTestId('match-outcome')).toHaveText('Player 1 won');
});

test('a genuinely finished local draw stays translated offline in detail and match list',async({page,context})=>{
  await page.goto('/portal#local');await page.getByRole('button',{name:'Pass and play',exact:true}).click();
  for(const cell of [1,2,3,5,4,6,8,7,9]){
    const target=page.getByRole('button',{name:`Cell ${cell}`,exact:true});await target.click();await expect(target).toHaveCount(0);
  }
  await ensureMatchMenuOpen(page);
  await expect(page.getByTestId('match-outcome')).toHaveText('Draw');
  // Spanish has never been downloaded in this fresh browser context.
  await context.setOffline(true);
  await page.getByRole('button',{name:'Account menu',exact:true}).click();
  await page.getByRole('button',{name:/Language:.*Español/}).click();
  await expect(page.locator('html')).toHaveAttribute('lang','es');
  await page.getByRole('button',{name:'Cerrar diálogo',exact:true}).click();
  await expect(page.getByTestId('match-outcome')).toHaveText('Empate');
  await page.goto('/portal#local');await expect(page.getByTestId('match-outcome')).toHaveText('Empate');
});

test('short invitation autojoins after guest sign-in and offers code copying and system sharing',async({page,request})=>{
  test.setTimeout(120000);
  const owner=await account(request,'Invite host'),created=await game(request,`Shared invite ${Date.now()}`),headers={'X-User-Id':owner.id,'X-User-Password':owner.password};
  const response=await request.post('/matches',{headers,data:{game_id:created.id}});expect(response.ok()).toBeTruthy();const match=await response.json();
  expect(match.invite_code).toMatch(/^[a-z]{4}$/);
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'share',{configurable:true,value:async(value:any)=>{(window as any).__sharedInvite=value;}});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{(window as any).__copiedInvite=value;}}});
  });
  await page.goto(`/invite/${match.invite_code}`);await expect(page.getByRole('heading',{name:created.name,exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:/Invite link|Player code or ID|Open a match or invite link/})).toHaveCount(0);
  await page.getByRole('button',{name:'Log in to join',exact:true}).click();
  await page.getByRole('textbox',{name:/Your name|Display name/}).fill('Invited guest');await page.getByRole('button',{name:'Continue as guest',exact:true}).click();
  await expect(page.getByRole('button',{name:'Close dialog'})).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#match=${match.id}$`));
  await expect(page.getByRole('button',{name:'Join match',exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Match invite QR code')).toHaveCount(0);
  await page.getByRole('button',{name:'Copy code',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__copiedInvite)).toBe(match.invite_code);
  await page.getByRole('button',{name:'Share link',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__sharedInvite?.url)).toBe(new URL(`/invite/${match.invite_code}`,page.url()).href);
  const detail=await(await request.get(`/matches/${match.id}`,{headers})).json();expect(detail.players).toHaveLength(2);
  await page.reload();await expect(page.getByRole('heading',{name:created.name,exact:true})).toBeVisible();
});

test('a signed-in player opening a full invitation watches without taking a seat',async({page,request})=>{
  const host=await account(request,'Full invite host'),opponent=await account(request,'Full invite opponent'),viewer=await account(request,'Full invite spectator'),created=await game(request,uniqueName('Full invite'));
  const headers={'X-User-Id':host.id,'X-User-Password':host.password};
  const response=await request.post('/matches',{headers,data:{game_id:created.id}});expect(response.ok()).toBeTruthy();const match=await response.json();
  expect((await request.post(`/matches/${match.id}/join`,{headers:{'X-User-Id':opponent.id,'X-User-Password':opponent.password}})).ok()).toBeTruthy();
  await restore(page,viewer);await page.goto(`/invite/${match.invite_code}`);
  await expect(page).toHaveURL(new RegExp(`#match=${match.id}$`));await expect(page.getByRole('heading',{name:created.name,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Join match',exact:true})).toHaveCount(0);
  const detail=await(await request.get(`/matches/${match.id}`,{headers})).json();expect(detail.players).toHaveLength(2);expect(detail.players.some((player:any)=>player.user_id===viewer.id)).toBe(false);
});

test('two browser players share turns, a lost reply cannot duplicate a move, and offline actions sync',async({page,browser,request,baseURL})=>{
  test.setTimeout(120000);
  const a=await account(request,'Shared Alice'),b=await account(request,'Shared Bob');
  const created=await game(request,`Shared cross-device ${Date.now()}`),headers={'X-User-Id':a.id,'X-User-Password':a.password};
  const response=await request.post('/matches',{headers,data:{game_id:created.id}});expect(response.ok()).toBeTruthy();const match=await response.json();
  await restore(page,a);await page.goto(`/portal#match=${match.id}`);
  const partner=await browser.newContext({baseURL});const bob=await partner.newPage();await restore(bob,b);await bob.goto(`/portal#match=${match.id}`);
  await bob.getByRole('button',{name:'Join match',exact:true}).click();
  await expect(page.getByRole('button',{name:'Start match',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Start match',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  await ensureMatchMenuOpen(page);await ensureMatchMenuOpen(bob);
  let lost=false;
  await page.route(`**/matches/${match.id}/moves`,async route=>{if(route.request().method()==='POST'&&!lost){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();});
  await page.getByRole('button',{name:'Cell 1',exact:true}).click();
  await expect(bob.getByRole('button',{name:'Cell 4',exact:true})).toBeVisible();await bob.getByRole('button',{name:'Cell 4',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible({timeout:20000});
  const state=await request.get(`/matches/${match.id}`,{headers});expect((await state.json()).move_count).toBe(2);
  await page.context().setOffline(true);await page.getByRole('button',{name:'Cell 2',exact:true}).click();
  await expect(page.getByText(/Your move is saved and waiting/)).toBeVisible();
  await page.context().setOffline(false);await expect(bob.getByRole('button',{name:'Cell 5',exact:true})).toBeVisible({timeout:20000});
  await bob.getByRole('button',{name:'Cell 5',exact:true}).click();await expect(page.getByRole('button',{name:'Cell 3',exact:true})).toBeVisible();await page.getByRole('button',{name:'Cell 3',exact:true}).click();
  await expect(page.getByText('Finished',{exact:true}).first()).toBeVisible();await expect(bob.getByText('Finished',{exact:true}).first()).toBeVisible();
  expect((await(await request.get(`/matches/${match.id}`,{headers})).json()).move_count).toBe(5);
  await partner.close();
});
