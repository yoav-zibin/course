import {test, expect, type Page, type APIRequestContext} from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const state=(extra:Record<string,unknown>={})=>({type:'state_changed',status:'ongoing',move_count:0,
  my_player_index:0,acting_for_player_index:0,last_move_player_index:null,view:{step:0},...extra});

function specification(declared=true){
  return {format:'buildplay-ui',version:1,viewport:{width:400,height:300},
    boards:[{id:'board',kind:'zone',x:0,y:0,width:400,height:300}],
    piece_types:{plate:{shape:'rect',width:150,height:150,color:'#385f81'},marble:{shape:'circle',width:35,height:35,color:'#ffc93c'}},
    ui_code:`const gameUI={reduce(input,local){
      const m=input.type==='ui_event'?input.state_changed:input,event=input.type==='ui_event'?input.event:null;
      const step=event?(local?.step||0)+1:(m.view.step||0),angle=step*90;
      const out={scene:{pieces:[
        {id:'plate',type:'plate',board:'board',position:{x:130,y:150},rotation:angle,aria_label:'Rotating plate',actions:[]},
        {id:'marble',type:'marble',board:'board',position:{x:130,y:150},rotation:angle,aria_label:'Riding marble',actions:[]},
        {id:'marker',type:'marble',board:'board',position:{x:240+step*20,y:150},aria_label:'Unanimated marker',actions:[]}],
        controls:[{id:'rotate',kind:'button',label:'Rotate plate'},{id:'repeat',kind:'button',label:'Repeat animation key'},
          {id:'submit',kind:'button',label:'Submit turn'}]},local_state:{step}};
      if(${declared}&&step>0)out.animations=m.view.suppress?[]:['plate','marble'].map(piece_id=>({piece_id,
        key:event?.id==='repeat'?'turn-1':'turn-'+step,from:{rotation:angle-90},duration_ms:900}));
      if(event?.id==='submit')out.make_move={angle};
      return out;
    }};`};
}

async function mount(page:Page,request:APIRequestContext,pkg:any,initial=state()){
  const response=await request.post('/games/declarative/client',{data:pkg});
  expect(response.ok(),await response.text()).toBeTruthy();
  const document=(await response.json()).client_code;
  await page.addInitScript(()=>{
    Object.assign(window,{__moves:[],__ready:false,__sceneCount:0,__lastSceneMessage:null});
    window.addEventListener('message',event=>{
      if(event.source!==window)return;
      if(event.data?.type==='make_move')(window as any).__moves.push(event.data.move);
      if(event.data?.type==='game_ready')(window as any).__ready=true;
      if(event.data?.type==='game_scene'){
        (window as any).__sceneCount++;
        (window as any).__lastSceneMessage=event.data.message;
      }
    });
  });
  await page.route('**/scene-animation-fixture',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:document}));
  await page.goto('/scene-animation-fixture');
  await page.waitForFunction(()=>(window as any).__ready);
  await send(page,initial);
  await page.waitForFunction(()=>(window as any).__sceneCount>0);
  await expect(page.getByRole('alert')).toHaveCount(0);
}
async function send(page:Page,message:Record<string,unknown>){await page.evaluate(value=>window.postMessage(value,'*'),message);}
async function painted(page:Page,count:number){await page.waitForFunction(count=>(window as any).__lastSceneMessage?.move_count===count,count);}
async function sceneCount(page:Page){return page.evaluate(()=>(window as any).__sceneCount as number);}
async function angle(page:Page,label:string){
  return page.getByLabel(label,{exact:true}).evaluate(node=>Number(/rotate\(([-\d.e]+)\)/.exec(node.getAttribute('transform')||'')?.[1]));
}
async function settled(page:Page,label:string,rotation:number){
  await expect.poll(()=>angle(page,label),{timeout:10000}).toBeCloseTo(rotation,6);
}
type Frame={angles:Record<string,number>;positions:Record<string,number[]>};
async function watch(page:Page,labels:string[]){
  await page.evaluate(labels=>{
    const global=window as any;global.__sceneObserver?.disconnect();global.__sceneFrames=[];
    let previous='';
    const record=()=>{
      const frame:Frame={angles:{},positions:{}};
      for(const label of labels){
        const node=[...document.querySelectorAll('g[aria-label]')].find(node=>node.getAttribute('aria-label')===label);
        const transform=node?.getAttribute('transform')||'';
        const rotation=/rotate\(([-\d.e]+)\)/.exec(transform),position=/translate\(([-\d.e]+)[, ]+([-\d.e]+)\)/.exec(transform);
        if(rotation)frame.angles[label]=Number(rotation[1]);
        if(position)frame.positions[label]=[Number(position[1]),Number(position[2])];
      }
      const encoded=JSON.stringify(frame);
      if(encoded!==previous){global.__sceneFrames.push(frame);previous=encoded;}
    };
    record();global.__sceneObserver=new MutationObserver(record);
    global.__sceneObserver.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
  },labels);
}
async function frames(page:Page):Promise<Frame[]>{return page.evaluate(()=>(window as any).__sceneFrames);}
async function noMoves(page:Page){expect(await page.evaluate(()=>(window as any).__moves)).toEqual([]);}
function parallelRotation(samples:Frame[],labels:string[],from:number,to:number){
  const intermediate=samples.filter(frame=>labels.every(label=>frame.angles[label]>from+8&&frame.angles[label]<to-8));
  expect(intermediate.length).toBeGreaterThan(3);
  for(const frame of intermediate){
    const angles=labels.map(label=>frame.angles[label]);
    expect(Math.max(...angles)-Math.min(...angles)).toBeLessThan(4);
  }
}

test('a local UI interaction animates a plate and marble together while the move count stays unchanged',async({page,request},info)=>{
  await mount(page,request,specification(),state({move_count:4}));
  const labels=['Rotating plate','Riding marble'];await watch(page,labels);
  const rotate=page.getByRole('button',{name:'Rotate plate',exact:true});
  await rotate.click();await expect(rotate).toBeDisabled();
  await settled(page,labels[0],90);await expect(rotate).toBeEnabled();
  parallelRotation(await frames(page),labels,0,90);
  expect(await page.evaluate(()=>(window as any).__lastSceneMessage.move_count)).toBe(4);
  await noMoves(page);await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('own-turn-local-rotation.png'),fullPage:true});
});

test('an accepted own move animates only the pieces explicitly named by the response',async({page,request})=>{
  await mount(page,request,specification());
  const labels=['Rotating plate','Riding marble'];await watch(page,[...labels,'Unanimated marker']);
  await send(page,state({move_count:1,last_move_player_index:0,view:{step:1}}));
  await settled(page,labels[0],90);parallelRotation(await frames(page),labels,0,90);
  const samples=(await frames(page)).filter(frame=>frame.angles['Rotating plate']>0);
  for(const sample of samples)expect(sample.positions['Unanimated marker']).toEqual([260,150]);
  await noMoves(page);
});

test('rapid local inputs cannot replace an animation before its controls lock',async({page,request})=>{
  await mount(page,request,specification());
  const rotate=page.getByRole('button',{name:'Rotate plate',exact:true});
  await watch(page,['Rotating plate']);
  await rotate.evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click();});
  await settled(page,'Rotating plate',90);await expect(rotate).toBeEnabled();
  expect((await frames(page)).every(frame=>frame.angles['Rotating plate']<=90)).toBe(true);
  await rotate.click();await settled(page,'Rotating plate',180);await expect(rotate).toBeEnabled();
  await noMoves(page);
});

test('repeated snapshots and local responses with the same animation key never replay it',async({page,request})=>{
  await mount(page,request,specification());
  const rotate=page.getByRole('button',{name:'Rotate plate',exact:true});
  await rotate.click();await settled(page,'Rotating plate',90);await expect(rotate).toBeEnabled();
  await watch(page,['Rotating plate']);const prior=await sceneCount(page);
  await page.getByRole('button',{name:'Repeat animation key',exact:true}).click();
  await page.waitForFunction(count=>(window as any).__sceneCount>count,prior);
  expect(await angle(page,'Rotating plate')).toBe(180);
  expect((await frames(page)).every(frame=>[90,180].includes(frame.angles['Rotating plate']))).toBe(true);
  await send(page,state({move_count:1,last_move_player_index:0,view:{step:1}}));
  await painted(page,1);expect(await angle(page,'Rotating plate')).toBe(90);
  await watch(page,['Rotating plate']);const paintedBefore=await sceneCount(page);
  await send(page,state({move_count:1,last_move_player_index:0,view:{step:1},strings:{}}));
  await page.waitForFunction(count=>(window as any).__sceneCount>count,paintedBefore);
  expect((await frames(page)).every(frame=>frame.angles['Rotating plate']===90)).toBe(true);
  await noMoves(page);
});

for(const mode of ['initial','reduced','history jump'] as const)test(`explicit ${mode} animations settle immediately and consume their key`,async({page,request})=>{
  if(mode==='reduced')await page.emulateMedia({reducedMotion:'reduce'});
  const first=mode==='initial'?state({move_count:1,view:{step:1}}):state();
  await mount(page,request,specification(),first);
  if(mode!=='initial'){
    const count=mode==='history jump'?3:1;
    await send(page,state({move_count:count,last_move_player_index:0,view:{step:1}}));
    await painted(page,count);
  }
  expect(await angle(page,'Rotating plate')).toBe(90);
  await watch(page,['Rotating plate']);const prior=await sceneCount(page);
  await page.getByRole('button',{name:'Repeat animation key',exact:true}).click();
  await page.waitForFunction(count=>(window as any).__sceneCount>count,prior);
  expect(await angle(page,'Rotating plate')).toBe(180);
  expect((await frames(page)).every(frame=>[90,180].includes(frame.angles['Rotating plate']))).toBe(true);
  await noMoves(page);
});

test('own moves remain immediate without an explicit request and an empty list suppresses opponent inference',async({page,request})=>{
  await mount(page,request,specification(false));
  await send(page,state({move_count:1,last_move_player_index:0,view:{step:1}}));
  await painted(page,1);expect(await angle(page,'Rotating plate')).toBe(90);
  await mount(page,request,specification());
  await send(page,state({move_count:1,last_move_player_index:1,view:{step:1,suppress:true}}));
  await painted(page,1);expect(await angle(page,'Rotating plate')).toBe(90);
  await noMoves(page);
});

test('an animated interaction submits one move and waits for its accepted snapshot without replaying',async({page,request})=>{
  await mount(page,request,specification());
  const submit=page.getByRole('button',{name:'Submit turn',exact:true});
  await submit.evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click();});
  await expect.poll(()=>page.evaluate(()=>(window as any).__moves)).toEqual([{angle:90}]);
  await expect(submit).toBeDisabled();
  await send(page,state({move_count:1,last_move_player_index:0,view:{step:1}}));
  await painted(page,1);await settled(page,'Rotating plate',90);
  await expect(submit).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).__moves)).toEqual([{angle:90}]);
});

test('Twist Five rotates the accepted own plate and all its marbles together',async({page,request},info)=>{
  const game=JSON.parse(readFileSync(path.resolve(__dirname,'../../../games/declarative/twistfive.json'),'utf8'));
  const flow=JSON.parse(readFileSync(path.resolve(__dirname,'../../../tests/fixtures/declarative/twistfive-animation-flow.json'),'utf8'));
  expect(flow.after.my_player_index).toBe(flow.after.last_move_player_index);
  await mount(page,request,game.declarative_ui,flow.before);
  const labels=['top-left plate','Black marble at B1','Gold marble at C1','Gold marble at B2','Gold marble at C2'];
  await watch(page,labels);await send(page,flow.after);
  await settled(page,labels[0],90);
  parallelRotation(await frames(page),labels,0,90);
  const centers=[[180,240],[180,170],[250,170],[180,240],[250,240]];
  for(const [index,label] of labels.entries()){
    await settled(page,label,90);
    const position=await page.getByLabel(label,{exact:true}).evaluate(node=>
      /translate\(([-\d.e]+)[, ]+([-\d.e]+)\)/.exec(node.getAttribute('transform')||'')?.slice(1).map(Number));
    expect(position?.map(Math.round)).toEqual(centers[index]);
  }
  await expect.poll(()=>page.getByLabel('Last marble placed: C2',{exact:true}).getAttribute('opacity')).toBe('1');
  await noMoves(page);await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('twistfive-own-rotation-final.png'),fullPage:true});
});

test('shared piles, cards and dice draw the public counts and faces supplied by the game',async({page,request})=>{
  const spec={...specification(),piece_types:{
    stock:{shape:'card_pile',width:40,height:56},card:{shape:'card',width:40,height:56},
    die:{shape:'dice',width:40,height:40},counter:{shape:'counter',width:64,height:40}},
    ui_code:`const gameUI={reduce(){
      const piece=(id,type,x,extra)=>({id,type,board:'board',position:{x,y:90},actions:[],...extra});
      return {scene:{pieces:[
        ...[0,1,5,52].map((count,i)=>piece('stock'+i,'stock',30+i*55,{count,face:'back',text:'SECRET_FACE'})),
        piece('face','card',250,{text:'Q♥'}),piece('d','die',305,{die_value:5}),
        piece('score','counter',360,{count:12,aria_label:'Score'})
      ]}};
    }}`};
  await mount(page,request,spec);
  const rects=[];
  for(const n of [0,1,5,52]){
    const pile=page.getByLabel('Covered piece · '+n,{exact:true});
    rects.push(await pile.locator('rect').count());
    if(n)await expect(pile.locator('text')).toHaveText(String(n));
  }
  expect(rects).toEqual([...rects].sort((a,b)=>a-b));expect(new Set(rects).size).toBe(4);
  await expect(page.getByText('SECRET_FACE',{exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Q♥',{exact:true}).locator('text')).toHaveText(['Q','♥','Q']);
  await expect(page.getByLabel('5',{exact:true}).locator('circle')).toHaveCount(5);
  await expect(page.getByLabel('Score',{exact:true}).locator('text')).toHaveText('12');
});

test('adjacent history plays the same plate turn backward',async({page,request})=>{
  const game=JSON.parse(readFileSync(path.resolve(__dirname,'../../../games/declarative/twistfive.json'),'utf8'));
  const flow=JSON.parse(readFileSync(path.resolve(__dirname,'../../../tests/fixtures/declarative/twistfive-animation-flow.json'),'utf8'));
  const history=(message:Record<string,unknown>)=>({...message,replay:true,acting_for_player_index:null});
  await mount(page,request,game.declarative_ui,history(flow.after) as ReturnType<typeof state>);
  const label='top-left plate';
  await watch(page,[label]);await send(page,history(flow.before));await settled(page,label,0);
  expect((await frames(page)).some(frame=>frame.angles[label]>0&&frame.angles[label]<90)).toBe(true);
  await noMoves(page);
});

test('selecting a rotated child and its destination submits a drop for the root',async({page,request})=>{
  const spec={...specification(),ui_code:`const gameUI={reduce(input){
    const scene={pieces:[
      {id:'rack',type:'plate',board:'board',position:{x:100,y:90},rotation:90,actions:['move'],move_targets:['dest'],aria_label:'Rack'},
      {id:'chip',type:'marble',board:'board',parent:'rack',position:{x:90,y:0},actions:[],aria_label:'Attached chip'}],
      targets:[{id:'dest',board:'board',position:{x:320,y:200},label:'Place rack'}]};
    return input.event?.type==='drop'?{scene,make_move:input.event}:{scene};
  }}`};
  await mount(page,request,spec);
  await page.getByLabel(/^Attached chip/).click();
  await page.getByLabel('Place rack',{exact:true}).first().click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__moves)).toEqual([
    {type:'drop',id:'rack',piece_id:'rack',target_id:'dest'}]);
});
