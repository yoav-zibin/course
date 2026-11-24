import fs from 'node:fs';
import path from 'node:path';
import {test,expect,type Page} from '@playwright/test';
import {ensureMatchMenuOpen,createUser,loginAs,uniqueName} from './helpers';

// Crownfields (based on Kingdomino): a full practice game against the
// computer, played only through the visible board. The first tile is turned
// with the host's rotate tool on the selected tile; later ones with the ↺ ↻
// buttons. Picks use select-then-confirm; tiles that fit nowhere are discarded.
const EVIDENCE=process.env.CROWNFIELDS_EVIDENCE_DIR;
async function shot(page:Page,name:string,project:string){
  if(!EVIDENCE)return;fs.mkdirSync(EVIDENCE,{recursive:true});
  await page.screenshot({path:path.join(EVIDENCE,`crownfields-${name}-${project}.png`)});
}
async function press(page:Page,name:string|RegExp,isMobile:boolean){
  const control=page.getByRole('button',{name,exact:typeof name==='string'}).first();
  if(isMobile)await control.tap();else await control.click();
}
// Wait until the frame around the tile being laid shows the new turn.
async function turned(page:Page,before:string|null){
  const ghost=page.getByRole('img',{name:/^Tile \d+ (fits here|does not fit this way)/});
  await expect.poll(async()=>(await ghost.first().getAttribute('transform'))!==before,{timeout:10000}).toBe(true);
  await page.waitForTimeout(900);
}

test('Crownfields: a full game against the computer, with tile rotation, ends with a result',async({page,request,isMobile},info)=>{
  test.setTimeout(300000);
  // The portal's sandboxed runtime frame reports this for every game
  // (Tic-tac-toe too); it is not raised by this package. Any other error fails.
  const PLATFORM_NOISE="SecurityError: Failed to read the 'localStorage' property from 'Window': The document is sandboxed and lacks the 'allow-same-origin' flag.";
  const errors:string[]=[];page.on('pageerror',error=>{if(String(error)!==PLATFORM_NOISE)errors.push(String(error));});
  const payload=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../games/declarative/crownfields.json'),'utf8'));
  payload.game_addition_request_id_and_secret=uniqueName('crownfields-secret');
  const submitted=await request.post('/games/declarative',{data:payload});
  expect(submitted.status(),await submitted.text()).toBe(201);
  const id=(await submitted.json()).id;
  await loginAs(page,{...await createUser(request,'Ana'),linked:[],picture_url:''});
  await page.goto(`/portal#game=${id}`);
  await page.getByTestId('play-computer').getByRole('button',{name:'Players: 2',exact:true}).click();
  await page.getByTestId('play-computer').getByRole('button',{name:'Play against the computer',exact:true}).click();
  const stage=page.getByTestId('game-stage');
  const outcome=stage.getByText(/ wins with \d+!$|^Shared win: /).first();
  const pick=page.getByRole('button',{name:/^Choose tile \d+$/});
  const square=page.getByRole('button',{name:/^Start the tile here/});
  const discard=page.getByRole('button',{name:'Discard tile',exact:true});
  const lay=page.getByRole('button',{name:/^Lay tile \d+ here$/});
  let toolTurn=false,buttonTurn=false,picks=0,lays=0;
  for(let step=0;step<40;step++){
    await expect(pick.first().or(square.first()).or(discard).or(outcome)).toBeVisible({timeout:60000});
    if(await outcome.isVisible())break;
    await page.waitForTimeout(300);
    if(await pick.count()){
      await press(page,/^Choose tile \d+$/,isMobile);
      await expect(page.getByRole('button',{name:/^Take tile \d+$/})).toBeVisible();
      if(picks===0)await shot(page,'pick',info.project.name);
      await press(page,/^Take tile \d+$/,isMobile);picks++;
    }else if(await discard.count()){
      await press(page,'Discard tile',isMobile);
    }else{
      await press(page,/^Start the tile here/,isMobile);
      const ghost=page.getByRole('img',{name:/^Tile \d+ (fits here|does not fit this way)/}).first();
      await expect(ghost).toBeVisible();
      if(!toolTurn){
        // Select your tile in the Now row, then turn it with the host's ↻ tool.
        const before=await ghost.getAttribute('transform');
        await press(page,/^Tile \d+, being placed/,isMobile);
        await expect(page.getByRole('button',{name:'Rotate clockwise',exact:true})).toBeVisible();
        await press(page,'Rotate clockwise',isMobile);toolTurn=true;
        await turned(page,before);
        await shot(page,'rotate-tool',info.project.name);
      }
      for(let k=0;k<4&&!(await lay.count());k++){
        const before=await ghost.getAttribute('transform');
        await press(page,'Turn tile clockwise',isMobile);buttonTurn=true;
        await turned(page,before);
      }
      if(lays===2)await shot(page,'lay',info.project.name);
      await press(page,/^Lay tile \d+ here$/,isMobile);lays++;
    }
    await page.waitForTimeout(500);
  }
  await expect(outcome).toBeVisible({timeout:60000});
  await expect(stage.getByText(/ wins with \d+!$|^Shared win: /)).toBeVisible();
  await ensureMatchMenuOpen(page);
  await expect(page.getByTestId('match-outcome')).toHaveText(/won|lost|draw|tie/i);
  expect(toolTurn&&buttonTurn&&picks>=6&&lays>=1).toBe(true);
  await shot(page,'end',info.project.name);
  expect(errors).toEqual([]);
});
