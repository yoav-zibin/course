import {test, expect, type Page, type APIRequestContext} from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const load=(kind:string)=>JSON.parse(readFileSync(path.resolve(__dirname,`../../../games/declarative/${kind}.json`),'utf8'));
const state=(extra:Record<string,unknown>={})=>({type:'state_changed',status:'ongoing',move_count:0,
  my_player_index:0,acting_for_player_index:null,last_move_player_index:null,view:{},...extra});

async function mount(page:Page,request:APIRequestContext,pkg:any,initial:Record<string,unknown>){
  const response=await request.post('/games/declarative/client',{data:pkg});
  expect(response.ok(),await response.text()).toBeTruthy();
  const document=(await response.json()).client_code;
  await page.addInitScript(()=>{
    (window as any).__moves=[];(window as any).__ready=false;(window as any).__painted=-1;
    window.addEventListener('message',event=>{
      if(event.source!==window)return;
      if(event.data?.type==='make_move')(window as any).__moves.push(event.data.move);
      if(event.data?.type==='game_ready')(window as any).__ready=true;
      if(event.data?.type==='game_scene')(window as any).__painted=event.data.message.move_count;
    });
  });
  await page.route('**/move-animation-fixture',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:document}));
  await page.goto('/move-animation-fixture');
  await page.waitForFunction(()=>(window as any).__ready);
  await send(page,initial);
  await painted(page,initial.move_count as number);
  await expect(page.getByRole('alert')).toHaveCount(0);
}
async function send(page:Page,message:Record<string,unknown>){await page.evaluate(value=>window.postMessage(value,'*'),message);}
async function painted(page:Page,count:number){await page.waitForFunction(count=>(window as any).__painted===count,count);}
async function point(page:Page,name:string):Promise<number[]>{
  return page.getByLabel(name,{exact:true}).evaluate(node=>{
    const match=/translate\(([-\d.e]+)[, ]+([-\d.e]+)\)/.exec(node.getAttribute('transform')||'');
    return match?[Number(match[1]),Number(match[2])]:[];
  });
}
async function settled(page:Page,name:string,at:number[]){
  // Equivalent scene coordinates can differ by floating point rounding.
  await expect.poll(async()=>{
    const actual=await point(page,name);
    return actual.length===at.length?Math.max(...at.map((value,index)=>Math.abs(actual[index]-value))):Infinity;
  },{timeout:10000}).toBeLessThan(1e-6);
}
type Frame={t:number;positions:Record<string,number[]>};
async function watch(page:Page,names:string[],selectors:Record<string,{label:string;index?:number}>={}){
  await page.evaluate(({names,selectors})=>{
    const global=window as any;global.__animationObserver?.disconnect();global.__animationFrames=[];
    let previous='';
    const record=()=>{
      const positions:Record<string,number[]>={};
      for(const name of names){
        const {label=name,index=0}=selectors[name]||{};
        const node=[...document.querySelectorAll('g[aria-label]')].filter(node=>node.getAttribute('aria-label')===label)[index];
        const match=/translate\(([-\d.e]+)[, ]+([-\d.e]+)\)/.exec(node?.getAttribute('transform')||'');
        if(match)positions[name]=[Number(match[1]),Number(match[2])];
      }
      const encoded=JSON.stringify(positions);
      if(encoded!==previous){global.__animationFrames.push({t:performance.now(),positions});previous=encoded;}
    };
    record();global.__animationObserver=new MutationObserver(record);
    global.__animationObserver.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
  },{names,selectors});
}
async function frames(page:Page):Promise<Frame[]>{return page.evaluate(()=>(window as any).__animationFrames);}
async function noMoves(page:Page){expect(await page.evaluate(()=>(window as any).__moves)).toEqual([]);}

const connect4Views=()=>{
  const game=load('connect4'),before=structuredClone(game.unit_tests.cases[0].view_of_mover);
  Object.assign(before,{legal:[],turn:1,last_move:null});
  const after=structuredClone(before);after.board[41]=1;
  Object.assign(after,{turn:0,turns:1,last_move:{seat:1,column:6,cell:41}});
  return {game,before,after};
};

test('Connect Four authored paths drop vertically even when a reserve disc previously sat in another column',async({page,request},info)=>{
  const {game}=JSON.parse(readFileSync(path.resolve(__dirname,'../../../tests/fixtures/declarative/connect4-native-package.json'),'utf8'));
  const pkg=structuredClone(game.declarative_ui);
  pkg.ui_code+='\n'+readFileSync(path.resolve(__dirname,'../../../games/declarative/connect4-move-animations.js'),'utf8');
  const before={board:Array(42).fill(-1),disc_ids:Array(42).fill(-1),turn:1,turns:0,over:false,winner:-1,legal:[]};
  const after=structuredClone(before);after.board[41]=1;after.disc_ids[41]=0;after.turn=0;after.turns=1;
  await mount(page,request,pkg,state({view:before,strings:pkg.strings}));
  const name='Player 2 disc, row 6, column 7';
  await expect(page.getByLabel('Player 2 reserve disc',{exact:true})).toBeVisible();
  expect(await point(page,'Player 2 reserve disc')).toEqual([49,50]);
  await watch(page,[name]);
  await send(page,state({view:after,strings:pkg.strings,move_count:1,last_move_player_index:1}));
  const final=[349,374];
  await settled(page,name,final);
  const samples=(await frames(page)).map(frame=>frame.positions[name]).filter(Boolean);
  expect(samples.length).toBeGreaterThan(4);
  expect(samples[0][1]).toBeLessThan(90);
  expect(samples.some(([,y])=>y>100&&y<final[1]-20)).toBe(true);
  for(const [x]of samples)expect(x).toBeCloseTo(final[0],5);
  for(let i=1;i<samples.length;i++)expect(samples[i][1]).toBeGreaterThanOrEqual(samples[i-1][1]-.001);
  await expect(page.getByRole('alert')).toHaveCount(0);await noMoves(page);
  await page.screenshot({path:info.outputPath('connect4-authored-fall-final.png'),fullPage:true});
});

for(const mode of ['own','reduced','initial'] as const)test(`Connect Four ${mode} snapshots settle immediately with authored paths`,async({page,request})=>{
  const {game,before,after}=connect4Views(),pkg=game.declarative_ui;
  pkg.motion={move_ms:1500,animate_own:true};
  if(mode==='own'){after.board[41]=0;after.last_move.seat=0;after.turn=1;}
  if(mode==='reduced')await page.emulateMedia({reducedMotion:'reduce'});
  await mount(page,request,pkg,state({view:mode==='initial'?after:before,move_count:mode==='initial'?1:0}));
  if(mode!=='initial'){
    await watch(page,['piece_41']);
    await send(page,state({view:after,move_count:1,last_move_player_index:mode==='own'?0:1}));
    await painted(page,1);
  }
  const final=[24+6.5*400/6,100+5.5*400/6];
  const firstPaint=await point(page,'piece_41');
  expect(firstPaint[0]).toBeCloseTo(final[0],5);expect(firstPaint[1]).toBeCloseTo(final[1],5);
  await settled(page,'piece_41',final);
  if(mode!=='initial'){
    const samples=(await frames(page)).map(frame=>frame.positions.piece_41).filter(Boolean);
    expect(samples.length).toBeGreaterThan(0);
    for(const sample of samples){expect(sample[0]).toBeCloseTo(final[0],5);expect(sample[1]).toBeCloseTo(final[1],5);}
  }
  await noMoves(page);
});

const sequenceSpec=(hook=true)=>({format:'buildplay-ui',version:1,viewport:{width:600,height:300},
  motion:{move_ms:350},boards:[{id:'main',kind:'zone',x:0,y:0,width:260,height:300},{id:'tray',kind:'zone',x:300,y:0,width:260,height:300}],
  piece_types:{token:{shape:'circle',width:40,height:40,color:'#b8eea2'}},
  ui_code:`const gameUI={
    ${hook?`getLastMoveAnimations(view,scene){return view.step?[{piece_id:'first',duration_ms:500,path:[
      {board:'main',position:{x:50,y:60}},{board:'main',position:{x:220,y:60}}]},
      {piece_id:'second',duration_ms:1000,path:[{board:'main',position:{x:50,y:180}},
        {board:'main',position:{x:220,y:180}},{board:'tray',position:{x:40,y:220}}]}]:[];},`:''}
    reduce(message){const m=message.type==='ui_event'?message.state_changed:message,step=m.view.step;return {scene:{pieces:[
      {id:'first',type:'token',board:'main',position:{x:step?220:50,y:60},aria_label:'First checker',actions:[]},
      {id:'second',type:'token',board:step?'tray':'main',position:step?{x:40,y:220}:{x:50,y:180},aria_label:'Second checker',actions:[]}]
    }};}
  };`});

test('authored sequences hold later pieces at their start then traverse every waypoint across boards',async({page,request},info)=>{
  await mount(page,request,sequenceSpec(),state({view:{step:0}}));
  await watch(page,['First checker','Second checker']);
  await send(page,state({view:{step:1},move_count:1,last_move_player_index:1}));
  await settled(page,'Second checker',[340,220]);
  await settled(page,'First checker',[220,60]);
  const seen=await frames(page);
  const firstMoving=seen.filter(frame=>{const p=frame.positions['First checker'];return p&&p[0]>60&&p[0]<205;});
  expect(firstMoving.length).toBeGreaterThan(2);
  for(const frame of firstMoving)expect(frame.positions['Second checker']).toEqual([50,180]);
  const secondMoving=seen.filter(frame=>{const p=frame.positions['Second checker'];return p&&p[0]>55;});
  expect(secondMoving.length).toBeGreaterThan(8);
  for(const frame of secondMoving)expect(frame.positions['First checker']).toEqual([220,60]);
  expect(secondMoving.some(frame=>{const [x,y]=frame.positions['Second checker'];return x>80&&x<210&&Math.abs(y-180)<.01;})).toBe(true);
  expect(secondMoving.some(frame=>{const [x,y]=frame.positions['Second checker'];return x>230&&x<330&&y>180&&y<220;})).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);await noMoves(page);
  await page.screenshot({path:info.outputPath('authored-sequential-paths-final.png'),fullPage:true});
});

test('games without the hook retain default opponent interpolation',async({page,request})=>{
  await mount(page,request,sequenceSpec(false),state({view:{step:0}}));
  await watch(page,['First checker']);
  await send(page,state({view:{step:1},move_count:1,last_move_player_index:1}));
  await settled(page,'First checker',[220,60]);
  const samples=(await frames(page)).map(frame=>frame.positions['First checker']).filter(Boolean);
  expect(samples.some(([x])=>x>55&&x<215)).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);await noMoves(page);
});


const backgammonFlow=()=>JSON.parse(readFileSync(path.resolve(__dirname,'../../../tests/fixtures/declarative/backgammon-animation-flow.json'),'utf8'));
const backgammonPieces=['mover','first hit','second hit'];
const backgammonSelectors={mover:{label:'Player 1: Point 6'},'first hit':{label:'Player 2: Bar',index:0},'second hit':{label:'Player 2: Bar',index:1}};

test('Backgammon accepted combined moves paint checker stops and hits sequentially',async({page,request},info)=>{
  const game=load('backgammon'),flow=backgammonFlow();
  await mount(page,request,game.declarative_ui,flow.before);
  await watch(page,backgammonPieces,backgammonSelectors);
  await send(page,flow.after);
  await settled(page,'Player 1: Point 6',[396,515]);
  const samples=(await frames(page)).filter(frame=>backgammonPieces.every(id=>frame.positions[id]));
  expect(samples.length).toBeGreaterThan(20);
  const mover=samples.map(frame=>frame.positions.mover);
  for(const stop of [212,264,316])expect(mover.some(([x,y])=>Math.abs(x-stop)<3&&Math.abs(y-515)<.01)).toBe(true);
  const firstHit=samples.filter(frame=>{const [x]=frame.positions['first hit'];return x>220&&x<345;});
  expect(firstHit.length).toBeGreaterThan(2);
  for(const frame of firstHit){
    expect(frame.positions.mover).toEqual([212,515]);
    expect(frame.positions['second hit']).toEqual([316,515]);
  }
  const secondHit=samples.filter(frame=>{const [x,y]=frame.positions['second hit'];return x>319&&x<352&&y>474&&y<514;});
  expect(secondHit.length).toBeGreaterThan(2);
  for(const frame of secondHit){
    expect(frame.positions.mover).toEqual([316,515]);
    expect(frame.positions['first hit']).toEqual([356,515]);
  }
  const final=samples.at(-1)!.positions;
  expect(final.mover).toEqual([396,515]);expect(final['first hit']).toEqual([356,515]);expect(final['second hit']).toEqual([356,473]);
  await expect(page.getByRole('alert')).toHaveCount(0);await noMoves(page);
  await page.screenshot({path:info.outputPath('backgammon-authored-combined-hits-final.png'),fullPage:true});
});

test('Backgammon own combined moves settle all checkers immediately despite animate_own',async({page,request})=>{
  const game=load('backgammon'),flow=backgammonFlow();
  expect(game.declarative_ui.motion.animate_own).toBe(true);
  await mount(page,request,game.declarative_ui,{...flow.before,my_player_index:0,acting_for_player_index:null});
  await watch(page,backgammonPieces,backgammonSelectors);
  await send(page,{...flow.after,my_player_index:0,acting_for_player_index:null});
  await painted(page,flow.after.move_count);
  const firstPaint=await point(page,'Player 1: Point 6');
  expect(firstPaint).toEqual([396,515]);
  const samples=(await frames(page)).filter(frame=>backgammonPieces.every(id=>frame.positions[id]));
  expect(samples.length).toBeGreaterThan(0);
  for(const frame of samples){
    expect(frame.positions.mover).toEqual([396,515]);
    expect(frame.positions['first hit']).toEqual([356,515]);
    expect(frame.positions['second hit']).toEqual([356,473]);
  }
  await expect(page.getByRole('alert')).toHaveCount(0);await noMoves(page);
});
