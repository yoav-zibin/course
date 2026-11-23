"""Apply portable artwork/layout to Jiayi's ten packages without changing rules."""
import json
import base64
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
KINDS=('nim_single_heap','conquian','big_two','catch_the_ten','court_piece','sergeant_major','pedro','mille_bornes','snap','slapjack')

def svg(body,w=480,h=700):
 return {'media_type':'image/svg+xml','width':w,'height':h,'uri':'data:image/svg+xml;base64,'+base64.b64encode(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{body}</svg>'.encode()).decode()}

BACKGROUND='''<defs><linearGradient id="bg" x2=".8" y2="1"><stop stop-color="#173f40"/><stop offset="1" stop-color="#091f29"/></linearGradient><radialGradient id="felt"><stop stop-color="#28635b"/><stop offset="1" stop-color="#17443f"/></radialGradient></defs><rect width="480" height="700" rx="26" fill="url(#bg)"/><rect x="10" y="10" width="460" height="680" rx="20" fill="none" stroke="#b9d5c0" stroke-opacity=".14"/><path d="M26 67H454" stroke="#d9c290" stroke-opacity=".28"/><ellipse cx="240" cy="300" rx="214" ry="115" fill="#061d22" opacity=".4"/><ellipse cx="240" cy="289" rx="211" ry="112" fill="url(#felt)" stroke="#b7b48a" stroke-width="2"/><ellipse cx="240" cy="289" rx="199" ry="101" fill="#205149" fill-opacity=".12" stroke="#c9d9b9" stroke-opacity=".15"/><rect x="20" y="442" width="440" height="231" rx="18" fill="#061b24" fill-opacity=".56" stroke="#b0ccc0" stroke-opacity=".12"/><path d="M40 474H440" stroke="#a5c5ba" stroke-opacity=".16"/><path d="M219 369l21-12 21 12-21 12z" fill="none" stroke="#d4c08b" stroke-opacity=".35"/></svg>'''.replace('</svg>','')

def mille_card(n):
 label=['25','50','75','100','200','FUEL','TIRE','FIX','STOP','LIMIT','FUEL','TIRE','FIX','GO','END','SAFE','SAFE','SAFE','SAFE'][n]
 color='#28675c' if n<5 or n>=13 else '#ae4b43'
 pip='<path d="M-18-4H5L-3-12 3-18 23 0 3 18-3 12 5 4H-18z"/>'
 corner=f'<text x="12" y="29" font-size="{16 if len(label)>3 else 23}" font-weight="bold">{label}</text><g transform="translate(19 43) scale(.27)">{pip}</g>'
 body=f'''<rect x="3" y="5" width="94" height="136" rx="11" fill="#031b24" opacity=".22"/><rect x="1" y="1" width="94" height="134" rx="10" fill="#fffcf3" stroke="#d5d9cb"/><rect x="6" y="6" width="84" height="124" rx="7" fill="none" stroke="{color}" stroke-opacity=".12"/><g fill="{color}" font-family="Georgia,serif">{corner}<g transform="translate(48 74) scale(1.1)">{pip}</g><g transform="translate(96 136) rotate(180)">{corner}</g></g>'''
 return svg(body,100,144)

WRAPPER=r'''
// JIAYI_POLISH_BEGIN
const gameUI = {
 reduce(message, previous) {
  const result=baseGameUI.reduce(message,previous), m=message.type==='ui_event'?message.state_changed:message;
  const v=m.view||m.state||{}, old=result.scene, strings={...SOURCE_STRINGS,...m.strings};
  const kind=POLISH_KIND, nim=kind==='nim_single_heap', snap=kind==='snap'||kind==='slapjack';
  const scene={pieces:[],labels:[],controls:old.controls||[],targets:old.targets||[],paths:old.paths||[]};
  const add=(id,type,x,y,extra={})=>scene.pieces.push({id,type,board:'surface',position:{x,y},actions:[],...extra});
  const label=(id,text,x,y,size=17,color='#f4f2dd')=>scene.labels.push({id,text:String(text),x,y,font_size:size,color});
  const text=k=>strings[k]||POLISH_STRINGS[k]||'';
  add('polish_background','table_art',240,350,{z:-100});
  label('polish_title',strings.title||POLISH_TITLE,26,22,28);
  const status=(old.labels||[]).find(l=>l.id==='status'||l.id==='turn');
  const playing=m.turn_of_player_indices||[v.seat];
  const players=m.players||[],counts=v.counts||[],scores=v.totals||v.miles||v.scores;
  players.forEach((p,i)=>{
   const x=26+(i%3)*147,y=86+Math.floor(i/3)*51;
   add('polish_seat_'+i,playing.includes(i)&&m.status==='ongoing'?'seat_active':'seat_idle',x+67,y+21,{z:-10});
   label('polish_name_'+i,String(p.name||p.display_name||i+1).slice(0,13),x+11,y+7,14,playing.includes(i)?'#f8e3a7':'#d0dfd7');
   const amount=scores?.[i]??counts[i];
   label('polish_score_'+i,amount===undefined?'—':String(amount),x+11,y+25,15,'#ffffff');
  });
  label('polish_status',status?.text||text(m.status==='over'?'polish_finished':'polish_table'),27,407,17,'#e5d5a7');
  const hand=v.hand||[];
  const face = c => kind === 'mille_bornes' ? {asset:'card_'+c} :
    {text:['2','3','4','5','6','7','8','9','10','J','Q','K','A'][c%13]+['♣','♦','♥','♠'][Math.floor(c/13)]};
  if(!nim&&!snap)label('polish_hand_title',text('polish_hand'),37,452,15,'#a8c9bb');
  if(nim){
   label('polish_stones',String(v.n),208,187,48,'#f3e2b9');
   (old.pieces||[]).forEach((p,i)=>add(p.id,'gem',160+(i%3)*80,265+Math.floor(i/3)*45,{...p,type:'gem',board:'surface',position:{x:160+(i%3)*80,y:265+Math.floor(i/3)*45}}));
   const controls=old.controls||[];scene.controls=[];
   controls.forEach((c,i)=>{
    const x=98+(i%3)*142,y=508+Math.floor(i/3)*65;
    add(c.id,'take_button',x,y,{actions:['tap'],aria_label:c.label,text:c.label});
   });
  }else if(snap){
   const top=kind==='snap'?(v.top||[]):v.top===null||v.top===undefined?[]:[v.top];
   const latest=top[top.length-1];
   if(top.length>1)add('polish_previous','large_card',168,286,{...face(top[0]),rotation:-5});
   add('polish_deck','pile',top.length>1?306:240,286,{
     ...(latest===undefined?{}:face(latest)),count:v.pileCount,rotation:top.length>1?5:0});
   scene.controls=[];
   (old.controls||[]).forEach((c,i)=>add(c.id,i?'gold_button':'primary_button',240,510+i*86,{actions:['tap'],aria_label:c.label,text:c.label}));
  }else{
   (old.pieces||[]).forEach((p,i)=>{
    const card=hand[i],columns=hand.length>14?9:7;
    scene.pieces.push({...p,type:'hand_card',board:'surface',
      position:{x:240,y:529-(p.selected?12:0)},text:'',...face(card),
      hand:{index:i,count:hand.length,columns,spacing:columns===9?47:60,row_spacing:103},
      aria_label:p.aria_label||p.text||String(card),z:20+i,rotation:0,opacity:p.actions?.length||p.selected?1:.78});
   });
   const table=v.table||v.trick?.map(p=>p.card)||((kind==='conquian'&&v.top>=0)?[v.top]:[]);
   const shown=kind==='catch_the_ten'?[v.up,...table].filter(c=>Number.isInteger(c)):table;
   shown.slice(-5).forEach((c,i)=>add('polish_table_'+i,'table_card',240-(Math.min(shown.length,5)-1)*38+i*76,282,{...face(c),rotation:(i-(shown.length-1)/2)*4,z:i,animation:{kind:'move',duration_ms:180,key:'trick_'+m.move_count+'_'+i}}));
   if(!shown.length)add('polish_deck','pile',240,282,{count:0,opacity:.8});
   if(Number.isInteger(v.trump)&&v.trump>=0)label('polish_trump',['♣','♦','♥','♠'][v.trump],409,204,27,'#e4c480');
  }
  if(m.status==='over'){
   add('polish_result_panel','result_panel',240,281,{z:70});
   label('polish_result',String(status?.text||text('polish_finished')).slice(0,44),55,272,24,'#f6e3ac');
  }
  result.scene=scene;return result;
 }
};
'''
LANGS={'en':['YOUR HAND','TABLE','ROUND COMPLETE'],'es':['TU MANO','MESA','RONDA TERMINADA'],'fr':['VOTRE MAIN','TABLE','MANCHE TERMINÉE'],'de':['DEINE HAND','TISCH','RUNDE BEENDET'],'pt':['SUA MÃO','MESA','RODADA CONCLUÍDA'],'zh':['你的手牌','牌桌','本局结束'],'hi':['आपके पत्ते','मेज़','दौर समाप्त'],'ar':['أوراقك','الطاولة','انتهت الجولة']}

def build():
 for kind in KINDS:
  path=ROOT/'games/declarative'/f'{kind}.json';a=json.loads(path.read_text());spec=a['declarative_ui'];code=spec['ui_code']
  if kind=='nim_single_heap' and 'piles' in a['unit_tests']['state_schema']['properties']:continue
  if '// JIAYI_POLISH_BEGIN' in code:code=code.split('// JIAYI_POLISH_BEGIN')[0].rstrip()
  code=code.replace('const gameUI =','const baseGameUI =').replace('const gameUI=','const baseGameUI=')
  # Remove earlier decoration constants when regenerating.
  if '\nconst POLISH_KIND=' in code:code=code.split('\nconst POLISH_KIND=')[0]
  strings=dict(zip(['polish_hand','polish_table','polish_finished'],LANGS['en']))
  spec['ui_code']=code+'\nconst POLISH_KIND='+json.dumps(kind)+';\nconst POLISH_TITLE='+json.dumps(a['name'])+';\nconst POLISH_STRINGS='+json.dumps(strings)+';\n'+WRAPPER
  spec['strings'].update(strings)
  for locale,t in a.get('translations',{}).items():t['client_strings'].update(dict(zip(strings,LANGS.get(locale,LANGS['en']))))
  spec['motion']={'move_ms':180,'easing':'ease-out'}
  spec['viewport']={'width':480,'height':700,'camera_enabled':False}
  spec['boards']=[{'id':'surface','kind':'free','x':0,'y':0,'width':480,'height':700,'color':'#0c2630','line_color':'#0c2630'}]
  assets={'table_art':svg(BACKGROUND)}
  if kind=='mille_bornes':
   for n in range(19):assets['card_'+str(n)]=mille_card(n)
  for key,color,border in [('seat_active','#345d50','#d8bd77'),('seat_idle','#13363b','#335456'),('primary_button','#317562','#74b695'),('gold_button','#d7bc77','#f4dea4'),('take_button','#315954','#78b5a0'),('result_panel','#173e3e','#c9b16d')]:
   w,h=(134,44) if key.startswith('seat') else (130,52) if key=='take_button' else (370,115) if key=='result_panel' else (340,66)
   assets[key]=svg(f'<rect x="1" y="4" width="{w-2}" height="{h-5}" rx="13" fill="#04191e" opacity=".28"/><rect x="1" y="1" width="{w-2}" height="{h-5}" rx="13" fill="{color}" stroke="{border}" stroke-opacity=".8"/>',w,h)
  assets['gem']=svg('<defs><radialGradient id="g" cx=".3" cy=".2"><stop stop-color="#e4ffdf"/><stop offset=".45" stop-color="#a8e0bc"/><stop offset="1" stop-color="#3c887c"/></radialGradient></defs><ellipse cx="35" cy="43" rx="27" ry="10" fill="#031f28" opacity=".28"/><ellipse cx="34" cy="29" rx="27" ry="24" fill="url(#g)" stroke="#e5ffd9" stroke-opacity=".7"/><ellipse cx="25" cy="17" rx="11" ry="5" fill="#fff" opacity=".5"/>',70,58)
  spec['assets']=assets
  spec['piece_types']={}
  for key,w,h in [('table_art',480,700),('seat_active',134,44),('seat_idle',134,44),('primary_button',340,66),('gold_button',340,66),('take_button',130,52),('result_panel',370,115),('gem',65,54)]:
   spec['piece_types'][key]={'shape':'image','asset':key,'width':w,'height':h,'text_color':'#163d3c' if key=='gold_button' else '#fffbec','font_size':20,'action_outline':'none'}
  for key,w,h in [('hand_card',57,83),('table_card',75,108),('large_card',100,144)]:spec['piece_types'][key]={'shape':'card','width':w,'height':h}
  spec['piece_types']['pile']={'shape':'card_pile','width':75,'height':108}
  path.write_text(json.dumps(a,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':build()
