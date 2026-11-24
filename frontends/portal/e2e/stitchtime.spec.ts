import fs from 'node:fs';
import path from 'node:path';
import {test,expect,type Page} from '@playwright/test';
import {ensureMatchMenuOpen,createUser,loginAs,submitGameFixture,uniqueName} from './helpers';

// Stitch & Time (based on Patchwork): a full game against the computer, played
// only through the visible board: buying patches (turned with the host's
// rotate tool and the ↺ ⇋ buttons), advancing for buttons, leather patches.
const EVIDENCE=process.env.STITCHTIME_EVIDENCE_DIR;
async function shot(page:Page,name:string,project:string){
  if(!EVIDENCE)return;fs.mkdirSync(EVIDENCE,{recursive:true});
  await page.screenshot({path:path.join(EVIDENCE,`stitchtime-${name}-${project}.png`)});
}
async function press(page:Page,name:string|RegExp,isMobile:boolean){
  const control=page.getByRole('button',{name,exact:typeof name==='string'}).first();
  try{if(isMobile)await control.tap({timeout:15000});else await control.click({timeout:15000});}
  catch(error){throw new Error(`could not press ${String(name)}: ${String(error).slice(0,300)}`);}
}

test('Stitch & Time: a full game against the computer, with patch rotation, ends with a result',async({page,request,isMobile},info)=>{
  test.setTimeout(420000);
  // The portal's sandboxed runtime frame reports this for every game
  // (Tic-tac-toe too); it is not raised by this package. Any other error fails.
  const PLATFORM_NOISE="SecurityError: Failed to read the 'localStorage' property from 'Window': The document is sandboxed and lacks the 'allow-same-origin' flag.";
  const errors:string[]=[];page.on('pageerror',error=>{if(String(error)!==PLATFORM_NOISE)errors.push(String(error));});
  const payload=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../games/declarative/stitchtime.json'),'utf8'));
  payload.game_addition_request_id_and_secret=uniqueName('stitchtime-secret');
  const id=await submitGameFixture(request,payload);
  await loginAs(page,{...await createUser(request,'Ana'),linked:[],picture_url:''});
  await page.goto(`/portal#game=${id}`);
  await page.getByTestId('play-computer').getByRole('button',{name:'Play against the computer',exact:true}).click();
  const stage=page.getByTestId('game-stage');
  const outcome=stage.getByText(/ wins with -?\d+!$/);
  await expect(page).toHaveURL(/#match=local-/);
  const matchId=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('match')!;
  const savedMoves=()=>page.evaluate(matchId=>{
    for(const key of Object.keys(localStorage)){
      if(!key.startsWith('buildplay.shared.v1.'))continue;
      const match=JSON.parse(localStorage.getItem(key)!).local?.[matchId];
      if(match)return match.move_count as number;
    }
    return -1;
  },matchId);
  const commitMove=async(action:()=>Promise<void>)=>{
    const before=await savedMoves();
    expect(before).toBeGreaterThanOrEqual(0);
    await action();
    // Pointer release can finish before the local rules and computer reply
    // commit. Don't pick another action from the previous position.
    await expect.poll(savedMoves,{timeout:15000}).toBeGreaterThan(before);
  };
  const cards=page.getByRole('button',{name:/^Choose this patch: /,disabled:false});
  // Intermediate animation frames can show actions that aren't playable.
  const advance=page.getByRole('button',{name:/^Advance past your rival/,disabled:false});
  const leather=page.getByRole('button',{name:/^Place the leather patch on square /,disabled:false});
  let toolTurn=false,buttonTurn=false,bought=0,turns=0;
  for(;turns<80;turns++){
    await expect.poll(async()=>(await outcome.isVisible())||(await leather.count())>0||(await advance.count())>0,{timeout:60000}).toBe(true);
    if(await outcome.isVisible())break;
    if(await leather.count()){
      await commitMove(()=>isMobile?leather.first().tap({timeout:15000}):leather.first().click({timeout:15000}));
      continue;
    }
    if(turns===0)await shot(page,'start',info.project.name);
    if(await cards.count()&&turns%4!==3){
      await press(page,/^Choose this patch: /,isMobile);
      await expect(page.getByRole('button',{name:'Mirror patch',exact:true})).toBeVisible();
      if(!toolTurn){
        // Select the spool and turn the patch with the host's ↻ tool.
        await press(page,/^Your patch of \d+ squares/,isMobile);
        await expect(page.getByRole('button',{name:'Rotate clockwise',exact:true})).toBeVisible();
        await press(page,'Rotate clockwise',isMobile);toolTurn=true;
        for(const name of ['Cancel selection']){const b=page.getByRole('button',{name,exact:true});if(await b.count())await press(page,name,isMobile);}
      }else if(!buttonTurn){
        await press(page,'Turn patch counterclockwise',isMobile);
        await press(page,'Mirror patch',isMobile);buttonTurn=true;
        await shot(page,'placing',info.project.name);
      }
      await page.waitForTimeout(400);
      // Turn until it fits (the ghost starts in a good spot), else give up.
      const ready=async()=>expect(page.getByRole('button',{name:'Place patch',exact:true}).last()).toBeEnabled({timeout:2500}).then(()=>true,()=>false);
      for(let k=0;k<4&&!(await ready());k++)await press(page,'Turn patch clockwise',isMobile);
      if(await ready()){
        await commitMove(()=>press(page,'Place patch',isMobile));bought++;
        if(bought===3){await page.waitForTimeout(1500);await shot(page,'midgame',info.project.name);}
        continue;
      }
      await press(page,'Cancel',isMobile);
    }
    if(await outcome.isVisible())break;
    if(await advance.count())await commitMove(()=>press(page,/^Advance past your rival/,isMobile));
  }
  await expect(outcome).toBeVisible({timeout:60000});
  await ensureMatchMenuOpen(page);
  await expect(page.getByTestId('match-outcome')).toHaveText(/won|lost|draw|tie/i);
  expect(toolTurn&&buttonTurn&&bought>=2).toBe(true);
  await shot(page,'end',info.project.name);
  expect(errors).toEqual([]);
});
