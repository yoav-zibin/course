import {expect, type Page, type Locator} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

let oracle:any;
function computerChoice(view:any,players:any[],moveCount:number) {
  if(!oracle) {
    const payload=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../games/declarative/backgammon.json'),'utf8'));
    oracle=vm.runInNewContext(payload.server_code+'\ngame;',{InvalidMove:class InvalidMove extends Error{}});
  }
  let seed=(Math.imul(moveCount+1,1664525)+view.cur+1013904223)>>>0;
  const ctx={players,move_count:moveCount,pot:0,random:()=>{
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;
  }};
  return oracle.computerMove(structuredClone(view),players[view.cur].id,ctx);
}

declare const state:any;

// Older pinned authority has neither setup nor opening-match metadata.
export function ordinaryBackgammonView(source:any) {
  const view=structuredClone(source);
  for(const key of ['configured','opening','opening_roll','can_undo','cube','can_double','difficulty','goal',
    'scores','round_winner','cube_enabled','undo_stack','last_roll','combinedMoves']) delete view[key];
  return {...view,cur:0,n:0,winner:null,needRoll:true,dice:[],moves:[],legalMoves:[]};
}

export function spentDice(values:number[]) {
  return (values.length===2&&values[0]===values[1]?Array(4).fill(values[0]):values)
    .map(value=>`die_${value}_used_2`);
}

export async function clickBackgammonTarget(target:Locator,touch=false) {
  const point=Number((await target.getAttribute('data-ui-id')||'').replace(/^to_/,''));
  const hit=target.locator('.declarative-target-hit');
  if(Number.isInteger(point)&&point>=0&&point<24&&await hit.count()) {
    const box=(await hit.boundingBox())!;
    // Another movable checker can cover the center of an occupied point.
    // Use the free end of the selected point's real drop rectangle instead.
    const position={x:box.width/2,y:box.height*(point<12?.08:.92)};
    if(touch)await hit.tap({position});else await hit.click({position});
  } else if(touch)await target.tap();else await target.click();
}

export async function backgammonAction(page:Page,goal=1) {
  const host=page.locator('#game-box'),stage=host.locator('.declarative-stage');
  await expect(stage).toBeVisible();
  await expect(host.locator('.declarative-error:visible')).toHaveCount(0);
  const byId=(id:string)=>host.locator(`.declarative-piece.actionable[data-ui-id="${id}"]`);
  const checkers=host.locator('.declarative-piece.actionable[data-actions="move"]');
  const pass=host.locator('.declarative-control.actionable [data-ui-id="pass"]');
  await expect.poll(async()=>await byId('start_game').count()+await byId('roll').count()+
    await byId('next').count()+await byId('take').count()+await checkers.count()+await pass.count(),{timeout:30000}).toBeGreaterThan(0);
  if(await byId('start_game').count()) {
    await byId('goal_'+goal).locator(':scope > g[opacity]').click();
    await byId('start_game').locator(':scope > g[opacity]').click();
    return 'configure';
  }
  for(const id of ['next','take','roll'])if(await byId(id).count()){
    await byId(id).locator(':scope > g[opacity]').click();return id;
  }
  if(await checkers.count()) {
    // Drive a real UI game with the bundled opponent's public-board policy.
    // The oracle chooses only the command. Browser clicks still travel through
    // the reducer, match API and server validation; authority state is untouched.
    const snapshot=await page.evaluate(()=>{
      const message=(window as any).backgammonLastSent;
      return {view:message?.view||state.match.state,players:state.match.players,
        count:message?.move_count??state.match.move_count};
    });
    const move=computerChoice(snapshot.view,snapshot.players,snapshot.count);
    expect(move.action).toBe('move');
    const legal=[...(snapshot.view.legalMoves||[]),...(snapshot.view.combinedMoves||[])];
    expect(legal.some((candidate:any)=>candidate.from===move.from&&candidate.to===move.to),
      'computer policy chooses a public legal checker move').toBe(true);
    const choice={move};
    // Source IDs are presentation identity. Locate the offered source by its
    // public board coordinates, then select its declared target in the DOM.
    const source=choice.move.from;
    const sourceX=source==='bar'?336:(()=>{const col=source<12?11-source:source-12;return 36+col*52+(col>=6?28:0);})();
    const chosen=await checkers.evaluateAll((nodes,{source,sourceX})=>nodes.find(node=>{
      const [x,y]=(node.getAttribute('transform')?.match(/translate\(([-\d.]+) ([-\d.]+)\)/)?.slice(1)||[]).map(Number);
      return Math.abs(x-(20+sourceX))<1&&(source==='bar'||(source<12?y>325:y<325));
    })?.getAttribute('data-ui-id'),{source,sourceX});
    expect(chosen,'rendered movable source matches authority').toBeTruthy();
    await host.locator(`.declarative-piece[data-ui-id="${chosen}"] > g[opacity]`).click();
    const target=host.locator(`.declarative-target[data-ui-id="to_${choice.move.to}"]`);
    await expect(target).toHaveAttribute('data-drop-state','allowed');
    await clickBackgammonTarget(target);
    return 'move';
  }
  await pass.click();return 'pass';
}
