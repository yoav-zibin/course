import React from 'react';
import {View} from 'react-native';
import type {Game} from '../core/types';
import {Copy} from './components';

export function GameInstructions({game,summaryFirst=false}:{game:Game;summaryFirst?:boolean}) {
  const rules=typeof game.game_logic_rules==='string'?game.game_logic_rules:'',ui=typeof game.game_ui_rules==='string'?game.game_ui_rules:'',tutorial=typeof game.tutorial_text==='string'?game.tutorial_text:'';
  const blocks=[...new Set([rules,ui].filter(value=>value.trim()))];
  const equivalent=[...blocks,blocks.join('\n\n'),blocks.join('\n')].map(value=>value.trim());
  if(tutorial.trim()&&!equivalent.includes(tutorial.trim())) {
    if(summaryFirst) blocks.unshift(tutorial);
    else blocks.push(tutorial);
  }
  return <View testID="game-instructions" style={{gap:16,minWidth:0}}>{blocks.map((value,index)=><Copy key={index} selectable>{value}</Copy>)}</View>;
}
