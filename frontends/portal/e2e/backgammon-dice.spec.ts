import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const load=(name:string)=>JSON.parse(readFileSync(path.resolve(__dirname,'../../..',name),'utf8'));
const game=load('games/declarative/backgammon.json');
const reviewed=load('frontends/portal/src/game/reviewedBackgammon.json');
const original=structuredClone(game.unit_tests.cases[0].view_of_mover);
for(const key of ['configured','opening','opening_roll','can_undo','cube','can_double','difficulty','goal','scores','round_winner','cube_enabled','undo_stack','last_roll','combinedMoves'])delete original[key];
const message=(count:number,extra:Record<string,unknown>={},identity:Record<string,unknown>={})=>{
  const view={...original,cur:0,n:4,winner:null,needRoll:true,dice:[],moves:[],legalMoves:[],...extra};
  return {type:'state_changed',status:'ongoing',move_count:count,my_player_index:0,acting_for_player_index:0,
    turn_of_player_indices:[0],view,state:view,...identity};
};
async function send(page:Page,value:Record<string,unknown>){await page.evaluate(value=>window.postMessage(value,'*'),value);}
async function mount(page:Page,request:APIRequestContext,baseURL:string|undefined,ui:object){
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Dice checks require a disposable loopback server.');
  await page.emulateMedia({reducedMotion:'reduce'});
  const response=await request.post('/games/declarative/client',{data:ui});expect(response.ok(),await response.text()).toBeTruthy();
  const document=(await response.json()).client_code;
  await page.addInitScript(()=>{
    if(window!==window.top)return;
    (window as any).__diceMoves=[];(window as any).__diceReady=false;
    window.addEventListener('message',event=>{
      if(event.source!==window)return;
      if(event.data?.type==='game_ready')(window as any).__diceReady=true;
      if(event.data?.type==='make_move')(window as any).__diceMoves.push(event.data.move);
    });
  });
  await page.route('**/dice-fixture',route=>route.fulfill({contentType:'text/html',body:document}));
  await page.goto('/dice-fixture');await page.waitForFunction(()=>(window as any).__diceReady);
}

for(const [kind,ui] of [['current',game.declarative_ui],['reviewed legacy',reviewed]] as const){
  test(`${kind} Backgammon dice retain spent faces and highlight only eligible roll actions`,async({page,request,baseURL,isMobile})=>{
    await mount(page,request,baseURL,ui);await send(page,message(40));
    const dice=page.locator('g[aria-label^="Die "]');
    const checkFace=async(index:number,pips:number,spent:boolean)=>{
      const die=dice.nth(index);
      if(kind==='current'){
        await expect(die).toHaveAttribute('opacity',spent?'0.5':'1');
        await expect(die.locator('circle')).toHaveCount(pips);
      }else{
        await expect(die.locator('rect[fill="#767b79"]')).toHaveCount(spent?1:0);
      }
    };
    const cue=':scope > rect[stroke="#79d5ff"]';
    await expect(dice).toHaveCount(2);
    const roll=page.getByRole('button',{name:'Die 1: roll dice: Select',exact:true});
    await expect(roll).toBeVisible();await expect(roll.locator(cue)).toBeVisible();
    if(isMobile)await roll.tap();else await roll.click();
    await expect.poll(()=>page.evaluate(()=>(window as any).__diceMoves)).toEqual([{action:'roll'}]);

    await send(page,message(41,{needRoll:false,dice:[2,5],moves:[2,5]}));
    await expect(dice.nth(0)).toHaveAttribute('aria-label','Die 1: 2');
    await expect(dice.nth(1)).toHaveAttribute('aria-label','Die 2: 5');
    await expect(dice.locator(cue)).toHaveCount(0);
    await send(page,message(42,{needRoll:false,dice:[5],moves:[5]}));
    await expect(dice).toHaveCount(2);
    await expect(dice.nth(0)).toHaveAttribute('aria-label',/Die 1: 2.*used/i);
    await checkFace(0,2,true);
    await expect(dice.nth(1)).toHaveAttribute('aria-label','Die 2: 5');
    await checkFace(1,5,false);

    // A new viewer intentionally gets fresh presentation-local state. Supply
    // the same bounded accepted-roll history as the real pass-and-play host.
    const ready=message(43,{cur:1,n:5},{my_player_index:1,acting_for_player_index:1,turn_of_player_indices:[1],
      presentation_history:[{view:message(41,{needRoll:false,dice:[2,5],moves:[2,5]}).view,
        move_count:41,last_move_player_index:0}]});
    await send(page,ready);await expect(dice.locator(cue)).toHaveCount(2);
    await checkFace(0,2,true);
    await checkFace(1,5,true);
    await send(page,{...ready,acting_for_player_index:null});
    await expect(dice).toHaveCount(2);await expect(dice.locator(cue)).toHaveCount(0);
    await send(page,{...ready,replay:{index:43}});
    await expect(dice).toHaveCount(2);await expect(dice.locator(cue)).toHaveCount(0);
    await expect(page.getByRole('button',{name:/^Die [12]:/})).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}
