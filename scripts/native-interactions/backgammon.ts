/** Build an offline opening from the checked-in Backgammon rules and renderer. */
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {BACKGAMMON_GAME_ID, backgammonMatchPresentation} from '../../frontends/portal/src/game/backgammonMatchPresentation';
import {contentBounds, position} from '../../frontends/portal/src/game/validation';
import type {Piece, Target} from '../../frontends/portal/src/game/types';

const output = process.argv[2];
const pkg = JSON.parse(readFileSync(path.join(__dirname, '../../games/declarative/backgammon.json'), 'utf8'));
const game = {id: BACKGAMMON_GAME_ID, version: 10, name: 'Backgammon', renderer_type: 'declarative',
  all_state_public: pkg.all_state_public, allowed_player_counts: pkg.allowed_player_counts, supports_local_practice: true,
  server_code: pkg.server_code, declarative_ui: pkg.declarative_ui, ui_instructions: pkg.ui_instructions,
  game_logic_rules: pkg.rules, game_schemas: Object.fromEntries(['move','view','state'].map(k=>[k,pkg.unit_tests[k+'_schema']]))};
const rules = vm.runInNewContext(game.server_code+'\n;game;', {InvalidMove: Error}, {timeout:1000});
const ui = vm.runInNewContext(game.declarative_ui.ui_code+'\n;gameUI;', {}, {timeout:1000});
const date='2026-01-01T00:00:00.000Z';
const players=[0,1].map(i=>({id:'local-player-'+i, player_index:i, kind:'human', active:true,
  name:'Player '+(i+1), user_id:i===0?'visitor':null}));
const rolls=[.88,.22,.53];
let roll=0;
const ctx={players:players.map(p=>({...p,display_name:p.name,picture_url:'',max_loss:0})), pot:0,
  random:()=>rolls[roll++ % rolls.length], now:Date.parse(date), move_count:0};
let current=rules.newMatch(ctx);
const seat=()=>players.findIndex(p=>p.id===current.turn[0]);
const view=()=>structuredClone(rules.viewFor(current.state,current.turn[0],ctx));
const initialTurn=[seat()], initialState=view(), moves=[];
let lastActor=seat();
for(const move of [{action:'configure',difficulty:1,goal:1,cube_enabled:true},{action:'roll'},{action:'roll'}]){
  lastActor=seat();
  current=rules.applyMove(current.state,current.turn[0],move,ctx);
  ctx.move_count++;
  moves.push({move_number:ctx.move_count,player_index:lastActor,new_state:view(),next_turn_player_indices:[seat()]});
}
const state=view();
if(state.opening || !state.legalMoves.length)throw Error('Expected a resolved opening with a legal checker move');
const msg={type:'state_changed',state,view:state,status:'ongoing',move_count:ctx.move_count,last_move_player_index:lastActor,
  players,my_player_index:seat(),acting_for_player_index:seat(),turn_of_player_index:seat(),turn_of_player_indices:[seat()],
  locale:'en',direction:'ltr',strings:game.declarative_ui.strings||{}};
const spec=game.declarative_ui;
const presentation=backgammonMatchPresentation!;
const scene=presentation.presentScene!(ui.reduce(msg,{}).scene,msg as any);
scene.pieces=scene.pieces?.filter(piece=>piece.id!=='help');
const bounds=contentBounds(spec,scene,spec.boards.filter(presentation.visibleBoard));
const at=(item:Piece|Target)=>{const {x,y}=position(spec,item);return {x,y};};
// Use one die, and prefer a long cross-board drag with a visible checker at both ends.
const choices=state.legalMoves.flatMap((move:{from:number;to:number})=>{
  const label='Player '+(seat()+1)+': Point '+(move.from+1);
  const piece=scene.pieces?.find(piece=>piece.aria_label===label&&piece.move_targets?.includes('to_'+move.to));
  const target=scene.targets?.find(target=>target.id==='to_'+move.to);
  if(!piece||!target)return [];
  const source=at(piece),destination=at(target);
  return [{source,destination,move,checker:label+': Move',target:'Point '+(move.to+1),height:spec.piece_types[piece.type].height,
    distance:Math.hypot(source.x-destination.x,source.y-destination.y)}];
});
const chosen=choices.sort((a:any,b:any)=>b.distance-a.distance)[0];
if(!chosen)throw Error('No visible checker for legal opening move');
const after=rules.applyMove(structuredClone(current.state),current.turn[0],{action:'move',from:chosen.move.from,to:chosen.move.to},ctx);
const id='local-benchmark-backgammon';
const match={id,game_id:game.id,game_version:game.version,owner_user_id:'visitor',players,status:'ongoing',end_reason:null,
  match_kind:'pass_and_play',state,logicState:current.state,turn_of_player_indices:[seat()],move_count:ctx.move_count,
  last_move_player_index:lastActor,created_at:date,localMode:'pass',practiceSeed:420,moves,initialState,initialTurn,
  awaitingHandoff:false,token_pot:0,bet_per_player:0};
const key='buildplay.shared.v1.visitor';
const data={version:1,responses:{['/games/'+game.id+'/versions/'+game.version]:game},queues:{},conflicts:{},local:{[id]:match},
  archives:[],archivedMatches:[],selectedId:id};
mkdirSync(output,{recursive:true});
const filename=createHash('sha256').update(key).digest('hex')+'.json';
writeFileSync(path.join(output,filename),JSON.stringify({key,value:JSON.stringify(data)}));
writeFileSync(path.join(output,'pose.json'),JSON.stringify({...chosen,bounds,id,filename,moveCount:ctx.move_count,
  expectedCounts:after.state.cnt,expectedOwners:after.state.owner},null,2));
