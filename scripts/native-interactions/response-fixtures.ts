// Create repeatable positions with published rules. All moves in the test are sent by real touch input.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import {contentBounds, position} from '../../frontends/portal/src/game/validation';
import {backgammonMatchPresentation} from '../../frontends/portal/src/game/backgammonMatchPresentation';

const directory=process.argv[2], packages=process.argv[3];
const key='buildplay.shared.v1.visitor',filename=createHash('sha256').update(key).digest('hex')+'.json';
const date='2026-01-01T00:00:00.000Z';
type Point={x:number;y:number};
type Action={id:string; label?:string; at?:Point; to?:Point; lift?:number; until?:string; absent?:string};
async function published(slug:string,id:string,version:number) {
  let raw;
  if(packages)raw=JSON.parse(readFileSync(path.join(packages,slug+'-public.json'),'utf8'));
  else {
    const response=await fetch('https://buildplay.fun/games/'+id+'/versions/'+version);
    if(!response.ok)throw Error('Could not read '+slug+' version '+version);
    raw=await response.json();
  }
  if(raw.id!==id||raw.version!==version||!raw.server_code||!raw.declarative_ui||!raw.supports_local_practice)throw Error('Incomplete pinned game '+slug);
  // Store only the fields read by the local player and rules runtime.
  return Object.fromEntries(['id','version','name','description','server_code','declarative_ui','game_schemas','renderer_type',
    'allowed_player_counts','all_state_public','supports_local_practice','ui_instructions','game_logic_rules'].map(k=>[k,raw[k]]));
}
function makeCase(slug:string,game:any,mode:string,level:number,setup=false){
  const bg=slug==='backgammon',computer=mode==='computer';
  const id=[slug,mode,...(bg&&computer?[['easy','medium','hard','expert'][level]]:[]),...(setup?['setup']:[])].join('-');
  const dir=path.join(directory,id);mkdirSync(dir,{recursive:true});
  const players=[0,1].map(i=>({id:'local-player-'+i,player_index:i,active:true,kind:computer&&i===1?'computer':'human',
    name:computer&&i===1?'Computer':'Player '+(i+1),user_id:i===0?'visitor':null}));
  const rules=vm.runInNewContext(game.server_code+'\n;game;', {InvalidMove: Error},{timeout:2000});
  const ui=vm.runInNewContext(game.declarative_ui.ui_code+'\n;gameUI;',{},{timeout:2000});
  let ri=0;const rolls=[.88,.85,.22,.30,.75];
  const ctx={players:players.map(p=>({...p,display_name:p.name,picture_url:'',max_loss:0})),pot:0,random:()=>rolls[ri++%rolls.length],now:Date.parse(date),move_count:0};
  let result=rules.newMatch(ctx);
  const seat=()=>players.findIndex(p=>p.id===result.turn[0]);
  const view=()=>structuredClone(rules.viewFor(result.state,result.turn[0],ctx));
  const initialState=view(),initialTurn=[seat()],moves:any[]=[];
  let previous:number|null=null;
  function move(action:any){previous=seat();result=rules.applyMove(result.state,result.turn[0],action,ctx);ctx.move_count++;
    moves.push({move_number:ctx.move_count,player_index:previous,new_state:view(),next_turn_player_indices:[seat()],move:action});}
  if(!setup){
    if(bg)for(const action of [{action:'configure',difficulty:level,goal:3,cube_enabled:true},{action:'roll'},{action:'roll'}])move(action);
    else for(const column of [0,6,3,4,0,6])move({column});
  }
  // End the human turn with the measured checker so every computer level actually replies.
  if(bg&&computer&&!setup){
    const first=view().legalMoves[0];move({action:'move',from:first.from,to:first.to});
  }
  if(computer&&players[seat()].kind!=='human')throw Error('Fixture requires an active human seat '+id);
  const state=view(),spec=game.declarative_ui;
  const message={type:'state_changed',state,view:state,status:'ongoing',move_count:ctx.move_count,last_move_player_index:previous,
    players,my_player_index:seat(),acting_for_player_index:seat(),turn_of_player_index:seat(),turn_of_player_indices:[seat()],locale:'en',direction:'ltr',strings:spec.strings||{}};
  let scene=ui.reduce(message,{}).scene;
  if(bg)scene=backgammonMatchPresentation.presentScene!(scene,message as any);
  const bounds=contentBounds(spec,scene,bg?spec.boards.filter(backgammonMatchPresentation.visibleBoard):spec.boards);
  const at=(v:any):Point=>{if(!v)throw Error('Missing control in '+id);const {x,y}=position(spec,v);return{x,y};};
  const piece=(name:string)=>scene.pieces?.find((p:any)=>p.id===name);
  const actions:Action[]=[];
  let expected:any=null;
  if(setup){
    for(const name of ['swap_colors','goal_3','cube_off','cube_on','difficulty_0','difficulty_1','difficulty_2','difficulty_3','start_game'])
      actions.push({id:name,at:at(piece(name))});
  }else{
    if(mode==='pass'){
      actions.push({id:'open-menu',label:'match-menu-button',until:'Close'},{id:'close-menu',label:'Close',absent:'Close'},
        {id:'open-report',label:'bug-report-button',until:'Bug or feature request'},{id:'dismiss-report',label:'Close',absent:'Bug or feature request'});
    }
    if(bg){
      const choices=state.legalMoves.flatMap((m:any)=>{
        const p=scene.pieces.find((p:any)=>p.aria_label==='Player '+(seat()+1)+': Point '+(m.from+1)&&p.move_targets?.includes('to_'+m.to));
        const t=scene.targets?.find((t:any)=>t.id==='to_'+m.to);
        return p&&t?[{p,t,m,d:Math.hypot(at(p).x-at(t).x,at(p).y-at(t).y)}]:[];
      }).sort((a:any,b:any)=>b.d-a.d);
      const {p,t,m}=choices[0];
      if(computer&&level%2===0||mode==='pass')actions.push({id:'select-checker',at:at(p)},{id:'tap-destination',at:at(t)});
      else actions.push({id:'drag-checker',at:at(p),to:at(t),lift:spec.piece_types[p.type].height});
      expected={action:'move',from:m.from,to:m.to};
    }else{
      const p=scene.pieces.find((p:any)=>p.move_targets?.length),t=scene.targets.find((t:any)=>p.move_targets.includes(t.id)&&t.id.endsWith('2'));
      if(!t)throw Error('Missing Connect Four target: '+JSON.stringify(scene.targets));
      if(computer)actions.push({id:'tap-column',at:at(t)});
      else actions.push({id:'drag-disc',at:at(p),to:at(t),lift:spec.piece_types[p.type].height});
      expected={column:2};
    }
  }
  const match={id:'local-'+id,game_id:game.id,game_version:game.version,owner_user_id:'visitor',players,status:'ongoing',end_reason:null,
    match_kind:computer?'computer':'pass_and_play',state,logicState:result.state,turn_of_player_indices:[seat()],move_count:ctx.move_count,
    last_move_player_index:previous,created_at:date,localMode:computer?'computer':'pass',practiceSeed:420,moves,initialState,initialTurn,
    awaitingHandoff:false,token_pot:0,bet_per_player:0};
  const data={version:1,responses:{['/games/'+game.id+'/versions/'+game.version]:game},queues:{},conflicts:{},local:{[match.id]:match},archives:[],archivedMatches:[],selectedId:match.id};
  writeFileSync(path.join(dir,filename),JSON.stringify({key,value:JSON.stringify(data)}));
  const scenario={id,game:slug,version:game.version,mode,level,setup,filename,match:match.id,moveCount:ctx.move_count,bounds,actions,expected};
  writeFileSync(path.join(dir,'scenario.json'),JSON.stringify(scenario,null,2));return scenario;
}
async function main(){
  const bg=await published('backgammon','5f5293c3-2a3a-4eec-b631-9debf59be0ca',11);
  const four=await published('connect4','e299b14e-480d-44f3-8132-74282a46cebc',6);
  const cases=[makeCase('connect4',four,'pass',0),makeCase('connect4',four,'computer',0),makeCase('backgammon',bg,'pass',1),
    ...[0,1,2,3].map(i=>makeCase('backgammon',bg,'computer',i)),makeCase('backgammon',bg,'computer',1,true)];
  writeFileSync(path.join(directory,'scenarios.json'),JSON.stringify(cases,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
