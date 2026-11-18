import type {Match} from './types';

export type Outcome = {kind:'win'|'loss'|'draw'|'winner'|'early'|'unknown'|'finished';winner?:number};

// Lists carry the raw server result; detail/local records carry a public view.
// Never infer a winner from balances, player IDs or the fact that a match ended.
export function matchOutcome(match:Match,viewer?:string|null):Outcome|null {
  if(match.status!=='over')return null;
  if(match.end_reason&&match.end_reason!=='finished')return {kind:'early'};
  const result=match.result??match.state;
  if(result&&typeof result==='object'&&!Array.isArray(result)){
    const winner=result.winner;
    if(Number.isInteger(winner)&&match.players.some(player=>player.player_index===winner)){
      const seat=viewer?match.players.find(player=>player.user_id===viewer):null;
      return seat?{kind:seat.player_index===winner?'win':'loss',winner}:{kind:'winner',winner};
    }
    if(winner===-1||winner===null&&(result.draw===true||result.done===true))return {kind:'draw'};
  }
  if(match.end_reason==='finished'&&match.players.length===1&&match.players[0].kind==='human')return {kind:'finished'};
  return {kind:'unknown'};
}
