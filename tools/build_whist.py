"""Build the four-player Whist declarative submission fixture."""
import copy
import html
import json
from pathlib import Path

from game_platform.game_logic import GameLogic
from game_platform.tools.game_alternative_names import reviewed_names

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'games' / 'declarative'
LOCALES = ['es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar']
RULES = [
    'Four players form partnerships across the table. Deal thirteen cards each and use the dealer’s last card to choose trump. Follow the led suit if possible; otherwise play any card. The highest trump wins, or the highest card of the led suit if no trump was played. The winner leads the next trick. After thirteen tricks, the partnership with more tricks wins this single hand.',
    'Cuatro jugadores forman parejas opuestas. Reparte trece cartas a cada uno y usa la última carta del repartidor para elegir el triunfo. Sigue el palo inicial si puedes; si no, juega cualquier carta. Gana el triunfo más alto o la carta más alta del palo inicial si no hay triunfo. El ganador inicia la siguiente baza. Tras trece bazas gana la pareja con más bazas en esta mano.',
    'Quatre joueurs forment deux équipes opposées. Distribuez treize cartes à chacun ; la dernière carte du donneur détermine l’atout. Fournissez la couleur demandée si possible, sinon jouez une carte quelconque. Le plus fort atout gagne, sinon la plus forte carte de la couleur demandée. Le gagnant mène la levée suivante. Après treize levées, l’équipe qui en a le plus gagne cette manche.',
    'Vier Personen bilden gegenüberliegende Partnerschaften. Jeder erhält dreizehn Karten; die letzte Karte des Gebers bestimmt Trumpf. Bediene die angespielte Farbe, wenn möglich, sonst spiele eine beliebige Karte. Der höchste Trumpf gewinnt, sonst die höchste Karte der angespielten Farbe. Der Gewinner spielt den nächsten Stich aus. Nach dreizehn Stichen gewinnt das Team mit den meisten Stichen diese Hand.',
    'Quatro jogadores formam duplas opostas. Distribua treze cartas para cada um; a última carta do carteador define o trunfo. Siga o naipe inicial se possível; caso contrário, jogue qualquer carta. O maior trunfo vence, ou a maior carta do naipe inicial se não houver trunfo. Quem vence inicia a próxima vaza. Após treze vazas, a dupla com mais vazas vence esta mão.',
    '四名玩家相对组成两队。每人发十三张牌，庄家最后一张牌的花色为主牌。能跟首出的花色时必须跟，否则可出任意牌。有主牌时最大主牌获胜，否则首出花色中最大牌获胜。赢家领出下一墩。十三墩后，赢得墩数较多的队伍赢得本局。',
    'चार खिलाड़ी आमने-सामने की साझेदारियाँ बनाते हैं। प्रत्येक को तेरह पत्ते दें; बाँटने वाले का अंतिम पत्ता तुरुप का सूट तय करता है। संभव हो तो शुरू किया गया सूट चलें, नहीं तो कोई भी पत्ता चलें। सबसे बड़ा तुरुप जीतता है; तुरुप न होने पर शुरू हुए सूट का सबसे बड़ा पत्ता जीतता है। विजेता अगली चाल शुरू करता है। तेरह चालों के बाद अधिक चालें जीतने वाली जोड़ी यह हाथ जीतती है।',
    'يشكل أربعة لاعبين فريقين متقابلين. يوزع ثلاثة عشر ورقة لكل لاعب، ويحدد نوع آخر ورقة للموزع نوع الحكم. اتبع النوع الأول إن استطعت، وإلا العب أي ورقة. تفوز أعلى ورقة حكم، أو أعلى ورقة من النوع الأول إذا لم يُلعب حكم. يبدأ الفائز اللمة التالية. بعد ثلاث عشرة لمة يفوز الفريق صاحب اللمّات الأكثر بهذه الجولة.'
]
UI = [
    'Tap a highlighted card to play it. The trump suit and both teams’ trick counts appear above the table.',
    'Toca una carta resaltada para jugarla. El triunfo y las bazas de ambos equipos aparecen sobre la mesa.',
    'Touchez une carte surlignée pour la jouer. L’atout et les levées des deux équipes figurent au-dessus de la table.',
    'Tippe auf eine markierte Karte, um sie zu spielen. Trumpf und Stiche beider Teams stehen über dem Tisch.',
    'Toque em uma carta destacada para jogá-la. O trunfo e as vazas das duas equipes aparecem acima da mesa.',
    '点击高亮的牌出牌。主牌花色和两队的墩数显示在牌桌上方。',
    'चमकते पत्ते को खेलने के लिए टैप करें। तुरुप का सूट और दोनों टीमों की चालें मेज के ऊपर दिखती हैं।',
    'اضغط على ورقة مضاءة للعبها. يظهر نوع الحكم وعدد لمّات الفريقين فوق الطاولة.'
]
STRINGS = [
    {'title':'Whist','trump':'Trump {suit}','player':'Player {n}','play':'Play {card}','winner':'{team} wins','turn':'{name} to play'},
    {'title':'Whist','trump':'Triunfo {suit}','player':'Jugador {n}','play':'Jugar {card}','winner':'Gana {team}','turn':'Turno de {name}'},
    {'title':'Whist','trump':'Atout {suit}','player':'Joueur {n}','play':'Jouer {card}','winner':'{team} gagne','turn':'À {name} de jouer'},
    {'title':'Whist','trump':'Trumpf {suit}','player':'Spieler {n}','play':'{card} spielen','winner':'{team} gewinnt','turn':'{name} ist am Zug'},
    {'title':'Whist','trump':'Trunfo {suit}','player':'Jogador {n}','play':'Jogar {card}','winner':'{team} vence','turn':'Vez de {name}'},
    {'title':'惠斯特','trump':'主牌 {suit}','player':'玩家 {n}','play':'打出 {card}','winner':'{team} 获胜','turn':'轮到 {name}'},
    {'title':'व्हिस्ट','trump':'तुरुप {suit}','player':'खिलाड़ी {n}','play':'{card} खेलें','winner':'{team} जीते','turn':'{name} की बारी'},
    {'title':'ويست','trump':'الحكم {suit}','player':'اللاعب {n}','play':'العب {card}','winner':'فاز {team}','turn':'دور {name}'}
]
SERVER_STRINGS = [
    ['game over','not your turn','choose a card','follow suit when possible'],
    ['La partida ha terminado','No es tu turno','Elige una carta','Sigue el palo si puedes'],
    ['La partie est terminée','Ce n’est pas votre tour','Choisissez une carte','Fournissez la couleur si possible'],
    ['Das Spiel ist beendet','Du bist nicht am Zug','Wähle eine Karte','Bediene die Farbe, wenn möglich'],
    ['A partida terminou','Não é sua vez','Escolha uma carta','Siga o naipe se possível'],
    ['游戏已结束','还没轮到你','选择一张牌','有首出花色时必须跟牌'],
    ['खेल समाप्त हो गया','आपकी बारी नहीं है','एक पत्ता चुनें','संभव हो तो वही सूट चलें'],
    ['انتهت اللعبة','ليس دورك','اختر ورقة','اتبع النوع إن استطعت']
]
for strings, values in zip(STRINGS, SERVER_STRINGS):
    strings.update(dict(zip(('server_game_over','server_not_your_turn','server_choose_card',
                             'server_follow_suit'),values)))


def schemas():
    card = {'type':'string','pattern':'^(?:[2-9]|1[0-4])[SHDC]$'}
    cards = {'type':'array','items':card,'maxItems':13,'uniqueItems':True}
    play = {'type':'object','required':['seat','card'],'additionalProperties':False,
            'properties':{'seat':{'type':'integer','minimum':0,'maximum':3},'card':card}}
    common = {
        'trump':{'enum':['S','H','D','C']},
        'trick':{'type':'array','items':play,'maxItems':3},
        'last_trick':{'type':'array','items':play,'maxItems':4},
        'tricks':{'type':'array','items':{'type':'integer','minimum':0,'maximum':13},'minItems':2,'maxItems':2},
        'turn':{'type':'integer','minimum':0,'maximum':3},
        'over':{'type':'boolean'}, 'winner':{'enum':[-1,0,1]}}
    state_props = {**common,'hands':{'type':'array','items':cards,'minItems':4,'maxItems':4}}
    view_props = {**common,'hand':cards,'legal':cards,
                  'counts':{'type':'array','items':{'type':'integer','minimum':0,'maximum':13},'minItems':4,'maxItems':4}}
    object_schema = lambda props: {'type':'object','properties':props,'required':list(props),'additionalProperties':False}
    return {'state':object_schema(state_props),'view':object_schema(view_props),
            'move':object_schema({'card':card})}


def image(caption):
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90">'
           '<rect width="160" height="90" rx="8" fill="#174d42"/>'
           '<rect x="38" y="15" width="36" height="56" rx="4" fill="#fffdf6" stroke="#d5c6a9"/>'
           '<rect x="86" y="15" width="36" height="56" rx="4" fill="#fffdf6" stroke="#d5c6a9"/>'
           '<circle cx="56" cy="43" r="8" fill="#b02e35"/>'
           '<path d="M104 32l10 11-10 11-10-11z" fill="#1c2b31"/></svg>')
    return {'caption':caption,'svg':svg}


def build():
    schema = schemas()
    code = (DEST / 'whist_rules.js').read_text(encoding='utf-8')
    logic = GameLogic(code, game_schemas=schema)
    ctx = {'players':[{'id':f'p{i}', 'kind':'human', 'display_name':f'Player {i+1}',
                       'picture_url':'', 'max_loss':0, 'active':True} for i in range(4)],
           'pot':0,'move_count':0}
    current = logic.call('newMatch', ctx=ctx, seed=7)
    steps = []
    for step in range(52):
        ctx['move_count'] = step
        state = current['state']
        player = current['turn'][0]
        move = logic.call('computerMove',state,player,ctx=ctx,seed=step+11)
        current = logic.call('applyMove',state,player,move,ctx=ctx,seed=step+11)
        steps.append((copy.deepcopy(ctx),state,player,move,current,step+11))
    if current['turn'] is not None:
        raise RuntimeError('Whist did not finish in 52 plays')
    cases = []
    for kind, index in [('initial',0),('intermediate',12),('terminal',51)]:
        case_ctx, state, player, move, result, seed = steps[index]
        views = [logic.call('viewFor',state,who,ctx=case_ctx,seed=seed) for who in (player,None)]
        after = [logic.call('viewFor',result['state'],who,ctx=case_ctx,seed=seed) for who in (player,None)]
        case = {'name':kind.title()+' play','description':RULES[0],'kind':kind,
                'ctx':{**case_ctx,'seed':seed},'state':state,'view_of_mover':views[0],
                'view_of_other':views[1],'player_id':player,'other_player_id':None,'move':move,
                'expected_state':result['state'],'expected_turn':result['turn'],
                'expected_view_of_mover':after[0],'expected_view_of_other':after[1],
                'images':[image(caption) for caption in ('Before: player','Before: spectator','After: player','After: spectator')]}
        if 'payouts' in result:
            case['expected_payouts'] = result['payouts']
        cases.append(case)
    ui = {'format':'buildplay-ui','version':1,'viewport':{'width':640,'height':590},
          'motion':{'scene_transitions':True,'easing':'ease-in-out-quad'},
          'boards':[{'id':'table','kind':'free','x':0,'y':0,'width':640,'height':590,
                     'color':'#316f68','line_color':'#e9dcb7'}],
          'piece_types':{key:{'shape':'card','width':74,'height':96,
                              'text_color':color}
                         for key,color in [('red','#b02e35'),('black','#1c2b31')]},
          'strings':STRINGS[0],
          'ui_code':'const SOURCE_STRINGS='+json.dumps(STRINGS[0],ensure_ascii=False)+';\n'+
                    (DEST / 'whist_ui.js').read_text(encoding='utf-8')}
    payload = {'name':'Whist (Declarative)','description':RULES[0],'allowed_player_counts':[4],
               'all_state_public':False,'server_code':code,'declarative_ui':ui,
               'rules':RULES[0],'ui_instructions':UI[0],
               'tutorial':{'text':RULES[0],'html':'<meta name="viewport" content="width=device-width,initial-scale=1"><p>'+html.escape(RULES[0])+'</p>'},
               'images':[image(caption) for caption in ('Cover','Table','Trick','Hand')],
               'unit_tests':{**{name+'_schema':value for name,value in schema.items()},'cases':cases},
               'translations':{locale:{'display_name':STRINGS[i+1]['title']+' (Declarative)',
                  'short_description':RULES[i+1],'game_logic_rules':RULES[i+1],'game_ui_rules':UI[i+1],
                  'tutorial_strings':{RULES[0]:RULES[i+1]},'client_strings':STRINGS[i+1]}
                  for i,locale in enumerate(LOCALES)},
               'alternative_names': reviewed_names('Whist'),
               'game_addition_request_id_and_secret':'example-only-whist-replace-before-publishing'}
    (DEST / 'whist.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('Built Whist with three recorded examples.')


if __name__ == '__main__':
    build()
