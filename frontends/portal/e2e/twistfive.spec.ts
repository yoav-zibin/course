import fs from 'node:fs';
import path from 'node:path';
import {test,expect,type Page} from '@playwright/test';
import {ensureMatchMenuOpen,createUser,loginAs,uniqueName} from './helpers';

test.beforeEach(async({baseURL})=>{if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Twist Five checks require a disposable loopback server.');});

// Twist Five (based on Pentago): a full practice match against the
// computer, played only through the visible board. The first turn uses the
// plate's rotate tool; later turns tap the turn arrows around the board.
const EVIDENCE=process.env.TWISTFIVE_EVIDENCE_DIR;
const PLATES=['top-left','top-right','bottom-left','bottom-right'];
// Holes in a preferred order, spread over the plates.
const PREFERRED=['B2','E2','B5','E5','C3','D4','C4','D3','A1','F6','A6','F1','B3','E4','C2','D5','B4','E3','C5','D2',
  'A2','F5','A5','F2','B1','E6','B6','E1','C1','D6','C6','D1','A3','F4','A4','F3'];

async function shot(page:Page,name:string,project:string){
  if(!EVIDENCE)return;fs.mkdirSync(EVIDENCE,{recursive:true});
  await page.screenshot({path:path.join(EVIDENCE,`twistfive-${name}-${project}.png`)});
}

async function press(page:Page,name:string,isMobile:boolean){
  const control=page.getByRole('button',{name,exact:true});
  if(isMobile)await control.tap();else await control.click();
}

test('Twist Five: a full match against the computer, with plate rotation, ends with a result',async({page,request,isMobile},info)=>{
  test.setTimeout(240000);
  // The portal's sandboxed runtime frame currently reports this for every game
  // (Tic-tac-toe too); it is not raised by this package. Any other error fails.
  const PLATFORM_NOISE="SecurityError: Failed to read the 'localStorage' property from 'Window': The document is sandboxed and lacks the 'allow-same-origin' flag.";
  const errors:string[]=[];page.on('pageerror',error=>{if(String(error)!==PLATFORM_NOISE)errors.push(String(error));});
  const payload=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../games/declarative/twistfive.json'),'utf8'));
  payload.game_addition_request_id_and_secret=uniqueName('twistfive-secret');
  const submitted=await request.post('/games/declarative',{data:payload});
  expect(submitted.status(),await submitted.text()).toBe(201);
  const id=(await submitted.json()).id;
  await loginAs(page,{...await createUser(request,'Ana'),linked:[],picture_url:''});
  await page.goto(`/portal#game=${id}`);
  // Online matches are human-only; the computer plays in local practice.
  await page.getByTestId('play-computer').getByRole('button',{name:'Play against the computer',exact:true}).click();
  await ensureMatchMenuOpen(page);
  const outcome=page.getByTestId('match-outcome');
  const stage=page.getByTestId('game-stage');
  await expect(page.getByRole('button',{name:/^Hole [A-F][1-6]$/}).first()).toBeVisible({timeout:20000});
  await shot(page,'start',info.project.name);
  let turns=0,toolTurnDone=false;
  for(;turns<20;turns++){
    // Wait for my turn (empty holes offered) or the end of the match.
    const hole=page.getByRole('button',{name:/^Hole [A-F][1-6]$/}).first();
    await expect(hole.or(outcome)).toBeVisible({timeout:30000});
    if(await outcome.isVisible())break;
    const open=new Set(await page.getByRole('button',{name:/^Hole [A-F][1-6]$/}).evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label'))));
    const choice=PREFERRED.find(cell=>open.has(`Hole ${cell}`))!;
    await press(page,`Hole ${choice}`,isMobile);
    const change=page.getByRole('button',{name:'Change marble',exact:true});
    // A hole that makes five wins at once and asks for no turn.
    const twisting=await change.waitFor({timeout:3000}).then(()=>true,()=>false);
    if(!twisting)continue;
    const plate=PLATES[turns%4];
    if(!toolTurnDone){
      // Rotation through the plate itself: select it, then the ↻ tool.
      const plateControl=page.getByRole('button',{name:`${plate} plate: Move, Rotate`,exact:true});
      await expect(plateControl).toBeEnabled();
      await plateControl.scrollIntoViewIfNeeded();
      const box=(await plateControl.boundingBox())!;
      // A marble can cover the plate center. The board's pointer handler
      // resolves the child marble to its parent plate.
      if(isMobile)await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
      else await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
      await expect(page.getByRole('button',{name:'Rotate clockwise',exact:true})).toBeVisible();
      await shot(page,'rotate-tool',info.project.name);
      await press(page,'Rotate clockwise',isMobile);
      toolTurnDone=true;
    }else{
      const direction=turns%2?'counterclockwise':'clockwise';
      const arrow=`Turn the ${plate} plate ${direction}`;
      await press(page,arrow,isMobile);
      // Native touch hosts first preview the turned plate and turn it on the
      // second tap; the web build turns it at once. Accept either.
      const turned=await expect(change).toHaveCount(0,{timeout:2000}).then(()=>true,()=>false);
      if(!turned){
        if(turns===1)await shot(page,'touch-preview',info.project.name);
        await press(page,arrow,isMobile);
      }
    }
    await expect(change).toHaveCount(0,{timeout:10000});
    if(turns===2)await shot(page,'midgame',info.project.name);
  }
  await expect(outcome).toBeVisible({timeout:30000});
  await expect(outcome).toHaveText(/won|lost|draw|tie/i);
  await expect(stage.getByText(/ wins!$|^Draw$/)).toBeVisible();
  expect(toolTurnDone).toBe(true);
  await shot(page,'end',info.project.name);
  expect(errors).toEqual([]);
});
