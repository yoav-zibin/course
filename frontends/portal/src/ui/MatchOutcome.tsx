import React from 'react';
import {matchOutcome} from '../core/results';
import type {Match} from '../core/types';
import {Copy,colors} from './components';
import {text,useApp} from './context';

export function MatchOutcome({match}:{match:Match}) {
  const {p}=useApp();
  // A shared local device names the winner. A computer practice has one human
  // viewer even when that player is using the app without an account.
  const viewer=match.localMode==='pass'?null:p.account?.id||(match.localMode==='computer'?match.players[0]?.user_id:null);
  const outcome=matchOutcome(match,viewer);if(!outcome)return null;
  const labels={win:['ui.match.you_won','You won'],loss:['ui.match.you_lost','You lost'],draw:['ui.match.draw','Draw'],early:['ui.match.ended_early','Ended early'],unknown:['ui.match.result_unavailable','Result unavailable'],finished:['status.over','Finished'],winner:['ui.match.won','{name} won']} as const;
  const [key,fallback]=labels[outcome.kind],player=match.players.find(seat=>seat.player_index===outcome.winner);
  const name=player?.name||(player?.user_id?p.profiles[player.user_id]?.display_name:null)||text(p,'ui.match.player_n','Player {number}',{number:(outcome.winner??0)+1});
  let label=text(p,key,fallback,{name});
  if(match.pending||match.conflict)label+=' · '+text(p,'ui.match.awaiting_sync','awaiting sync');
  return <Copy testID="match-outcome" style={{fontWeight:'700',color:outcome.kind==='win'?colors.accent:outcome.kind==='loss'?colors.error:outcome.kind==='draw'?colors.purple:colors.muted}}>{label}</Copy>;
}
