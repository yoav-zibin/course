import {AccountScopeChangedError} from '../core/account-scope';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {usePortal} from '../core';
import {copyText} from '../platform/i18n';
import {reportClientIssue} from '../core/reporting';

export type MatchHistoryControls={
  atStart:boolean;atEnd:boolean;playing:boolean;disabled:boolean;
  onStart:()=>void;onPrevious:()=>void;onPlayPause:()=>void;onNext:()=>void;onEnd:()=>void;
  position:number;total:number;
};

type HistorySnapshot={
  scope:string;total:number;replayIndex:number|null;ready:boolean;
  replay:(index:number|null)=>Promise<number|void>;
};
type HistoryOptions={
  snapshot:()=>HistorySnapshot;onChange:()=>void;onError?:(error:Error)=>void;
  wait?:(milliseconds:number)=>Promise<void>;now?:()=>number;
};

/** Owns the asynchronous playback lifetime independently of the menu or board. */
export function createMatchHistoryController(options:HistoryOptions){
  let scope=options.snapshot().scope,epoch=0,request=0,pending=false,playing=false;
  let painted:number|null=null,motion=false,disposed=false,error:string|null=null,minimum=0;
  const wait=options.wait??(milliseconds=>new Promise<void>(resolve=>setTimeout(resolve,milliseconds)));
  const now=options.now??Date.now;
  const changed=()=>{if(!disposed)options.onChange();};
  const valid=(expectedScope:string,token:number)=>!disposed&&scope===expectedScope&&options.snapshot().scope===expectedScope&&epoch===token;
  const synchronize=()=>{
    const next=options.snapshot().scope;
    if(scope===next)return;
    scope=next;epoch++;request++;pending=false;playing=false;painted=null;motion=false;error=null;minimum=0;
  };
  const state=()=>{
    synchronize();
    const current=options.snapshot(),total=Math.max(0,current.total),position=Math.max(0,Math.min(total,current.replayIndex??total));
    return {atStart:position<=minimum,atEnd:position===total,playing,disabled:!current.ready||pending||total<=minimum,position,total};
  };
  const stopPlayback=()=>{epoch++;if(playing){playing=false;changed();}};
  const recordError=(reason:unknown,expectedScope:string)=>{
    if(reason instanceof AccountScopeChangedError||disposed||scope!==expectedScope||options.snapshot().scope!==expectedScope)return;
    const failure=reason instanceof Error?reason:new Error(String(reason));
    error=failure.message;options.onError?.(failure);changed();
  };
  async function show(index:number|null,expectedScope:string,token:number){
    if(!valid(expectedScope,token)||pending||!options.snapshot().ready)return null;
    const id=++request;pending=true;error=null;changed();
    try{
      const result=await options.snapshot().replay(index);
      // A numeric request returning undefined was superseded inside the store.
      if(!valid(expectedScope,token)||index!==null&&result===undefined)return null;
      if(index===0&&typeof result==='number'&&result>0)minimum=result;
      return {index:index===null?null:result as number};
    }finally{if(request===id){pending=false;changed();}}
  }
  async function seek(target:'start'|'previous'|'next'|'end'){
    const current=state();if(current.disabled)return;
    if((target==='start'||target==='previous')&&current.atStart)return;
    if((target==='end'||target==='next')&&current.atEnd)return;
    stopPlayback();const expectedScope=scope,token=epoch;
    const index=target==='start'?minimum:target==='previous'?Math.max(minimum,current.position-1):target==='end'||current.position+1>=current.total?null:current.position+1;
    try{
      const shown=await show(index,expectedScope,token);
      // Some older histories have no playable initial frame and promote zero
      // to move one. That frame may already be the latest position.
      if(shown&&shown.index!==null&&shown.index>=options.snapshot().total)await show(null,expectedScope,token);
    }catch(reason){recordError(reason,expectedScope);}
  }
  async function playPause(){
    synchronize();if(playing){stopPlayback();return;}
    const current=state();if(current.disabled)return;
    const expectedScope=scope,token=++epoch,end=current.total;
    const active=()=>valid(expectedScope,token)&&options.snapshot().ready;
    let index=current.atEnd?minimum:Math.max(minimum,current.position);
    playing=true;error=null;changed();
    try{
      const first=await show(index,expectedScope,token);if(!first)return;
      index=first.index!;
      while(active()){
        const until=now()+15000;
        while(active()&&(painted!==index||motion)){
          if(now()>until)throw new Error(copyText('The history frame could not finish rendering. Try stepping through it manually.'));
          await wait(40);
        }
        if(!active())return;
        // Leave the settled board visible before starting the next move.
        await wait(420);if(!active())return;
        if(index>=end||index>=options.snapshot().total){await show(null,expectedScope,token);return;}
        const next=await show(index+1,expectedScope,token);if(!next)return;
        if(next.index===null||next.index<=index)return;
        index=next.index;
      }
    }catch(reason){if(valid(expectedScope,token))recordError(reason,expectedScope);}
    finally{if(valid(expectedScope,token)){playing=false;changed();}}
  }
  return {
    state,error:()=>error,stopPlayback,seek,playPause,
    onAnimationStateChange:(expectedScope:string,busy:boolean)=>{if(!disposed&&scope===expectedScope&&options.snapshot().scope===expectedScope)motion=busy;},
    onScene:(expectedScope:string,_scene:unknown,applied:any)=>{if(!disposed&&scope===expectedScope&&options.snapshot().scope===expectedScope)painted=applied.replay?.index??null;},
    mount:()=>{disposed=false;synchronize();},
    dispose:()=>{disposed=true;epoch++;request++;pending=false;playing=false;},
  };
}

export function useMatchHistory(p:ReturnType<typeof usePortal>){
  const [,render]=useState(0),match=p.selectedMatch;
  const scope=JSON.stringify([p.baseUrl,p.account?.id,match?.id,p.locale]);
  const snapshot=useRef<HistorySnapshot>(null!);
  snapshot.current={scope,total:match?.move_count??0,replayIndex:p.replayIndex,
    ready:Boolean(p.ready&&match&&match.status!=='waiting_for_players'&&!match.awaitingHandoff&&p.game?.declarative_ui),
    replay:p.actions.replay};
  const controller=useRef<ReturnType<typeof createMatchHistoryController>>(null!);
  if(!controller.current)controller.current=createMatchHistoryController({snapshot:()=>snapshot.current,onChange:()=>render(value=>value+1),onError:reason=>reportClientIssue('game_error',reason)});
  const history=controller.current,current=history.state();
  useEffect(()=>{history.mount();return()=>history.dispose();},[history]);
  const onAnimationStateChange=useCallback((busy:boolean)=>history.onAnimationStateChange(scope,busy),[history,scope]);
  const onScene=useCallback((_scene:unknown,applied:any)=>history.onScene(scope,_scene,applied),[history,scope]);
  const controls:MatchHistoryControls={...current,
    onStart:()=>{void history.seek('start');},onPrevious:()=>{void history.seek('previous');},
    onPlayPause:()=>{void history.playPause();},onNext:()=>{void history.seek('next');},onEnd:()=>{void history.seek('end');}};
  return {controls,onAnimationStateChange,onScene,stopPlayback:history.stopPlayback,error:history.error()};
}
export type MatchHistoryController=ReturnType<typeof useMatchHistory>;
