import fs from 'node:fs';
import path from 'node:path';
import {test,expect,type Page} from '@playwright/test';
import {createUser,loginAs,uniqueName} from './helpers';

// Flipside Lords (based on The Duke): a full game against the computer,
// played only through the visible board: setup, moves, captures, drawing
// troops, and a look at a tile's other side with the host's flip tool.
const EVIDENCE=process.env.FLIPSIDE_EVIDENCE_DIR;
async function shot(page:Page,name:string,project:string){
  if(!EVIDENCE)return;fs.mkdirSync(EVIDENCE,{recursive:true});
  await page.screenshot({path:path.join(EVIDENCE,`flipside-${name}-${project}.png`)});
}
async function press(page:Page,name:string|RegExp,isMobile:boolean){
  const control=page.getByRole('button',{name,exact:typeof name==='string'}).first();
  try{if(isMobile)await control.tap({timeout:15000});else await control.click({timeout:15000});}
  catch(error){throw new Error(`could not press ${String(name)}: ${String(error).slice(0,300)}`);}
}

test('Flipside Lords: a full game against the computer, with a tile flip, ends with a result',async({page,request,isMobile},info)=>{
  test.setTimeout(420000);
  // The portal's sandboxed runtime frame reports this for every game
  // (Tic-tac-toe too); it is not raised by this package. Any other error fails.
  const PLATFORM_NOISE="SecurityError: Failed to read the 'localStorage' property from 'Window': The document is sandboxed and lacks the 'allow-same-origin' flag.";
  const errors:string[]=[];page.on('pageerror',error=>{if(String(error)!==PLATFORM_NOISE)errors.push(String(error));});
  const payload=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../games/declarative/flipside.json'),'utf8'));
  payload.game_addition_request_id_and_secret=uniqueName('flipside-secret');
  const submitted=await request.post('/games/declarative',{data:payload});
  expect(submitted.status(),await submitted.text()).toBe(201);
  const id=(await submitted.json()).id;
  await loginAs(page,{...await createUser(request,'Ana'),linked:[],picture_url:''});
  await page.goto(`/portal#game=${id}`);
  await page.getByTestId('play-computer').getByRole('button',{name:'Play against the computer',exact:true}).click();
  const outcome=page.getByTestId('match-outcome');
  const stage=page.getByTestId('game-stage');

  // Setup: the Lord on a middle square of the home row, then two Footmen.
  const lord=page.getByRole('button',{name:/^Place your Lord on /}).first();
  await expect(lord).toBeVisible({timeout:20000});
  await shot(page,'setup',info.project.name);
  await press(page,/^Place your Lord on /,isMobile);
  await expect(page.getByRole('button',{name:/^Place a Footman on /}).first()).toBeVisible();
  // Two different squares (tapping one again would unselect it).
  const feet=await page.getByRole('button',{name:/^Place a Footman on /}).evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')!));
  await press(page,feet[0],isMobile);
  await page.waitForTimeout(400);
  await press(page,feet[1],isMobile);

  const mine=page.getByRole('button',{name:/ of (Ivory|Walnut) · Ana \(.*\) on [A-F][1-6]: /});
  const actions=page.getByRole('button',{name:/^(Capture on|Strike|Move to|Command the) /});
  let flipped=false,turns=0,draws=0;
  for(;turns<120;turns++){
    await expect.poll(async()=>(await outcome.isVisible())||(await mine.count())>0&&await mine.first().isEnabled(),{timeout:60000}).toBe(true);
    if(await outcome.isVisible())break;
    await page.waitForTimeout(300);
    if(!flipped){
      // Look at a tile's other side with the host's flip tool, then back.
      await press(page,/ of (Ivory|Walnut) · Ana \(.*\) on [A-F][1-6]: /,isMobile);
      await expect(page.getByRole('button',{name:'Flip piece',exact:true})).toBeVisible();
      await press(page,'Flip piece',isMobile);
      await expect(page.getByText(/· preview only$/)).toBeVisible();
      await shot(page,'flip-preview',info.project.name);
      await press(page,'Flip piece',isMobile);
      await expect(page.getByText(/· preview only$/)).toHaveCount(0);
      // Clear the portal's own selection, then the game's.
      for(const name of ['Cancel selection','Cancel']){
        const button=page.getByRole('button',{name,exact:true});
        if(await button.count())await press(page,name,isMobile);
      }
      flipped=true;
    }
    const draw=page.getByRole('button',{name:/^Draw a troop from your bag/});
    if(turns%3===0&&await draw.count()){
      await expect(draw.first()).toBeEnabled({timeout:15000});
      await press(page,/^Draw a troop from your bag/,isMobile);
      await press(page,/^Place the new troop on /,isMobile);draws++;
      if(draws===1)await shot(page,'drawn',info.project.name);
      continue;
    }
    // Try tiles until one offers an action; prefer captures and strikes.
    let acted=false;
    const count=await mine.count();
    for(let i=0;i<count&&!acted;i++){
      const tile=mine.nth(i);
      if(isMobile)await tile.tap();else await tile.click();
      await page.waitForTimeout(250);
      if(await actions.count()){
        const capture=page.getByRole('button',{name:/^(Capture on|Strike) /});
        const target=(await capture.count())?capture.first():page.getByRole('button',{name:/^Move to /}).first();
        if(await target.count()){
          if(turns===2)await shot(page,'targets',info.project.name);
          if(isMobile)await target.tap();else await target.click();
          acted=true;
        }
      }
    }
    if(!acted&&await draw.count()){await press(page,/^Draw a troop from your bag/,isMobile);await press(page,/^Place the new troop on /,isMobile);}
  }
  await expect(outcome).toBeVisible({timeout:60000});
  await expect(outcome).toHaveText(/won|lost|draw|tie/i);
  await expect(stage.getByText(/ wins!$|^Draw$/)).toBeVisible();
  expect(flipped).toBe(true);
  await shot(page,'end',info.project.name);
  expect(errors).toEqual([]);
});
