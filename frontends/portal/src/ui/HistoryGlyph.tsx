import React from 'react';
import Svg,{Path,Rect} from 'react-native-svg';
import {copyText} from '../platform/i18n';
import type {MatchHistoryControls} from './matchHistory';

type HistoryIcon='start'|'previous'|'play'|'pause'|'next'|'end';

export function historyButtons(history:MatchHistoryControls){
  return [
    {kind:'start' as const,id:'history-start',label:copyText('Go to start'),disabled:history.disabled||history.atStart,onPress:history.onStart},
    {kind:'previous' as const,id:'history-previous',label:copyText('Previous move'),disabled:history.disabled||history.atStart,onPress:history.onPrevious},
    {kind:history.playing?'pause' as const:'play' as const,id:'history-play',label:history.playing?copyText('Pause history'):copyText('Play history'),disabled:history.disabled||!history.playing&&history.total===0,onPress:history.onPlayPause},
    {kind:'next' as const,id:'history-next',label:copyText('Next move'),disabled:history.disabled||history.atEnd,onPress:history.onNext},
    {kind:'end' as const,id:'history-end',label:copyText('Go to end'),disabled:history.disabled||history.atEnd,onPress:history.onEnd},
  ];
}

export function HistoryGlyph({kind}:{kind:HistoryIcon}){
  return <Svg width={20} height={20} viewBox="0 0 24 24" fill="#eef0f5" aria-hidden>
    {kind==='start'?<><Path d="M11 5v14l-8-7 8-7Zm9 0v14l-8-7 8-7Z"/><Rect x={1} y={5} width={2} height={14} rx={.7}/></>
      :kind==='previous'?<><Path d="M18 5v14L8 12l10-7Z"/><Rect x={5} y={5} width={2} height={14} rx={.7}/></>
      :kind==='play'?<Path d="m7 4 13 8-13 8V4Z"/>
      :kind==='pause'?<><Rect x={5} y={4} width={5} height={16} rx={1}/><Rect x={14} y={4} width={5} height={16} rx={1}/></>
      :kind==='next'?<><Path d="m6 5 10 7-10 7V5Z"/><Rect x={17} y={5} width={2} height={14} rx={.7}/></>
      :<><Path d="m4 5 8 7-8 7V5Zm9 0 8 7-8 7V5Z"/><Rect x={21} y={5} width={2} height={14} rx={.7}/></>}
  </Svg>;
}
