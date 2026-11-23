import React from 'react';
import {Circle, Polygon, Rect, Text as SvgText} from 'react-native-svg';
import {playerText} from '../platform/i18n';
import type {Piece, PieceType} from './types';
import G from './SceneGroup';

const paper='#fffaf0', ink='#193646', red='#b33e49', teal='#205962', gold='#e9cd86';
const pips:Record<number,number[][]>={
  0:[],1:[[0,0]],2:[[-1,-1],[1,1]],3:[[-1,-1],[0,0],[1,1]],
  4:[[-1,-1],[1,-1],[-1,1],[1,1]],5:[[-1,-1],[1,-1],[0,0],[-1,1],[1,1]],
  6:[[-1,-1],[1,-1],[-1,0],[1,0],[-1,1],[1,1]],
};

// Cap artwork complexity independently of the number of cards in the rules.
function pileLayers(count:number) {
  if (count<=1) return count;
  return Math.min(7,2+Math.floor(Math.log2(count/2)));
}

export function TabletopGraphic({piece,type,width:w,height:h,artwork}:{piece:Piece;type:PieceType;width:number;height:number;artwork?:React.ReactNode}) {
  const x=-w/2,y=-h/2,unit=Math.min(w,h),radius=unit*.1;
  if (piece.face!=='back' && type.shape==='dice') {
    const face=piece.die_value ?? Number(piece.text);
    const custom=Boolean(artwork && piece.die_value===undefined);
    return <G>
      <Rect x={x} y={y} width={w} height={h} rx={unit*.18} fill={type.color??paper} stroke={type.border_color??ink} strokeWidth={unit*.04}/>
      <Rect x={x+w*.065} y={y+h*.065} width={w*.87} height={h*.87} rx={unit*.14} fill="none" stroke="#ddd6c2"/>
      {artwork}
      {!custom && pips[face]?.map(([dx,dy],i)=><Circle key={i} cx={dx*w*.255} cy={dy*h*.255} r={unit*(face===1?.13:.077)} fill={type.text_color??(face===1?red:ink)}/>)}
      {(custom || !pips[face]) && !!piece.text && <SvgText textAnchor="middle" alignmentBaseline="central" fontSize={type.font_size??unit*.4} fill={type.text_color??ink}>{playerText(piece.text)}</SvgText>}
    </G>;
  }
  if (piece.face!=='back' && type.shape==='counter') return <G>
    <Rect x={x} y={y} width={w} height={h} rx={unit*.28} fill={type.color??teal} stroke={type.border_color??gold} strokeWidth={unit*.045}/>
    {artwork}
    <SvgText textAnchor="middle" alignmentBaseline="central" fontSize={type.font_size??unit*.52} fontWeight="700" fill={type.text_color??paper}>{playerText(piece.text??String(piece.count??0))}</SvgText>
  </G>;
  const pile=type.shape==='card_pile', count=pile?piece.count!:1;
  if (count===0) return <Rect x={x} y={y} width={w} height={h} rx={radius} fill="none" stroke="#81a79e" strokeWidth={unit*.027} strokeDasharray={`${unit*.08} ${unit*.05}`}/>;
  const layers=pileLayers(count),inset=unit*.024;
  const depth=(layers-1)*inset, fw=w-depth,fh=h-depth;
  const back=piece.face==='back'||(pile && !piece.text && !artwork);
  const value=piece.text??'', match=/^(10|[2-9AJQK])\s*([♣♦♥♠])$/u.exec(value);
  const color=match?('♦♥'.includes(match[2])?red:ink):type.text_color??ink;
  return <G>
    {Array.from({length:layers-1},(_,i)=><Rect key={i} x={x+depth-i*inset} y={y+depth-i*inset} width={fw} height={fh} rx={radius} fill={i%2?'#c2c9bd':'#e4dfce'} stroke="#697f7e" strokeWidth={inset*.65}/>)}
    <Rect x={x} y={y} width={fw} height={fh} rx={radius} fill={back?paper:type.color??paper} stroke={type.border_color??'#98a99e'} strokeWidth={unit*.025}/>
    {artwork && <G transform={`translate(${-depth/2} ${-depth/2}) scale(${fw/w} ${fh/h})`}>{artwork}</G>}
    {back && !artwork ? <G>
      <Rect x={x+fw*.05} y={y+fh*.04} width={fw*.90} height={fh*.92} rx={radius*.7} fill={teal}/>
      <Rect x={x+fw*.10} y={y+fh*.09} width={fw*.80} height={fh*.82} rx={radius*.4} fill="none" stroke={gold} strokeWidth={unit*.014}/>
      <Polygon points={`${x+fw*.5},${y+fh*.23} ${x+fw*.79},${y+fh*.5} ${x+fw*.5},${y+fh*.77} ${x+fw*.21},${y+fh*.5}`} fill="none" stroke={gold} strokeWidth={unit*.032}/>
    </G> : back ? null : match ? <G fill={color}>
      <SvgText x={x+fw*.08} y={y+fh*.22} fontWeight="700" fontSize={Math.min(fh*.23,fw*.31)}>{match[1]}</SvgText>
      <SvgText x={x+fw*.5} y={y+fh*.53} textAnchor="middle" alignmentBaseline="central" fontSize={Math.min(fh*.46,fw*.7)}>{match[2]}</SvgText>
      <SvgText x={x+fw*.92} y={y+fh*.90} textAnchor="end" fontWeight="700" fontSize={Math.min(fh*.20,fw*.27)}>{match[1]}</SvgText>
    </G> : !!value && <SvgText textAnchor="middle" alignmentBaseline="central" fill={color} fontSize={type.font_size??Math.min(h*.36,w/(Math.max(1,value.length)*.6))} fontWeight="700">{playerText(value)}</SvgText>}
    {pile && <G>
      <Rect x={w*.04} y={h*.22} width={w*.42} height={h*.24} rx={unit*.05} fill={ink}/>
      <SvgText x={w*.25} y={h*.34} textAnchor="middle" alignmentBaseline="central" fontSize={Math.min(h*.17,w*.57/String(count).length)} fill={paper} fontWeight="700">{String(count)}</SvgText>
    </G>}
  </G>;
}
