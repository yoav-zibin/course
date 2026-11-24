import fs from 'node:fs';
import path from 'node:path';
import {test,expect,type Page} from '@playwright/test';
import {ensureMatchMenuOpen,createUser,loginAs,uniqueName} from './helpers';

// Lantern Trails (based on Tsuro): a full practice game against the computer,
// played only through the visible board. The first tile is turned with the
// host's rotate tool on the selected tile; later tiles use the tray's turn
// buttons. Every tile is placed by tapping the glowing square.
const EVIDENCE=process.env.LANTERNTRAILS_EVIDENCE_DIR;

async function shot(page:Page,name:string,project:string){
  if(!EVIDENCE)return;fs.mkdirSync(EVIDENCE,{recursive:true});
  await page.screenshot({path:path.join(EVIDENCE,`lanterntrails-${name}-${project}.png`)});
}

async function press(page:Page,name:string|RegExp,isMobile:boolean){
  const control=page.getByRole('button',{name,exact:typeof name==='string'}).first();
  if(isMobile)await control.tap();else await control.click();
}

// Turn the selected tile and wait until the board shows the new turn, so the
// next check never reads the previous scene.
async function turnTile(page:Page,name:'Turn tile clockwise'|'Turn tile counterclockwise'|'Rotate clockwise',isMobile:boolean){
  const ghost=page.getByRole('img',{name:/^Your tile, ready for /});
  const before=await ghost.getAttribute('transform');
  await press(page,name,isMobile);
  await expect.poll(async()=>{const now=await ghost.getAttribute('transform');return now!==before&&/rotate\((-?\d+)\)/.test(now||'');},{timeout:10000}).toBe(true);
  // Let the quarter-turn animation settle.
  await expect.poll(async()=>{const a=await ghost.getAttribute('transform');await page.waitForTimeout(120);return a===await ghost.getAttribute('transform');}).toBe(true);
}

test('Lantern Trails: a full game against the computer, with tile rotation, ends with a result',async({page,request,isMobile},info)=>{
  test.setTimeout(300000);
  // The portal's sandboxed runtime frame reports this for every game
  // (Tic-tac-toe too); it is not raised by this package. Any other error fails.
  const PLATFORM_NOISE="SecurityError: Failed to read the 'localStorage' property from 'Window': The document is sandboxed and lacks the 'allow-same-origin' flag.";
  const errors:string[]=[];page.on('pageerror',error=>{if(String(error)!==PLATFORM_NOISE)errors.push(String(error));});
  const payload=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../games/declarative/lanterntrails.json'),'utf8'));
  payload.game_addition_request_id_and_secret=uniqueName('lanterntrails-secret');
  const submitted=await request.post('/games/declarative',{data:payload});
  expect(submitted.status(),await submitted.text()).toBe(201);
  const id=(await submitted.json()).id;
  await loginAs(page,{...await createUser(request,'Ana'),linked:[],picture_url:''});
  await page.goto(`/portal#game=${id}`);
  await page.getByTestId('play-computer').getByRole('button',{name:'Players: 2',exact:true}).click();
  await page.getByTestId('play-computer').getByRole('button',{name:'Play against the computer',exact:true}).click();
  const stage=page.getByTestId('game-stage');
  const outcome=stage.getByText(/ wins!$|^Shared win: /).first();

  // Start: an edge square, then one of its gates in the tray.
  await expect(page.getByRole('button',{name:/^Start next to /}).first()).toBeVisible({timeout:20000});
  await shot(page,'start',info.project.name);
  // The first tap can land while the board is still settling: retry it.
  const gate=page.getByRole('button',{name:/^Gate at C1, /}).first();
  for(let attempt=0;attempt<3&&!(await gate.isVisible());attempt++){
    await press(page,'Start next to C1',isMobile);
    await gate.waitFor({timeout:4000}).catch(()=>{});
  }
  await expect(gate).toBeVisible();
  await shot(page,'gate-pick',info.project.name);
  await press(page,'Gate at C1, top, left',isMobile);

  let turns=0,toolTurnDone=false,buttonTurnDone=false;
  const place=page.getByRole('button',{name:/^Place the tile on [A-F][1-6]$/}).first();
  for(;turns<40;turns++){
    // My turn: the tiles in my hand become active (or the game is over).
    const myTile=page.getByRole('button',{name:/^Tile 1 in your hand: /});
    await expect.poll(async()=>(await outcome.isVisible())||(await myTile.count())>0&&await myTile.first().isEnabled(),{timeout:60000}).toBe(true);
    if(await outcome.isVisible())break;
    if(!toolTurnDone){
      // Select the first tile, then turn it with the host's ↻ tool.
      await press(page,/^Tile 1 in your hand: /,isMobile);
      await expect(page.getByRole('button',{name:'Rotate clockwise',exact:true})).toBeVisible();
      await turnTile(page,'Rotate clockwise',isMobile);
      await shot(page,'rotate-tool',info.project.name);
      toolTurnDone=true;
    }
    // Turn with the tray buttons until the route is safe (at most a full turn).
    for(let k=0;k<4&&!(await place.isVisible());k++){await turnTile(page,'Turn tile clockwise',isMobile);buttonTurnDone=true;}
    if(!(await place.isVisible())){
      // This tile cannot stay on the river in any turn: try the next one.
      for(const n of [2,3]){
        const tile=page.getByRole('button',{name:new RegExp(`^Tile ${n} in your hand`)});
        if(!(await tile.count()))continue;
        const ghost=page.getByRole('img',{name:/^Your tile, ready for /});
        const shown=await ghost.getAttribute('transform');
        await press(page,new RegExp(`^Tile ${n} in your hand`),isMobile);
        await page.waitForTimeout(400);
        void shown;
        for(let k=0;k<4&&!(await place.isVisible());k++)await turnTile(page,'Turn tile clockwise',isMobile);
        if(await place.isVisible())break;
      }
    }
    if(turns===1){await turnTile(page,'Turn tile counterclockwise',isMobile);buttonTurnDone=true;
      for(let k=0;k<4&&!(await place.isVisible());k++)await turnTile(page,'Turn tile clockwise',isMobile);
      await shot(page,'route-preview',info.project.name);}
    const before=await page.getByRole('img',{name:/^Tile on [A-F][1-6]$/}).count();
    await press(page,/^Place the tile on [A-F][1-6]$/,isMobile);
    // The new tile lands (or the game ends at once).
    await expect.poll(async()=>(await outcome.isVisible())||(await page.getByRole('img',{name:/^Tile on [A-F][1-6]$/}).count())>before,{timeout:15000}).toBe(true);
    if(turns===3)await shot(page,'midgame',info.project.name);
  }
  await expect(outcome).toBeVisible({timeout:60000});
  await expect(stage.getByText(/ wins!$|^Shared win: /)).toBeVisible();
  await ensureMatchMenuOpen(page);
  await expect(page.getByTestId('match-outcome')).toHaveText(/won|lost|draw|tie/i);
  expect(toolTurnDone).toBe(true);
  expect(buttonTurnDone).toBe(true);
  await shot(page,'end',info.project.name);
  expect(errors).toEqual([]);
});
