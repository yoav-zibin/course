import {test,expect,type Locator,type Page} from '@playwright/test';
import path from 'node:path';
// The canvas owns pointer input and hit-tests SVG geometry. Tap its physical
// coordinates, since the root SVG intentionally receives these pointer events.
async function physicalTap(page:Page,target:Locator,mobile:boolean){await target.scrollIntoViewIfNeeded();const box=await target.boundingBox();expect(box).toBeTruthy();const x=box!.x+box!.width/2,y=box!.y+box!.height/2;if(mobile)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);}
const kinds=['six-card-golf','war','crazy-eights','hearts','michigan','quoridor','concentration','casino-war','old-maid','blackjack'];
for(const kind of kinds){
 test(`${kind}: single physical tap, scenarios and responsive table`,async({page},testInfo)=>{
  test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:8173/?game=${kind}`);await expect(page.locator('#status')).toContainText('Your turn',{timeout:20000});await page.getByLabel('Pause computers').check();
  const frame=page.frameLocator('#board iframe');
  await expect(frame.getByLabel('Game board. Use pieces and highlighted destinations. Zoom controls are above the board.').locator(':scope > svg')).toBeVisible();
  const actions=frame.locator('svg [role="button"][aria-disabled="false"]');
  const controls=frame.getByRole('button').filter({hasNotText:/^(−|\+|100%)$/});
  await expect.poll(async()=>await actions.count()+await controls.count()).toBeGreaterThan(0);
  await page.waitForTimeout(1800);
  expect((await frame.locator('svg text').allTextContents()).filter(text=>['↖','↔','⇋','↗','↻'].includes(text))).toEqual([]);
  if(await actions.count())await expect.poll(()=>frame.locator('svg [stroke="#79d5ff"], svg [stroke="#c9ff63"]').count()).toBeGreaterThan(0);
  const before=await page.locator('#status').innerText();let posts=0;
  page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/move/'))posts++;});
  if(await actions.count()){
   await physicalTap(page,kind==='quoridor'?frame.getByRole('button',{name:/^Move pawn to row/}).first():actions.first(),testInfo.project.name==='phone');
   if(kind==='six-card-golf'){await expect(page.locator('#status')).toHaveText(before);await physicalTap(page,actions.nth(1),testInfo.project.name==='phone');}
   if(kind==='crazy-eights'&&posts===0){const suit=frame.getByRole('button',{name:/^(♣|♦|♠|♥) /}).first();if(await suit.count())await suit.click();}
  }else await controls.first().click();
  await expect.poll(()=>posts).toBe(1);await page.waitForTimeout(250);expect(posts).toBe(1);
  await expect(page.locator('#status')).not.toHaveText(before);
  for(const scenario of ['intermediate','terminal']){
   await page.getByLabel('Scenario').selectOption(scenario);
   await expect(frame.getByLabel('Game board. Use pieces and highlighted destinations. Zoom controls are above the board.').locator(':scope > svg')).toBeVisible();await page.waitForTimeout(250);
   expect(await frame.getByRole('alert').count()).toBe(0);
   await page.screenshot({path:path.join(testInfo.outputDir,`${kind}-${scenario}.png`),fullPage:true});
  }
  await page.getByLabel('Scenario').selectOption('');await page.waitForTimeout(300);
  const overflowing=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflowing).toBe(false);
  await page.screenshot({path:path.join(testInfo.outputDir,`${kind}-board.png`),fullPage:true});
  expect(errors).toEqual([]);
 });
}
test('Casino War: only dealer flips, and reduced motion stays still',async({page})=>{
 await page.goto('http://127.0.0.1:8173/?game=casino-war');await page.getByLabel('Pause computers').check();
 await page.getByLabel('Scenario').selectOption('intermediate');const f=page.frameLocator('#board iframe');
 const player=f.locator('g[role="img"][aria-label^="player "]');const dealer=f.locator('g[role="img"][aria-label^="dealer "]');
 await f.getByRole('button',{name:'Reveal dealer',exact:true}).click();
 await expect.poll(()=>dealer.locator(':scope > g').first().getAttribute('transform'),{intervals:[20,20,20]}).not.toBe('scale(1 1)');
 await expect(player.locator(':scope > g').first()).toHaveAttribute('transform','scale(1 1)');
 await expect(dealer.locator(':scope > g').first()).toHaveAttribute('transform','scale(1 1)');
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByLabel('Scenario').selectOption('');await page.getByLabel('Scenario').selectOption('intermediate');
 await f.getByRole('button',{name:'Reveal dealer',exact:true}).click();
 await expect(dealer.locator(':scope > g').first()).toHaveAttribute('transform','scale(1 1)');
});

for(const kind of kinds){
 test(`${kind}: play the final decision through to the result`,async({page},testInfo)=>{
  const fs=await import('node:fs');const pkg=JSON.parse(fs.readFileSync(path.resolve(__dirname,`../games/declarative/card-table/${kind}.json`),'utf8'));
  const c=pkg.unit_tests.cases.find((c:any)=>c.kind==='terminal'),move=c.move;
  await page.goto(`http://127.0.0.1:8173/?game=${kind}`);await page.getByLabel('Pause computers').check();await page.getByLabel('Scenario').selectOption('terminal');
  const f=page.frameLocator('#board iframe');const actions=f.locator('svg g[role="button"][aria-disabled="false"]');
  await expect(f.getByLabel('Game board. Use pieces and highlighted destinations. Zoom controls are above the board.')).toBeVisible();
  let target:Locator;
  if(kind==='war')target=f.getByRole('button',{name:'Next battle',exact:true});
  else if(kind==='blackjack')target=f.getByRole('button',{name:'Next round',exact:true});
  else if(kind==='casino-war')target=f.getByRole('button',{name:'Next hand',exact:true});
  else if(kind==='quoridor')target=f.getByRole('button',{name:`Move pawn to row ${move.r+1}, column ${move.c+1}`,exact:true});
  else if(kind==='old-maid')target=actions.nth(move.cardIndex);
  else if(kind==='six-card-golf')target=actions.nth(move.idx);
  else if(kind==='concentration'){const cells=c.view_of_mover.legal.map((m:any)=>m.cell).sort((a:number,b:number)=>a-b);target=actions.nth(cells.indexOf(move.cell));}
  else {const suit=kind==='michigan'?['♣','♦','♥','♠']:['♣','♦','♠','♥'];const rank=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];const text=typeof move.card==='string'?move.card.replace(/C$/,'♣').replace(/D$/,'♦').replace(/S$/,'♠').replace(/H$/,'♥'):rank[move.card%13]+suit[Math.floor(move.card/13)];target=f.getByRole('button',{name:`Play ${text}: Select`,exact:true});}
  await expect(target).toBeVisible();await page.waitForTimeout(150);
  if(['war','blackjack','casino-war'].includes(kind))await target.click();else await physicalTap(page,target,testInfo.project.name==='phone');
  await expect(page.locator('#status')).toContainText('Finished');await page.waitForTimeout(2300);
  await expect(f.getByRole('alert')).toHaveCount(0);
  await page.screenshot({path:path.join(testInfo.outputDir,`${kind}-finished.png`),fullPage:true});
 });
}

test('Old Maid: removed pair fades without remaining an input target',async({page},testInfo)=>{
 await page.goto('http://127.0.0.1:8173/?game=old-maid');await page.getByLabel('Pause computers').check();await page.getByLabel('Scenario').selectOption('intermediate');
 const f=page.frameLocator('#board iframe');const target=f.getByRole('button',{name:'Covered piece: Select',exact:true}).nth(3);await expect(target).toBeVisible();
 await physicalTap(page,target,testInfo.project.name==='phone');
 const ghost=f.getByTestId('history-ghost');await expect(ghost).toHaveCount(1);await expect(ghost).toHaveAttribute('aria-hidden','true');await expect(ghost).toHaveCount(0,{timeout:3000});
});

test('Quoridor keeps the exact board framing after a wall is placed',async({page},testInfo)=>{
 await page.goto('http://127.0.0.1:8173/?game=quoridor');await page.getByLabel('Pause computers').check();const f=page.frameLocator('#board iframe');
 const canvas=f.getByLabel('Game board. Use pieces and highlighted destinations. Zoom controls are above the board.');await expect(canvas).toBeVisible();
 const svg=canvas.locator(':scope > svg');const before=await canvas.boundingBox(),viewBox=await svg.getAttribute('viewBox');
 await f.getByRole('button',{name:'Place wall',exact:true}).click();
 const wall=f.getByRole('button',{name:'Place horizontal wall, row 4, column 4',exact:true});await expect(wall).toBeVisible();await physicalTap(page,wall,testInfo.project.name==='phone');
 await expect(page.locator('#status')).toContainText('Move 1');await page.waitForTimeout(1400);const after=await canvas.boundingBox();
 expect(after!.width).toBeCloseTo(before!.width,1);expect(after!.height).toBeCloseTo(before!.height,1);await expect(svg).toHaveAttribute('viewBox',viewBox!);
 await page.screenshot({path:path.join(testInfo.outputDir,'quoridor-wall-stable.png'),fullPage:true});
});

test('War computer reveal runs at the requested faster cadence',async({page})=>{
 await page.goto('http://127.0.0.1:8173/?game=war');const f=page.frameLocator('#board iframe');await expect(f.getByRole('button',{name:'Flip top card',exact:true})).toBeVisible();
 const started=Date.now();await f.getByRole('button',{name:'Flip top card',exact:true}).click();await expect(page.locator('#status')).toContainText('Move 2',{timeout:2200});expect(Date.now()-started).toBeLessThan(2200);
});

test('real Portal renders all ten distinct cover thumbnails',async({page,request},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8174/portal#games');
 await expect(page.getByRole('heading',{name:'All games',exact:true})).toBeVisible();
 const res=await request.get('http://127.0.0.1:8174/games');expect(res.ok()).toBeTruthy();const games=await res.json();expect(games).toHaveLength(10);const bodies=new Set();
 for(const game of games){const image=page.getByRole('img',{name:game.name,exact:true});await image.scrollIntoViewIfNeeded();await expect(image).toBeVisible();await image.screenshot({path:path.join(testInfo.outputDir,game.id+'.png')});expect(game.cover_url).toBeTruthy();const cover=await request.get(new URL(game.cover_url,'http://127.0.0.1:8174').href);expect(cover.ok()).toBeTruthy();expect(cover.headers()['content-type']).toContain('image/svg+xml');bodies.add(await cover.text());}
 expect(bodies.size).toBe(10);expect(errors).toEqual([]);await page.screenshot({path:path.join(testInfo.outputDir,'ten-game-portal-covers.png'),fullPage:true});
});

test('Blackjack supports affordable bets and a complete split-hand round',async({page},testInfo)=>{
 await page.goto('http://127.0.0.1:8173/?game=blackjack');await page.getByLabel('Pause computers').check();const f=page.frameLocator('#board iframe');
 await f.getByRole('button',{name:'Start game',exact:true}).click();await expect(f.getByRole('button',{name:'Bet 25',exact:true})).toBeVisible();await page.waitForTimeout(1200);
 const bet=page.waitForRequest(r=>r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/move/'));await f.getByRole('button',{name:'Bet 25',exact:true}).click();expect((await bet).postDataJSON().move).toEqual({kind:'bet',amount:25});
 await page.getByLabel('Scenario').selectOption('split');await f.getByRole('button',{name:'Split',exact:true}).click();await expect(f.getByText('You · Hand 1 of 2',{exact:true})).toBeVisible();await expect(f.getByText(/Hand 2 · 18 · Bet 10 · Waiting/)).toBeVisible();await page.waitForTimeout(1200);
 await f.getByRole('button',{name:'Stand',exact:true}).click();await expect(f.getByText('You · Hand 2 of 2',{exact:true})).toBeVisible();await page.waitForTimeout(1200);
 await f.getByRole('button',{name:'Stand',exact:true}).click();await expect(f.getByText('Round complete',{exact:true})).toBeVisible();await expect(f.getByText('Hand 1 · 18 · Push 18',{exact:true})).toBeVisible();await expect(f.getByText('Hand 2 · 18 · Push 18',{exact:true})).toBeVisible();
 await expect(f.getByText('Round 1 · Chips 1000 · Bet 10',{exact:true})).toBeVisible();await page.waitForTimeout(1200);await page.screenshot({path:path.join(testInfo.outputDir,'blackjack-split-round.png'),fullPage:true});
});
