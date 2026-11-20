import {ApiError, type PortalApi} from './api';
import type {AccountRepository} from './repository';
import type {Account, Match} from './types';

export async function syncMatchCreations(api:PortalApi,repository:AccountRepository,account:Account,
  options:{guard():void;matchId?:string}):Promise<void> {
  const data=await repository.read(account.id);options.guard();
  for(const [id,creation] of Object.entries(data.creations || {})) {
    if(options.matchId && options.matchId!==id || data.conflicts[id])continue;
    try {
      const match=await api.request<Match>('POST','/matches',creation.body,account,creation.requestId);options.guard();
      if(match?.id!==id || match.match_kind!=='multiplayer')throw new Error('Invalid cloud lobby response; the saved creation was kept.');
      await repository.mutate(account.id,current=>{
        options.guard();if(current.creations?.[id]?.requestId!==creation.requestId)return;
        delete current.creations[id];current.responses[`/matches/${id}`]=match;
        if(Array.isArray(current.responses['/matches']))current.responses['/matches']=current.responses['/matches'].map((item:Match)=>item.id===id?match:item);
      });
    }catch(error){
      options.guard();if(!(error instanceof ApiError)||error.status>=500)throw error;
      await repository.mutate(account.id,current=>{options.guard();current.conflicts[id]={message:`This lobby could not be saved: ${error.message}. Its creation is preserved on this device.`};});
    }
  }
}
