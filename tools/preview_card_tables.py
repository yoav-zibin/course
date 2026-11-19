"""Private loopback preview of the ten handoff games with disposable in-memory matches.

Run: PYTHONPATH=/path/to/package/parent python -m game_platform.tools.preview_card_tables
The harness uses the current shared renderer and each package's real server rules.
It has no production configuration, database, publication route or external API.
"""
from pathlib import Path
import argparse,json,secrets,sys,tempfile
from fastapi import FastAPI,HTTPException,Response
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
# Support direct execution even when the checkout directory is not named game_platform.
if __package__ in (None, ''):
    _alias=tempfile.TemporaryDirectory(prefix='card-table-preview-')
    (Path(_alias.name)/'game_platform').symlink_to(Path(__file__).resolve().parents[1],target_is_directory=True)
    sys.path.insert(0,_alias.name)
from game_platform.game_logic import GameLogic
ROOT=Path(__file__).resolve().parents[1]
DIRECTORY=ROOT/'games/declarative/card-table'
KINDS=('six-card-golf','war','crazy-eights','hearts','michigan','quoridor','concentration','casino-war','old-maid','blackjack')
app=FastAPI();sessions={}
app.mount('/static',StaticFiles(directory=ROOT/'static'),name='static')
def payload(kind):
    if kind not in KINDS:raise HTTPException(404,'Unknown game')
    return json.loads((DIRECTORY/(kind+'.json')).read_text())
def message(s):
    ctx={**s['ctx'],'move_count':s['count']}
    view=s['logic'].call('viewFor',s['state'],'p0',ctx=ctx,seed=s['count']+51)
    turns=[i for i,p in enumerate(ctx['players']) if p['id'] in (s['turn'] or [])]
    return {'type':'state_changed','view':view,'state':view,'players':[{'name':p['display_name'],'kind':p['kind'],'player_id':p['id'],'player_index':i} for i,p in enumerate(ctx['players'])],'turn_of_player_indices':turns if s['turn'] is not None else None,'my_player_index':0,'acting_for_player_index':0 if 0 in turns else None,'status':'over' if s['turn'] is None else 'ongoing','move_count':s['count'],'last_move_player_index':s.get('actor'),'strings':s['package']['declarative_ui'].get('strings',{})}
def play(s,player,move):
    result=s['logic'].call('applyMove',s['state'],player,move,ctx={**s['ctx'],'move_count':s['count']},seed=s['count']+71)
    s.update(state=result['state'],turn=result['turn'],count=s['count']+1,actor=next(i for i,p in enumerate(s['ctx']['players']) if p['id']==player))
@app.get('/package/{kind}')
def package(kind:str):return payload(kind)['declarative_ui']
@app.post('/session/{kind}')
def create(kind:str,body:dict):
    p=payload(kind); schemas={k:p['unit_tests'][k+'_schema'] for k in ('state','view','move')}
    logic=GameLogic(p['server_code'],game_schemas=schemas)
    count=int(body.get('players',min(p['allowed_player_counts'])))
    if count not in p['allowed_player_counts']:raise HTTPException(400,'Unsupported player count')
    ctx={'players':[{'id':f'p{i}','kind':'human' if i==0 else 'computer','display_name':'You' if i==0 else f'Computer {i}','active':True,'max_loss':0,'picture_url':''} for i in range(count)],'pot':0,'move_count':0}
    result=logic.call('newMatch',ctx=ctx,seed=int(body.get('seed',19)))
    s={'package':p,'logic':logic,'state':result['state'],'turn':result['turn'],'count':0,'ctx':ctx}
    scenario=body.get('scenario')
    if scenario:
        c=json.loads((DIRECTORY/'review-fixtures/blackjack-split.json').read_text()) if scenario=='split' and kind=='blackjack' else next(c for c in p['unit_tests']['cases'] if c['kind']==scenario)
        # Preserve fixture IDs and allow the fixture mover to be the local viewer.
        ctx={**c['ctx'],'players':[dict(x) for x in c['ctx']['players']]};mover=c['player_id']
        for i,player in enumerate(ctx['players']):
            player['kind']='human' if player['id']==mover or kind=='war' else 'computer';player['display_name']='You' if player['id']==mover else f'Computer {i}'
        s.update(state=c['state'],turn=[mover],count=ctx.get('move_count',0),ctx=ctx)
        # Fixture scenarios put the mover in seat zero by using its original ID as viewer.
        s['viewer']=mover
    token=secrets.token_hex(12);sessions[token]=s
    return {'session':token,'message':scene_message(s),'counts':p['allowed_player_counts']}
def scene_message(s):
    if 'viewer' not in s:return message(s)
    ctx={**s['ctx'],'move_count':s['count']};viewer=s['viewer'];seat=next(i for i,p in enumerate(ctx['players']) if p['id']==viewer)
    v=s['logic'].call('viewFor',s['state'],viewer,ctx=ctx,seed=s['count']+51)
    m=message(s);m.update(view=v,state=v,my_player_index=seat,acting_for_player_index=seat if viewer in (s['turn'] or []) else None)
    return m
@app.post('/move/{token}')
def move(token:str,body:dict):
    s=sessions[token]
    if body.get('expected')!=s['count']:raise HTTPException(409,'Stale move')
    player=s.get('viewer','p0')
    if player not in (s['turn'] or []):raise HTTPException(409,'Not your turn')
    play(s,player,body['move']);return scene_message(s)
@app.post('/computer/{token}')
def computer(token:str):
    s=sessions[token];viewer=s.get('viewer','p0')
    turns=s['turn'] or []
    if turns and viewer not in turns:
        player=turns[0];move=s['logic'].call('computerMove',s['state'],player,ctx={**s['ctx'],'move_count':s['count']},seed=s['count']+61);play(s,player,move)
    return scene_message(s)
@app.get('/favicon.ico')
def favicon():return Response(status_code=204)
@app.get('/',response_class=HTMLResponse)
def index():return HTML
HTML='''<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private game review</title><style>body{margin:0;background:#0b1720;color:#e3eee8;font:16px system-ui}main{max-width:820px;margin:auto;padding:16px}header{display:flex;gap:12px;align-items:center;flex-wrap:wrap}h1{font-size:22px;margin:6px 0}select,button{font:inherit;min-height:44px;background:#193b44;color:#fff;border:1px solid #5b7b7f;border-radius:9px;padding:8px}#board{height:1100px;margin-top:12px}#status{min-height:24px;color:#d9c48f}details{margin-top:12px}pre{white-space:pre-wrap}a{color:#a9dbc9}</style><main><h1>Private game review</h1><p>Local disposable matches · no production connection</p><header><select id="game" aria-label="Game">'''+''.join(f'<option value="{kind}">{payload(kind)["name"]}</option>' for kind in KINDS)+'''</select><select id="scenario" aria-label="Scenario"><option value="">New match</option><option value="intermediate">Special / intermediate</option><option value="terminal">Final move</option><option id="split-option" value="split" hidden disabled>Blackjack · split eights</option></select><button id="restart">Restart</button><label><input id="pause" type="checkbox"> Pause computers</label></header><p id="status" role="status"></p><div id="board"></div><details><summary>Accepted moves</summary><pre id="log"></pre></details></main><script src="/static/declarative-ui.js"></script><script>
let host,session,current,busy=false,serial=0,lastComputerAt=0;const $=id=>document.getElementById(id);const params=new URLSearchParams(location.search);if(params.has('game'))$('game').value=params.get('game');
async function api(path,body={}){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json();}
function show(m){current=m;$('status').textContent=`Move ${m.move_count} · ${m.status==='over'?'Finished':m.acting_for_player_index!==null?'Your turn':'Computer thinking'}`;host.send(m);}
async function start(){const revision=++serial,b=$('game').value;$('split-option').hidden=b!=='blackjack';$('split-option').disabled=b!=='blackjack';if(b!=='blackjack'&&$('scenario').value==='split')$('scenario').value='';history.replaceState(null,'','?game='+b);try{host?.destroy();const spec=await(await fetch('/package/'+b)).json();const r=await api('/session/'+b,{scenario:$('scenario').value,seed:19});if(revision!==serial)return;session=r.session;$('log').textContent='';host=DeclarativeUI.mount($('board'),spec,{onMove:async move=>{if(busy)return;busy=true;try{const m=await api('/move/'+session,{move,expected:current.move_count});$('log').textContent+=JSON.stringify({move,count:m.move_count})+'\\n';show(m);}catch(e){$('status').textContent=e.message;}finally{busy=false;}},onScene:scene=>{window.lastScene=scene;}});show(r.message);}catch(e){$('status').textContent=e.message;}}
setInterval(async()=>{if(!session||busy||$('pause').checked||!current||current.status==='over'||current.acting_for_player_index!==null)return;if($('game').value!=='war'&&Date.now()-lastComputerAt<2400)return;lastComputerAt=Date.now();busy=true;try{show(await api('/computer/'+session));}catch(e){$('status').textContent=e.message;}finally{busy=false;}},1200);
$('game').onchange=start;$('restart').onclick=start;$('scenario').onchange=start;start();</script></html>'''
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--port',type=int,default=8173);args=parser.parse_args()
    uvicorn.run(app,host='127.0.0.1',port=args.port,log_level='warning')
if __name__=='__main__':main()
