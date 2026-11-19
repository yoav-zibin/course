"""Independent score/settlement oracles for the ten local editions."""
import copy,json,math
from pathlib import Path
import pytest
from game_platform.game_logic import GameLogic
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.tests.test_polished_card_tables import package,inputs

def logic(kind):
 p=package(kind)
 return GameLogic(p['server_code'],game_schemas={k:p['unit_tests'][k+'_schema'] for k in ('state','move','view')},isolate_calls=False)
def ctx(n=2,seed=19):return {'players':[{'id':f'p{seed}-{i}','kind':'human','display_name':f'Player {i+1}','active':True,'max_loss':0,'picture_url':''} for i in range(n)],'pot':37,'move_count':0}
def apply(l,s,m,c,seat=0):return l.call('applyMove',copy.deepcopy(s),c['players'][seat]['id'],m,ctx=c,seed=31)
def val(cards):
 total=sum(11 if c['r']==1 else min(c['r'],10) for c in cards)
 for _ in range(sum(c['r']==1 for c in cards)):
  if total>21:total-=10
 return total
def golf_score(hand):
 value=lambda r:1 if r==1 else r if 2<=r<=10 else 10 if r==12 else 0
 return sum(0 if hand[i]['r']==hand[i+3]['r'] else value(hand[i]['r'])+value(hand[i+3]['r']) for i in range(3))
def bjstate(player,dealer,chips=990,bet=10,deck=None):
 s=copy.deepcopy(package('blackjack')['unit_tests']['cases'][0]['state'])
 s.update(phase='play',chips=[chips,1000],dealer=dealer,hands=[[{'cards':player,'bet':bet,'stood':False,'done':False}],[]],curP=0,curH=0,deck=deck or [],results=['',''])
 return s
def cards(*ranks):return [{'r':r,'s':('C','D','H','S')[i%4]} for i,r in enumerate(ranks)]

@pytest.mark.parametrize('hand,dealer,expected',[
 ([10,9],[10,8],1010),([10,8],[10,9],990),([10,8],[10,8],1000),
 ([1,13],[10,9],1015),([1,13],[1,12],1000),([10,10],[1,12],990),
 ([10,10,2],[10,10,3],990),([1,1,9],[10,10],1010),([1,1,9,10],[10,10],1010),
])
def test_blackjack_hand_results_and_bankroll(hand,dealer,expected):
 l=logic('blackjack');c=ctx();s=bjstate(cards(*hand),cards(*dealer));out=apply(l,s,{'kind':'stand'},c)['state']
 assert out['chips'][0]==expected
 assert out['phase']=='roundOver'
 _,ui,m,_=inputs('blackjack');m['view']=l.call('viewFor',out,c['players'][0]['id'],ctx=c,seed=1)
 label=next(x for x in ui.reduce(m)['scene']['labels'] if x['id']=='hand-value')
 assert label['text'].startswith('Value '+str(val(cards(*hand))))
def test_blackjack_dealer_stands_on_soft_17_and_double_is_one_card():
 l=logic('blackjack');c=ctx();s=bjstate(cards(10,8),cards(1,6),deck=cards(9));out=apply(l,s,{'kind':'stand'},c)['state'];assert len(out['dealer'])==2 and out['chips'][0]==1010
 s=bjstate(cards(5,5),cards(10,9),deck=cards(10));out=apply(l,s,{'kind':'double'},c)['state'];assert out['hands'][0][0]['bet']==20 and len(out['hands'][0][0]['cards'])==3 and out['chips'][0]==1020

def test_blackjack_split_bets_and_split_21_is_not_natural_blackjack():
 l=logic('blackjack');c=ctx();s=bjstate(cards(8,8),cards(10,8),deck=cards(3,2));out=apply(l,s,{'kind':'split'},c)['state'];assert out['chips'][0]==980 and len(out['hands'][0])==2
 out=apply(l,out,{'kind':'stand'},c)['state'];assert out['curH']==1
 out=apply(l,out,{'kind':'stand'},c)['state'];assert out['chips'][0]==980
 s=bjstate(cards(10,6),cards(10,10),chips=980);s['hands'][0][0]['done']=True;s['hands'][0].append({'cards':cards(1,13),'bet':10,'stood':False,'done':False});s['curH']=1
 out=apply(l,s,{'kind':'stand'},c)['state'];assert out['chips'][0]==1000

def test_blackjack_bet_choices_and_foreign_split_index_do_not_change_your_hand():
 _,ui,m,_=inputs('blackjack');v=m['view'];v.update(phase='betting',chips=[80,1000]);scene=ui.reduce(m)['scene'];assert {c['label'] for c in scene['controls']}=={'Bet 10','Bet 25','Bet 50'}
 v.update(phase='play',curP=1,curH=2,hands=[[{'cards':cards(10,9),'bet':10}],[]]);m['acting_for_player_index']=None
 labels=ui.reduce(m)['scene']['labels'];assert 'Hand 1 of 1' in next(l['text'] for l in labels if l['id']=='hand-label')

def test_hearts_counts_hearts_and_queen_only_for_highest_led_suit():
 l=logic('hearts');c=ctx(4);s=copy.deepcopy(package('hearts')['unit_tests']['cases'][0]['state'])
 s.update(trickNum=1,leader=0,trick=[{'player':0,'card':'AC'},{'player':1,'card':'AH'},{'player':2,'card':'QS'}],hands=[[],[],[],['KH']],taken=[0,0,0,0],heartsBroken=True)
 out=apply(l,s,{'card':'KH'},c,3)['state'];assert out['taken']==[15,0,0,0] and out['leader']==0

def test_hearts_shooting_moon_and_tied_low_score_settlement():
 l=logic('hearts');c=ctx(4);s=copy.deepcopy(package('hearts')['unit_tests']['cases'][0]['state'])
 s.update(trickNum=12,leader=0,trick=[{'player':0,'card':'AH'},{'player':1,'card':'2H'},{'player':2,'card':'AS'}],hands=[[],[],[],['3H']],taken=[23,0,0,0],heartsBroken=True)
 out=apply(l,s,{'card':'3H'},c,3);assert out['state']['taken']==[0,26,26,26] and out['state']['winner']==0 and sum(out['payouts'].values())==37
 s.update(trick=[{'player':0,'card':'2C'},{'player':1,'card':'2H'},{'player':2,'card':'AC'}],taken=[4,4,8,8]);out=apply(l,s,{'card':'3H'},c,3)
 assert out['state']['taken']==[4,4,10,8];assert set(k for k,v in out['payouts'].items() if v)=={c['players'][0]['id'],c['players'][1]['id']};assert sum(out['payouts'].values())==37
 _,ui,m,_=inputs('hearts');m.update(status='over',view=l.call('viewFor',out['state'],c['players'][0]['id'],ctx=c,seed=1));assert next(x for x in ui.reduce(m)['scene']['labels'] if x['id']=='turn')['text']=='Tie · 4 points'

def test_golf_visible_pairs_cancel_and_hidden_cards_are_not_guessed():
 _,ui,m,_=inputs('six-card-golf');h=m['view']['hands'][m['my_player_index']]
 for i,r in enumerate([7,1,12,7,0,13]):h[i].update(r=r,s=0,up=i!=4)
 score=next(x for x in ui.reduce(m)['scene']['labels'] if x['id']=='score-'+str(m['my_player_index']))
 assert score['text']=='Known score: 11'
 h[3]['up']=False;h[3]['r']=0;assert next(x for x in ui.reduce(m)['scene']['labels'] if x['id']=='score-'+str(m['my_player_index']))['text']=='Known score: 18'

def test_casino_war_ace_high_text_and_match_draw():
 _,ui,m,_=inputs('casino-war');m['view'].update(phase='result',playerCard={'rank':1,'suit':0},dealerCard={'rank':13,'suit':1})
 assert next(x for x in ui.reduce(m)['scene']['labels'] if x['id']=='result')['text']=='You win the hand'
 m['view'].update(phase='over',winner=None);m['status']='over';assert next(x for x in ui.reduce(m)['scene']['labels'] if x['id']=='result')['text']=='Match tied'

@pytest.mark.parametrize('kind',['six-card-golf','war','crazy-eights','hearts','michigan','quoridor','concentration','casino-war','old-maid','blackjack'])
@pytest.mark.parametrize('seed',[7,31])
def test_complete_walk_scores_winners_and_token_conservation(kind,seed):
 p=package(kind);n=min(p['allowed_player_counts']) if seed==7 else max(p['allowed_player_counts']);c=ctx(n,seed);l=logic(kind);opened=l.call('newMatch',ctx=c,seed=seed);state=opened['state'];turn=opened['turn'];penalties=[0]*n;casino=[0,0,0]
 for ply in range(1200):
  if turn is None:break
  c['move_count']=ply;pid=turn[0];seat=next(i for i,p in enumerate(c['players']) if p['id']==pid)
  move=l.call('computerMove',state,pid,ctx=c,seed=seed+ply+1);before=copy.deepcopy(state);out=l.call('applyMove',state,pid,move,ctx=c,seed=seed+ply+2);state=out['state'];turn=out['turn']
  if kind=='hearts':
   trick=before['trick']+[{'player':seat,'card':move['card']}]
   if len(trick)==4:
    led=trick[0]['card'][-1];rank=lambda card: {'J':11,'Q':12,'K':13,'A':14}.get(card[:-1],int(card[:-1]) if card[:-1].isdigit() else 0)
    winner=max((x for x in trick if x['card'][-1]==led),key=lambda x:rank(x['card']))['player'];penalties[winner]+=sum(1 if x['card'][-1]=='H' else 13 if x['card']=='QS' else 0 for x in trick)
   expected=([0 if points==26 else 26 for points in penalties] if turn is None and 26 in penalties else penalties)
   assert state['taken']==expected
  elif kind=='casino-war' and before['phase']=='dealer':
   rank=lambda x:14 if x%13==0 else x%13+1;a,b=rank(state['playerCard']),rank(state['dealerCard']);casino[0 if a>b else 1 if b>a else 2]+=1
   assert [state['playerWins'],state['dealerWins'],state['ties']]==casino
  elif kind=='concentration':assert sum(state['scores'])==len(state['matched'])//2
  elif kind=='war':assert sum(map(len,state['decks']))+len(state['pile'])==52
  elif kind=='blackjack' and state['phase']=='roundOver' and before['phase'] in ('play','betting'):
   expected=before['chips'].copy()
   if move['kind']=='bet':expected[seat]-=min(int(move['amount']),before['chips'][seat])
   if move['kind']=='double':expected[seat]-=before['hands'][seat][before['curH']]['bet']
   dealer=state['dealer'];dv=val(dealer);dbj=len(dealer)==2 and dv==21
   for i,hands in enumerate(state['hands']):
    for h in hands:
     pv=val(h['cards']);bj=len(h['cards'])==2 and pv==21 and len(hands)==1
     expected[i]+=0 if pv>21 else math.floor(h['bet']*2.5) if bj and not dbj else 0 if dbj and not bj else h['bet'] if dbj and bj else h['bet']*2 if dv>21 or pv>dv else h['bet'] if pv==dv else 0
   assert state['chips']==expected
 if turn is not None:pytest.fail(f'{kind} did not terminate')
 assert sum(out.get('payouts',{}).values())==c['pot']
 if kind=='six-card-golf':assert state['scores']==[golf_score(h) for h in state['hands']];assert state['scores'][state['winner']]==min(state['scores'])
 if kind=='hearts':assert sum(penalties)==26 and state['taken'][state['winner']]==min(state['taken'])
 if kind=='crazy-eights':assert len(state['hands'][state['winner']])==0
 if kind=='michigan':assert len(state['hands'][state['winner']])==min(map(len,state['hands']))
 if kind=='quoridor':assert state['pawns'][state['winner']]['r']==(0 if state['winner']==0 else 8)
 if kind=='concentration':assert sum(state['scores'])==8 and state['winner']==(-1 if state['scores'][0]==state['scores'][1] else state['scores'].index(max(state['scores'])))
 if kind=='casino-war':assert sum(casino)==10 and state['phase']=='over'
 if kind=='old-maid':assert all(not hand for i,hand in enumerate(state['hands']) if i!=state['loser']) and len(state['hands'][state['loser']])==1 and state['hands'][state['loser']][0]%13==11
 if kind=='blackjack':assert state['chips'][state['winners']]==max(state['chips'])

def test_ten_distinct_portal_covers_follow_the_real_catalog_contract():
 from game_platform.game_artifacts import validate_cover
 import hashlib
 hashes=[]
 for kind in ['six-card-golf','war','crazy-eights','hearts','michigan','quoridor','concentration','casino-war','old-maid','blackjack']:
  p=package(kind);cover=p['images'][0];validate_cover(cover);hashes.append(hashlib.sha256(cover['svg'].encode()).hexdigest())
  assert (Path(__file__).resolve().parents[1]/'games/declarative/card-table/covers'/(kind+'.svg')).read_text().strip()==cover['svg']
 assert len(set(hashes))==10

def test_review_split_fixture_has_a_full_deck_and_resolves_two_pushes():
 root=Path(__file__).resolve().parents[1]/'games/declarative/card-table'
 fixture=json.loads((root/'review-fixtures/blackjack-split.json').read_text());s=fixture['state'];c=fixture['ctx'];l=logic('blackjack')
 all_cards=s['dealer']+s['deck']+[card for hands in s['hands'] for h in hands for card in h['cards']]
 assert len(all_cards)==52 and len({(card['r'],card['s']) for card in all_cards})==52
 for move in ({'kind':'split'},{'kind':'stand'},{'kind':'stand'}):s=apply(l,s,move,c)['state']
 assert s['results'][0]=='Push 18 | Push 18' and s['chips'][0]==1000
