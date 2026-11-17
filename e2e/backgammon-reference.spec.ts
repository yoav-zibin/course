import fs from 'node:fs';
import path from 'node:path';
import {test,expect,type Page} from '@playwright/test';

const payload=()=>JSON.parse(fs.readFileSync(path.resolve(__dirname,'../games/declarative/backgammon.json'),'utf8'));

async function instrument(page:Page){
  await page.addInitScript(()=>{
    const w=window as any,animate=Element.prototype.animate;w.referenceAnimations=[];
    Element.prototype.animate=function(...args:any[]){
      const animation=animate.apply(this,args as any),id=this.closest('[data-ui-id]')?.getAttribute('data-ui-id');
      if(!id)return animation;
      const record:any={id,kind:this.classList.contains('declarative-roll')?'roll':id.endsWith('_notice')?'notice':'move',
        started:performance.now(),duration:animation.effect!.getTiming().duration,
        delay:animation.effect!.getTiming().delay,easing:animation.effect!.getTiming().easing,
        keyframes:(animation.effect as KeyframeEffect).getKeyframes(),samples:[]};
      w.referenceAnimations.push(record);
      const sample=()=>{
        if(record.kind==='move'){
          const matrix=new DOMMatrix(getComputedStyle(this).transform);
          record.samples.push({time:Number(animation.currentTime),x:matrix.e,y:matrix.f});
        }
        if(animation.playState==='running'||animation.pending)requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      animation.finished.then(()=>{record.finished=performance.now();},()=>{record.cancelled=performance.now();});
      return animation;
    };
  });
}

async function mountVector(page:Page,name:string,mode:'computer'|'pass'='pass'){
  await instrument(page);await page.goto('/static/declarative-test.html');
  const game=payload();
  let vector=game.unit_tests.cases.find((item:any)=>item.name===name);
  if(name==='Ordinary roll'||name==='Opening winner'||name==='Opening tie'){
    // Produce a valid post-opening roll through the actual authority. The
    // package's initial example may instead be a settings or opening action.
    const initial=game.unit_tests.cases.find((item:any)=>item.name==='Initial move');
    const opening=name.startsWith('Opening ');
    const state={...initial.state,configured:true,opening,
      opening_roll:opening?[6,null]:null,cur:opening?1:initial.state.cur,
      needRoll:true,dice:[],moves:[],last_roll:null};
    const rules=new Function('InvalidMove',game.server_code+';return game;')(class extends Error{});
    let draw=0;const ctx={...initial.ctx,random:()=>name==='Opening tie'?.9:[.1,.8][draw++%2]};
    const player_id=ctx.players[state.cur].id,move={action:'roll'};
    const after=rules.applyMove(state,player_id,move,ctx);
    vector={name,ctx:{...initial.ctx},player_id,move,
      view_of_mover:rules.viewFor(state,player_id,ctx),
      expected_view_of_mover:rules.viewFor(after.state,player_id,{...ctx,move_count:ctx.move_count+1})};
  }
  expect(vector,`missing authoritative vector ${name}`).toBeTruthy();
  await page.evaluate(async({spec,vector,mode})=>{
    (document.querySelector('main') as HTMLElement).style.display='none';
    const box=document.createElement('div');box.id='reference-game';box.style.cssText='position:fixed;inset:0;z-index:9999';document.body.append(box);
    const w=window as any,actor=vector.ctx.players.findIndex((player:any)=>player.id===vector.player_id);
    const message=(view:any,count:number,last:number|null)=>({type:'state_changed',view,state:view,status:view.winner===null?'ongoing':'over',
      players:vector.ctx.players.map((player:any,index:number)=>({player_index:index,name:mode==='computer'?(index===actor?'You':'Computer'):`Player ${index+1}`,kind:mode==='computer'&&index!==actor?'computer':'human'})),
      my_player_index:actor,acting_for_player_index:view.cur===actor?actor:mode==='pass'?view.cur:null,
      turn_of_player_indices:view.winner===null?[view.cur]:null,move_count:count,last_move_player_index:last});
    w.referenceMoves=[];w.referenceSpec=spec;w.referenceBefore=message(vector.view_of_mover,vector.ctx.move_count,null);
    w.referenceAfter=message(vector.expected_view_of_mover,vector.ctx.move_count+1,actor);
    w.referenceHost=w.DeclarativeUI.mount(box,spec,{animate:true,onScene:(scene:any)=>w.referenceScene=scene,
      onMove:(move:any)=>{w.referenceMoves.push(move);void w.referenceHost.send(w.referenceAfter);}});
    if(await w.referenceHost.send(w.referenceBefore)!==true)throw new Error(box.querySelector('.declarative-error')?.textContent||'Reference scene failed to render');
  },{spec:game.declarative_ui,vector,mode});
  return vector;
}

async function playVector(page:Page,vector:any){
  const targetId='to_'+String(vector.move.to);
  const id=await page.evaluate(targetId=>(window as any).referenceScene.pieces.find((piece:any)=>piece.move_targets?.includes(targetId)).id,targetId);
  await page.locator(`#reference-game .declarative-piece[data-ui-id="${id}"]`).locator(':scope > g[opacity]').click();
  const target=page.locator(`#reference-game .declarative-target[data-ui-id="${targetId}"]`);
  await expect(target).toHaveAttribute('data-drop-state','allowed');await target.click();
  await expect.poll(()=>page.evaluate(()=>(window as any).referenceMoves)).toEqual([vector.move]);
  await expect.poll(()=>page.evaluate(id=>(window as any).referenceAnimations.some((item:any)=>item.id===id),id)).toBe(true);
  return id;
}

async function finishedRecords(page:Page){
  await page.evaluate(async()=>{await (window as any).referenceHost.whenIdle();});
  const records=await page.evaluate(()=>(window as any).referenceAnimations);
  for(const record of records){
    expect(record.cancelled,`${record.id} animation cancelled`).toBeUndefined();
    expect(record.finished-record.started).toBeGreaterThanOrEqual(record.duration+record.delay-45);
    expect(record.finished-record.started).toBeLessThan(record.duration+record.delay+650);
  }
  return records;
}

for(const mode of ['computer','pass'] as const)test(`reference checker timing and delayed hit follow real playback in ${mode} mode`,async({page},testInfo)=>{
  const game=payload();
  expect(game.declarative_ui.viewport.camera_enabled).toBe(false);
  expect(game.declarative_ui.motion).toMatchObject({move_ms:800,roll_ms:500,roll_settle_ms:1000,turn_pause_ms:500,animate_own:true,easing:'ease-in-out-quad'});
  const vector=await mountVector(page,'Hit a blot',mode),id=await playVector(page,vector);
  // A repeated server poll must retain the physical slide and its original clock.
  await page.evaluate(async()=>{const w=window as any;await w.referenceHost.send(w.referenceAfter);});
  const records=await finishedRecords(page),moving=records.find((item:any)=>item.id===id);
  expect(records.filter((item:any)=>item.id===id)).toHaveLength(1);
  expect(moving).toMatchObject({duration:800,delay:0,easing:'linear'});
  const actor=vector.ctx.players.findIndex((player:any)=>player.id===vector.player_id);
  const captured=records.find((item:any)=>item.id.startsWith(`checker_${1-actor}_`));
  expect(captured).toMatchObject({duration:400,delay:400});
  // Measure the rendered transform against the reference's quadratic curve.
  // At 25% time it has travelled 12.5%; at 75% it has travelled 87.5%.
  const matrix=(value:string)=>{
    const numbers=value.match(/matrix\(([^)]+)\)/)?.[1].split(',').map(Number);
    expect(numbers).toHaveLength(6);return {x:numbers![4],y:numbers![5]};
  };
  const start=matrix(moving.keyframes[0].transform),end=matrix(moving.keyframes.at(-1).transform);
  const dx=end.x-start.x,dy=end.y-start.y,distance=dx*dx+dy*dy;
  expect(distance).toBeGreaterThan(0);
  for(const fraction of [.25,.75]){
    const sample=moving.samples.reduce((closest:any,item:any)=>Math.abs(item.time/800-fraction)<Math.abs(closest.time/800-fraction)?item:closest);
    expect(Math.abs(sample.time/800-fraction)).toBeLessThan(.09);
    const progress=((sample.x-start.x)*dx+(sample.y-start.y)*dy)/distance,t=sample.time/800;
    const expected=t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
    expect(progress).toBeCloseTo(expected,1);
  }
  const timing=testInfo.outputPath(`${mode}-timing.json`),board=testInfo.outputPath(`${mode}-board.png`);
  fs.writeFileSync(timing,JSON.stringify(records));
  await page.locator('#reference-game').screenshot({path:board});
  await testInfo.attach(`${mode}-timing`,{path:timing,contentType:'application/json'});
  await testInfo.attach(`${mode}-board`,{path:board,contentType:'image/png'});
});

test('bearing off takes 400 ms and leaves all thirty physical checkers represented',async({page},testInfo)=>{
  const vector=await mountVector(page,'Bear off'),id=await playVector(page,vector);
  const records=await finishedRecords(page);
  expect(records.find((item:any)=>item.id===id)).toMatchObject({duration:400,delay:0});
  await expect(page.locator('#reference-game .declarative-piece[data-ui-id^="checker_"]')).toHaveCount(30);
  await testInfo.attach('bearing-off-timing',{body:JSON.stringify(records),contentType:'application/json'});
});

test('a computer reply plays its checker slide before the next human can interact',async({page},testInfo)=>{
  const vector=await mountVector(page,'Hit a blot','computer');
  const actor=vector.ctx.players.findIndex((player:any)=>player.id===vector.player_id);
  await page.evaluate(async actor=>{
    const w=window as any,viewer=1-actor;w.referenceHost.destroy();
    const players=w.referenceBefore.players.map((player:any)=>({...player,kind:player.player_index===actor?'computer':'human'}));
    const before={...w.referenceBefore,players,my_player_index:viewer,acting_for_player_index:null};
    const after={...w.referenceAfter,players,my_player_index:viewer,acting_for_player_index:w.referenceAfter.view.cur===viewer?viewer:null};
    w.referenceHost=w.DeclarativeUI.mount(document.getElementById('reference-game'),w.referenceSpec,
      {animate:true,onScene:(scene:any)=>w.referenceScene=scene,onMove:(move:any)=>w.referenceMoves.push(move)});
    await w.referenceHost.send(before);await w.referenceHost.send(after);
  },actor);
  await expect(page.locator('#reference-game .declarative-piece.actionable')).toHaveCount(0);
  const records=await finishedRecords(page);
  expect(records.some((record:any)=>record.id.startsWith(`checker_${actor}_`)&&record.duration===800&&record.delay===0)).toBe(true);
  expect(records.some((record:any)=>record.id.startsWith(`checker_${1-actor}_`)&&record.duration===400&&record.delay===400)).toBe(true);
  expect(await page.evaluate(()=>(window as any).referenceMoves)).toEqual([]);
  await testInfo.attach('computer-reply-timing',{body:JSON.stringify(records),contentType:'application/json'});
});

test('dice artwork rolls for 500 ms and move selection waits for the 1000 ms roll state',async({page},testInfo)=>{
  const vector=await mountVector(page,'Ordinary roll');
  const roll=page.locator('#reference-game .declarative-piece[data-ui-id="die_0"]');
  await roll.locator(':scope > g[opacity]').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).referenceMoves)).toEqual([vector.move]);
  await expect.poll(()=>page.evaluate(()=>(window as any).referenceAnimations.filter((record:any)=>record.kind==='roll').length)).toBe(2);
  const afterRoll=await page.evaluate(()=>({at:performance.now(),started:(window as any).referenceAnimations.find((record:any)=>record.kind==='roll').started}));
  expect(afterRoll.at-afterRoll.started).toBeLessThan(800);
  await expect(page.locator('#reference-game .declarative-piece.actionable')).toHaveCount(0);
  await page.waitForFunction(()=>{
    const w=window as any,roll=w.referenceAnimations.find((record:any)=>record.kind==='roll');return performance.now()-roll.started>=700;
  });
  await expect(page.locator('#reference-game .declarative-piece.actionable')).toHaveCount(0);
  const finished=await finishedRecords(page),elapsed=await page.evaluate(()=>performance.now()-(window as any).referenceAnimations[0].started);
  expect(elapsed).toBeGreaterThanOrEqual(970);
  expect(finished.filter((record:any)=>record.kind==='roll').map((record:any)=>record.duration)).toEqual([500,500]);
  await expect(page.locator('#reference-game .declarative-piece.actionable')).not.toHaveCount(0);
  await testInfo.attach('roll-timing',{body:JSON.stringify({elapsed,finished}),contentType:'application/json'});
});

for(const notice of [{name:'Opening winner',id:'opening_notice',duration:2000},{name:'Opening tie',id:'tie_notice',duration:500}])test(`${notice.name} follows the 1000 ms roll and lasts ${notice.duration} ms without restarting on a poll`,async({page},testInfo)=>{
  await mountVector(page,notice.name);
  await page.locator('#reference-game .declarative-piece[data-ui-id="roll"]').locator(':scope > g[opacity]').click();
  await expect.poll(()=>page.evaluate(id=>(window as any).referenceAnimations.some((item:any)=>item.id===id),notice.id)).toBe(true);
  await expect(page.locator('#reference-game .declarative-piece.actionable')).toHaveCount(0);
  await page.evaluate(async()=>{const w=window as any;await w.referenceHost.send(w.referenceAfter);});
  const records=await finishedRecords(page),observed=records.filter((record:any)=>record.id===notice.id);
  expect(observed).toHaveLength(1);expect(observed[0]).toMatchObject({kind:'notice',duration:notice.duration,delay:1000});
  await expect(page.locator('#reference-game .declarative-piece.actionable')).not.toHaveCount(0);
  await testInfo.attach('opening-announcement-timing',{body:JSON.stringify(observed),contentType:'application/json'});
});

async function flowClick(page:Page,id:string){
  const before=await page.evaluate(()=>({count:(window as any).flowCount,scenes:(window as any).flowScenes}));
  const piece=page.locator(`#reference-game .declarative-piece[data-ui-id="${id}"]`);
  const emitsTap=(await piece.getAttribute('data-actions'))?.split(' ').includes('tap');
  await piece.locator(':scope > g[opacity]').click({timeout:10000});
  if(emitsTap)await expect.poll(()=>page.evaluate(()=>(window as any).flowScenes)).toBeGreaterThan(before.scenes);
  return before.count;
}

async function flowAccepted(page:Page,before:number){
  await expect.poll(()=>page.evaluate(()=>(window as any).flowErrors)).toEqual([]);
  await expect.poll(()=>page.evaluate(()=>(window as any).flowCount)).toBe(before+1);
  await expect.poll(()=>page.evaluate(()=>(window as any).flowRenderedCount)).toBe(before+1);
}

async function flowChecker(page:Page){
  const {id,target}=await page.evaluate(()=>{
    const piece=(window as any).flowScene.pieces.find((piece:any)=>piece.actions?.includes('move'));
    return {id:piece.id,target:piece.move_targets[0]};
  });
  await flowClick(page,id);
  const before=await page.evaluate(()=>(window as any).flowCount);
  await page.locator(`#reference-game .declarative-target[data-ui-id="${target}"]`).click({timeout:10000});
  await flowAccepted(page,before);
}

test('options, opening turns, undo and cube take/drop work through real UI clicks and authority',async({page},testInfo)=>{
  test.setTimeout(90000);await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/static/declarative-test.html');
  await page.evaluate(async game=>{
    (document.querySelector('main') as HTMLElement).style.display='none';
    const box=document.createElement('div');box.id='reference-game';box.style.cssText='position:fixed;inset:0;z-index:9999';document.body.append(box);
    const initial=game.unit_tests.cases.find((item:any)=>item.name==='Initial move'),w=window as any;
    const rules=new Function('InvalidMove',game.server_code+';return game;')(class extends Error{});
    const ctx={...initial.ctx,players:initial.ctx.players.map((player:any,index:number)=>({...player,kind:index===1?'computer':'human'}))};
    w.flowCount=ctx.move_count;w.flowState=JSON.parse(JSON.stringify(initial.state));w.flowErrors=[];w.flowMoves=[];w.flowScenes=0;
    const draws=[.9,.1,.3,.7];
    const send=async(actor:number|null)=>{
      const current={...ctx,move_count:w.flowCount},seat=w.flowState.cur;
      const view=rules.viewFor(w.flowState,ctx.players[seat].id,current);
      const changed={type:'state_changed',view,state:view,status:w.flowState.winner===null?'ongoing':'over',
        players:ctx.players.map((player:any,index:number)=>({player_index:index,name:index===0?'Player':'Computer',kind:player.kind})),
        my_player_index:seat,acting_for_player_index:w.flowState.winner===null?seat:null,
        turn_of_player_indices:w.flowState.winner===null?[seat]:null,move_count:w.flowCount,last_move_player_index:actor};
      if(await w.flowHost.send(changed)!==true)throw new Error(box.querySelector('.declarative-error')?.textContent||'Flow scene failed to render');
      w.flowRenderedCount=w.flowCount;
    };
    w.flowHost=w.DeclarativeUI.mount(box,game.declarative_ui,{onScene:(scene:any)=>{w.flowScene=scene;w.flowScenes++;},onMove:async(move:any)=>{
      try{
        const actor=w.flowState.cur;
        const result=rules.applyMove(w.flowState,ctx.players[actor].id,move,{...ctx,move_count:w.flowCount,random:()=>draws.length?draws.shift():.2});
        w.flowState=result.state;w.flowCount++;w.flowMoves.push(move);await send(actor);
      }catch(error){w.flowErrors.push(String(error));}
    }});
    await send(null);
  },payload());
  await expect(page.locator('#reference-game [data-ui-id="options_panel"]')).toBeVisible();
  await flowClick(page,'goal_1');await flowClick(page,'difficulty_3');await flowClick(page,'swap_colors');
  await expect.poll(()=>page.evaluate(()=>(window as any).flowScene.pieces.find((piece:any)=>piece.id==='option_checker_0').type)).toBe('swatch_ivory');
  await expect.poll(()=>page.evaluate(()=>(window as any).flowScene.pieces.find((piece:any)=>piece.id==='goal_1').selected)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>(window as any).flowScene.pieces.find((piece:any)=>piece.id==='difficulty_3').selected)).toBe(true);
  const options=testInfo.outputPath('configured-options.png');await page.locator('#reference-game').screenshot({path:options});
  await testInfo.attach('configured-options',{path:options,contentType:'image/png'});
  await flowAccepted(page,await flowClick(page,'start_game'));
  expect(await page.evaluate(()=>({goal:(window as any).flowState.goal,difficulty:(window as any).flowState.difficulty,cube:(window as any).flowState.cube_enabled}))).toEqual({goal:1,difficulty:3,cube:true});
  await flowAccepted(page,await flowClick(page,'roll'));
  expect(await page.evaluate(()=>({cur:(window as any).flowState.cur,faces:(window as any).flowState.opening_roll}))).toEqual({cur:1,faces:[6,null]});
  await flowAccepted(page,await flowClick(page,'roll'));
  expect(await page.evaluate(()=>({cur:(window as any).flowState.cur,opening:(window as any).flowState.opening,faces:(window as any).flowState.dice}))).toEqual({cur:0,opening:false,faces:[6,1]});
  const beforeChecker=await page.evaluate(()=>{
    const s=(window as any).flowState;return {owner:s.owner,cnt:s.cnt,bar:s.bar,off:s.off,dice:s.dice,moves:s.moves,cur:s.cur};
  });
  await flowChecker(page);await expect(page.locator('#reference-game [data-ui-id="undo"]')).toBeVisible();
  await flowAccepted(page,await flowClick(page,'undo'));
  expect(await page.evaluate(()=>{const s=(window as any).flowState;return {owner:s.owner,cnt:s.cnt,bar:s.bar,off:s.off,dice:s.dice,moves:s.moves,cur:s.cur};})).toEqual(beforeChecker);
  for(let i=0;i<4&&!await page.evaluate(()=>(window as any).flowState.needRoll);i++)await flowChecker(page);
  expect(await page.evaluate(()=>(window as any).flowState.cur)).toBe(1);
  await flowAccepted(page,await flowClick(page,'double'));
  expect(await page.evaluate(()=>(window as any).flowState.cube)).toMatchObject({value:1,offer:1});
  await flowAccepted(page,await flowClick(page,'take'));
  expect(await page.evaluate(()=>(window as any).flowState.cube)).toEqual({value:2,owner:0,offer:null});
  await flowAccepted(page,await flowClick(page,'roll'));
  for(let i=0;i<4&&!await page.evaluate(()=>(window as any).flowState.needRoll);i++)await flowChecker(page);
  expect(await page.evaluate(()=>(window as any).flowState.cur)).toBe(0);
  await flowAccepted(page,await flowClick(page,'double'));
  await flowAccepted(page,await flowClick(page,'drop'));
  expect(await page.evaluate(()=>({winner:(window as any).flowState.winner,scores:(window as any).flowState.scores}))).toEqual({winner:0,scores:[2,0]});
  expect(await page.evaluate(()=>(window as any).flowErrors)).toEqual([]);
  await expect(page.locator('#reference-game .declarative-piece.actionable')).toHaveCount(0);
  await testInfo.attach('accepted-authority-actions',{body:JSON.stringify(await page.evaluate(()=>(window as any).flowMoves)),contentType:'application/json'});
});
