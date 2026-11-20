/** Generate legal, deterministic offline positions; UI drivers make the actual audit moves. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {PortalStore} from '../frontends/portal/src/core';
import {emptyAccountData, equal} from '../frontends/portal/src/core/repository';
import {rulesSource, presentationSource} from '../frontends/portal/src/game/runtimeSource';

async function main(){
const directory=path.resolve('tests/fixtures/portal-parity');
const packages=JSON.parse(fs.readFileSync(path.join(directory,'packages.json'),'utf8'));
const bundled=JSON.parse(fs.readFileSync('frontends/portal/src/core/bundled-tictactoe.json','utf8'));
const games=[{slug:'tictactoe',source:'frontends/portal/src/core/bundled-tictactoe.json',game:bundled},...packages];
const createdAt='2026-11-19T00:00:00.000Z',seed=420;
const sourceSha=execFileSync('git',['rev-parse',process.env.PARITY_SOURCE_SHA||'HEAD'],{encoding:'utf8'}).trim();
// A diagnostic-only commit may reuse an app binary; a different application may not.
execFileSync('git',['diff','--exit-code',sourceSha,'--','frontends/portal/src','frontends/portal/modules','frontends/portal/package.json','frontends/portal/package-lock.json'],{stdio:'pipe'});
const clone=(value:any)=>JSON.parse(JSON.stringify(value));
function invoke(game:any,name:string,args:any[],match:any){
  const ctx={players:match.players.map((p:any)=>({id:p.id,kind:p.kind,active:true,display_name:p.name,picture_url:'',max_loss:0})),pot:0,move_count:match.move_count};
  const result=JSON.parse(vm.runInNewContext(rulesSource(game,name,args,ctx,(match.practiceSeed+match.move_count)>>>0,Date.parse(match.created_at)),{},{timeout:5000}));
  if(!result.ok)throw Error(result.message);return result.result;
}
function present(game:any,message:any,local:any={}){
  return JSON.parse(vm.runInNewContext(presentationSource(game.declarative_ui.ui_code,message,local),{},{timeout:3000}));
}
function actionsFor(game:any,message:any,move:any){
  const first=present(game,message),queue=[{result:first,actions:[] as any[]}];let inspected=0;
  const seen=new Set<string>();
  while(queue.length&&inspected++<200){
    const current=queue.shift()!;if(current.actions.length>=3)continue;
    const scene=current.result.scene;
    const targets=[...(scene.targets||[]),...(scene.controls||[]).filter((x:any)=>x.kind==='button'),...(scene.pieces||[]).filter((x:any)=>x.actions?.includes('tap'))];
    for(const target of targets){
      const event={type:'tap',id:target.id};
      const result=present(game,{type:'ui_event',event,state_changed:message},current.result.local_state||{});
      const action={id:target.id,label:target.aria_label||target.label||target.id,board:target.board,position:target.position,hitArea:target.hit_area};
      const actions=[...current.actions,action];
      if(result.make_move!==undefined){if(equal(result.make_move,move))return actions;continue;}
      const key=JSON.stringify(result.local_state||{});if(seen.has(key))continue;seen.add(key);queue.push({result,actions});
    }
  }
  throw Error(`No real UI action sequence emits ${JSON.stringify(move)} for ${game.name}`);
}
const accountData=emptyAccountData();
accountData.responses['/games']=games.map(({game}:any)=>clone(game));
Object.assign(accountData.responses,{'/auth/config':{},'/matches':[],'/users/me/saved-games':[],'/users/me/invites':[],'/games/popular':[]});
for(const item of games){
  const {game,slug}=item;
  accountData.responses[`/games/${game.id}`]=game;
  accountData.responses[`/games/${game.id}/versions/${game.version}`]=game;
  const match:any={id:`local-parity-${slug}`,game_id:game.id,game_version:game.version,owner_user_id:'visitor',
    players:[{player_index:0,id:'local-player-0',kind:'human',user_id:'visitor',active:true,name:'Player 1'},{player_index:1,id:'local-player-1',kind:'computer',user_id:null,active:true,name:'Computer 2'}],
    status:'ongoing',state:null,logicState:null,turn_of_player_indices:[0],move_count:0,created_at:createdAt,localMode:'computer',practiceSeed:seed,moves:[],initialState:null,initialTurn:[0],awaitingHandoff:false,token_pot:0,bet_per_player:0};
  const result=invoke(game,'newMatch',[],match);match.logicState=result.state;match.turn_of_player_indices=result.turn.map((id:string)=>match.players.findIndex((p:any)=>p.id===id));
  match.state=invoke(game,'viewFor',[match.logicState,'local-player-0'],match);match.initialState=clone(match.state);match.initialTurn=clone(match.turn_of_player_indices);
  accountData.local[match.id]=match;
}
const initialData=clone(accountData),saved:Record<string,string>={'buildplay.shared.v1.visitor':JSON.stringify(accountData)};
Object.defineProperties(saved,{getItem:{value:(key:string)=>Object.hasOwn(saved,key)?saved[key]:null},setItem:{value:(key:string,value:string)=>{saved[key]=String(value);}},removeItem:{value:(key:string)=>{delete saved[key];}}});
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:saved});
const store=new PortalStore(async(game,name,args,ctx,seed,now)=>{
  const result=JSON.parse(vm.runInNewContext(rulesSource(game,name,args,ctx,seed,now),{},{timeout:5000}));if(!result.ok)throw Error(result.message);return result.result;
});
await store.bootstrap('https://buildplay.fun',true);
const scenarios=[];
for(const {slug,game,source} of games){
  const matchId=`local-parity-${slug}`;await store.actions.selectMatch(matchId);
  const initialMessage=store.actions.presentationMessage(),initialScene=present(game,initialMessage).scene;
  const steps=[];
  for(let index=0;index<3;index++){
    const before=store.getSnapshot().selectedMatch!;if(before.status!=='ongoing')break;
    const humanMove=slug==='tictactoe'?{cell:before.state.legal[0].cell}:slug==='connect4'?{column:[0,1,0][index]}:{from:before.state.moves[0].from,to:before.state.moves[0].to};
    const message=store.actions.presentationMessage(),uiActions=actionsFor(game,message,humanMove);
    await store.actions.practiceMove(humanMove);
    const persisted=JSON.parse(saved['buildplay.shared.v1.visitor']).local[matchId],afterMessage=store.actions.presentationMessage();
    steps.push({number:index+1,humanMove,uiActions,expectedMatch:persisted,message:afterMessage,scene:present(game,afterMessage).scene});
  }
  scenarios.push({slug,source,matchId,gameId:game.id,gameVersion:game.version,name:game.name,initial:initialData.local[matchId],initialMessage,initialScene,steps});
}
const output={version:1,sourceSha,createdAt,seed,viewport:{width:402,height:874},accountData:initialData,
  storage:{'buildplay.shared.v1.visitor':JSON.stringify(initialData)},games:scenarios};
fs.writeFileSync(path.join(directory,'common.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({sourceSha,bytes:fs.statSync(path.join(directory,'common.json')).size,games:scenarios.map(x=>({slug:x.slug,steps:x.steps.map(s=>({move:s.humanMove,actions:s.uiActions.map(a=>a.label),count:s.expectedMatch.move_count}))}))},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
