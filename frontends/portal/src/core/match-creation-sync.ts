import {ApiError, type PortalApi} from './api';
import {type AccountRepository, equal} from './repository';
import type {Account, Match} from './types';
import {isUnsupportedCreationFields, RetryableSyncCompatibilityError} from './sync-compatibility';

export async function syncMatchCreations(api:PortalApi,repository:AccountRepository,account:Account,
  options:{guard():void;matchId?:string}):Promise<void> {
  const data=await repository.read(account.id);options.guard();
  for(const [id,creation] of Object.entries(data.creations || {})) {
    if(options.matchId && options.matchId!==id)continue;
    const conflict=data.conflicts[id];
    if(conflict) {
      if(conflict.remote || creation.compatibility_retried || creation.body?.client_match_id!==id
        || creation.body?.match_kind!=='multiplayer' || !creation.requestId
        || conflict.message!=='This lobby could not be saved: Unprocessable Entity. Its creation is preserved on this device.')continue;
      const recovered=await repository.mutate(account.id,current=>{
        options.guard();const saved=current.creations?.[id];
        if(saved?.requestId===creation.requestId && !saved.compatibility_retried && equal(current.conflicts[id],conflict)) {
          saved.compatibility_retried=true;delete current.conflicts[id];return true;
        }
        return false;
      });
      if(!recovered)continue;
    }
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
      if(isUnsupportedCreationFields(error))throw new RetryableSyncCompatibilityError(error);
      await repository.mutate(account.id,current=>{options.guard();current.conflicts[id]={message:`This lobby could not be saved: ${error.message}. Its creation is preserved on this device.`};});
    }
  }
}
