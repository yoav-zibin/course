const game={
newMatch(ctx){return{state:{score:0,target:10},turn:[ctx.players[0].id]};},
applyMove(state,playerId,move,ctx){if(state.score>=state.target)throw new InvalidMove('game over');if(!move||move.action!=='tap')throw new InvalidMove('press the button');const ns={score:state.score+1,target:state.target};if(ns.score>=ns.target){const pot=ctx.pot||0;const humans=ctx.players.filter(p=>p.kind==='human');const payouts={};if(humans.length===0){return{state:ns,turn:null,payouts};}for(const h of humans)payouts[h.id]=0;if(payouts.hasOwnProperty(playerId)){payouts[playerId]=pot;}else{const base=Math.floor(pot/humans.length);let rem=pot-base*humans.length;for(const h of humans){payouts[h.id]=base+(rem>0?1:0);if(rem>0)rem--;}}return{state:ns,turn:null,payouts};}return{state:ns,turn:[playerId]};},
computerMove(state,playerId,ctx){return{action:'tap'};},
randomMove(state,playerId,ctx){return{action:'tap'};},
viewFor(state,playerId,ctx){return{score:state.score,target:state.target};}
};