"""Build the two-player single-deal Scopa declarative package."""
import base64
import copy
import html
import json
from pathlib import Path

from game_platform.game_logic import GameLogic

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'games' / 'declarative'
LOCALES = ['es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar']
RULES = [
    'Play one deal of two-player Scopa with 40 cards. Aces count 1, Jacks 8, Queens 9 and Kings 10. Deal three cards each and four face up; deal three more each whenever hands run out. Play one card: if a table card has the same value, capture exactly one such card. Otherwise capture any group adding to your card, or leave it on the table if no capture is possible. Clearing the table earns a sweep, except on the last play. After the last play, the last capturer takes remaining table cards. Score one point each for most cards, most diamonds, the 7 of diamonds and best primiera, plus one per sweep. Ties in a category score no point. Primiera requires all four suits and values 7, 6, A, 5, 4, 3, 2, then face cards in that order. The higher score wins this deal.',
    'Juega una mano de Scopa para dos con 40 cartas. As vale 1, sota 8, reina 9 y rey 10. Reparte tres cartas a cada jugador y cuatro a la mesa; reparte tres más cuando se agoten las manos. Juega una carta: si hay una igual, captura exactamente una; si no, captura cartas que sumen su valor o déjala en la mesa si no hay captura. Vaciar la mesa da una escoba, salvo en la última jugada. Al final quien capturó por última vez recoge las cartas restantes. Puntúa por más cartas, más diamantes, el 7 de diamantes, la mejor primiera y cada escoba. Los empates de categoría no puntúan. La primiera requiere los cuatro palos y valora 7, 6, as, 5, 4, 3, 2 y figuras en ese orden. Gana la puntuación mayor.',
    'Jouez une donne de Scopa à deux avec 40 cartes. As vaut 1, valet 8, dame 9 et roi 10. Distribuez trois cartes à chacun et quatre sur la table ; redistribuez trois cartes lorsque les mains sont vides. Jouez une carte : si une carte de même valeur est sur la table, prenez-en exactement une ; sinon prenez un groupe totalisant sa valeur ou posez-la si aucune prise n’est possible. Vider la table donne une scopa, sauf au dernier coup. À la fin, le dernier à avoir pris ramasse les cartes restantes. Un point pour le plus de cartes, le plus de carreaux, le 7 de carreau et la meilleure primiera, plus un par scopa. Une égalité ne rapporte rien dans la catégorie. La primiera exige les quatre couleurs et classe 7, 6, as, 5, 4, 3, 2 puis figures. Le meilleur score gagne.',
    'Spielt eine Scopa-Hand zu zweit mit 40 Karten. Ass zählt 1, Bube 8, Dame 9 und König 10. Jeder erhält drei Karten, vier liegen offen; sind beide Hände leer, erhält jeder drei weitere. Spiele eine Karte: Liegt eine gleich hohe Karte aus, nimm genau eine davon. Sonst nimm eine Gruppe mit passender Summe oder lege die Karte ab, wenn keine Aufnahme möglich ist. Ein geleerter Tisch zählt als Scopa, außer beim letzten Zug. Übrige Karten erhält, wer zuletzt aufgenommen hat. Je ein Punkt für die meisten Karten, die meisten Karos, die Karo-Sieben und die beste Primiera, dazu je einer pro Scopa. Gleichstand in einer Kategorie gibt keinen Punkt. Primiera benötigt alle vier Farben und wertet 7, 6, Ass, 5, 4, 3, 2, dann Bildkarten. Die höhere Punktzahl gewinnt.',
    'Jogue uma mão de Scopa para duas pessoas com 40 cartas. Ás vale 1, valete 8, dama 9 e rei 10. Distribua três cartas a cada jogador e quatro à mesa; dê mais três quando as mãos acabarem. Jogue uma carta: se houver uma de mesmo valor, capture exatamente uma; senão capture um grupo que some seu valor ou deixe-a na mesa se não puder capturar. Limpar a mesa vale uma escopa, exceto na última jogada. No fim, quem capturou por último leva as cartas restantes. Um ponto por mais cartas, mais ouros, 7 de ouros e melhor primiera, além de um por escopa. Empates na categoria não pontuam. A primiera exige os quatro naipes e valoriza 7, 6, ás, 5, 4, 3, 2 e figuras nessa ordem. Vence a maior pontuação.',
    '两人使用40张牌进行一局斯科帕。A为1，J为8，Q为9，K为10。每人发三张，桌上放四张；双方手牌用完时再各发三张。出一张牌：桌上有同值牌时必须取其中一张；否则取点数之和等于所出牌的一组牌，没有可取的牌则将其留在桌上。清空桌面得一次扫牌，但最后一手不计。结束时剩余桌牌归最后取得牌的玩家。牌最多、方块最多、方块7和最佳普里米耶拉各得一分，每次扫牌再得一分；项目平局不得分。普里米耶拉须有四种花色，各花色按7、6、A、5、4、3、2、人物牌排序计分。得分高者获胜。',
    'दो खिलाड़ी 40 पत्तों से स्कोपा का एक हाथ खेलते हैं। इक्का 1, गुलाम 8, बेगम 9 और बादशाह 10 है। दोनों को तीन और मेज पर चार पत्ते दें; हाथ खाली होने पर फिर तीन-तीन दें। एक पत्ता चलें: समान मूल्य का पत्ता हो तो उनमें से एक ही लें; अन्यथा उसके मूल्य के बराबर योग वाला समूह लें, या कोई मेल न हो तो पत्ता मेज पर रखें। मेज साफ करने पर स्कोपा अंक मिलता है, अंतिम चाल पर नहीं। अंत में शेष पत्ते आखिरी बार लेने वाले को मिलते हैं। सबसे अधिक पत्ते, सबसे अधिक ईंट, ईंट का 7 और सबसे अच्छी प्रिमिएरा पर एक-एक अंक, साथ ही हर स्कोपा पर एक अंक मिलता है। बराबरी पर उस श्रेणी का अंक नहीं मिलता। प्रिमिएरा के लिए चारों सूट चाहिए; क्रम 7, 6, इक्का, 5, 4, 3, 2 और चित्र पत्ते है। अधिक अंक जीतते हैं।',
    'العب جولة سكوبا لشخصين بأربعين ورقة. الآس يساوي 1 والولد 8 والملكة 9 والملك 10. وزع ثلاث أوراق لكل لاعب وأربعًا على الطاولة، ثم ثلاثًا أخرى عند نفاد اليدين. العب ورقة: إن وُجدت ورقة مساوية فخذ واحدة منها فقط، وإلا خذ مجموعة مجموعها يساوي قيمتها أو اترك الورقة إن تعذر الأخذ. إخلاء الطاولة يمنح نقطة سكوبا إلا في اللعب الأخير. يأخذ آخر من جمع الأوراق المتبقية عند النهاية. نقطة لأكثر الأوراق، وأكثر أوراق الديناري، وسبعة الديناري، وأفضل بريميرا، ونقطة لكل سكوبا. لا نقطة للتعادل في فئة. تتطلب البريميرا الأنواع الأربعة وترتيبها 7 ثم 6 ثم الآس ثم 5 و4 و3 و2 ثم الصور. يفوز صاحب النقاط الأكثر.'
]
UI = [
    'Tap a card in your hand, then tap the table cards you want to capture.',
    'Toca una carta de tu mano y después las cartas de la mesa que quieras capturar.',
    'Touchez une carte de votre main, puis les cartes à prendre sur la table.',
    'Tippe auf eine Handkarte und dann auf die Karten, die du aufnehmen möchtest.',
    'Toque em uma carta da mão e depois nas cartas da mesa que deseja capturar.',
    '点击手牌，再点击要收取的桌面牌。',
    'अपने हाथ का पत्ता दबाएँ, फिर मेज से लेने वाले पत्ते दबाएँ।',
    'اضغط ورقة من يدك، ثم اضغط أوراق الطاولة التي تريد أخذها.'
]
STRINGS = [
    {'title':'Scopa','sweeps':'Sweeps  {a} : {b}','final':'Final  {a} : {b}','stock':'Deck {n}','player':'Player {n}','choose_card':'Choose a card','choose_capture':'Choose table cards','play':'Play {card}','capture':'Take {card}','tie':'Draw','winner':'{name} wins'},
    {'title':'Scopa','sweeps':'Escobas  {a} : {b}','final':'Final  {a} : {b}','stock':'Mazo {n}','player':'Jugador {n}','choose_card':'Elige una carta','choose_capture':'Elige cartas de la mesa','play':'Jugar {card}','capture':'Tomar {card}','tie':'Empate','winner':'Gana {name}'},
    {'title':'Scopa','sweeps':'Scopas  {a} : {b}','final':'Final  {a} : {b}','stock':'Pioche {n}','player':'Joueur {n}','choose_card':'Choisissez une carte','choose_capture':'Choisissez les cartes','play':'Jouer {card}','capture':'Prendre {card}','tie':'Égalité','winner':'{name} gagne'},
    {'title':'Scopa','sweeps':'Scopas  {a} : {b}','final':'Endstand  {a} : {b}','stock':'Stapel {n}','player':'Spieler {n}','choose_card':'Karte wählen','choose_capture':'Tischkarten wählen','play':'{card} spielen','capture':'{card} nehmen','tie':'Unentschieden','winner':'{name} gewinnt'},
    {'title':'Scopa','sweeps':'Escopas  {a} : {b}','final':'Final  {a} : {b}','stock':'Monte {n}','player':'Jogador {n}','choose_card':'Escolha uma carta','choose_capture':'Escolha cartas da mesa','play':'Jogar {card}','capture':'Pegar {card}','tie':'Empate','winner':'{name} vence'},
    {'title':'斯科帕','sweeps':'扫牌  {a} : {b}','final':'最终  {a} : {b}','stock':'牌堆 {n}','player':'玩家 {n}','choose_card':'选择一张牌','choose_capture':'选择桌面牌','play':'出 {card}','capture':'收取 {card}','tie':'平局','winner':'{name} 获胜'},
    {'title':'स्कोपा','sweeps':'स्कोपा  {a} : {b}','final':'अंतिम  {a} : {b}','stock':'ढेर {n}','player':'खिलाड़ी {n}','choose_card':'पत्ता चुनें','choose_capture':'मेज के पत्ते चुनें','play':'{card} चलें','capture':'{card} लें','tie':'बराबरी','winner':'{name} जीते'},
    {'title':'سكوبا','sweeps':'سكوبا  {a} : {b}','final':'النتيجة  {a} : {b}','stock':'الرزمة {n}','player':'اللاعب {n}','choose_card':'اختر ورقة','choose_capture':'اختر أوراق الطاولة','play':'العب {card}','capture':'خذ {card}','tie':'تعادل','winner':'فاز {name}'}
]
ERRORS = [
    ['game over','not your turn','choose a card and capture','invalid capture'],
    ['La partida ha terminado','No es tu turno','Elige una carta y captura','Captura inválida'],
    ['La partie est terminée','Ce n’est pas votre tour','Choisissez une carte et une prise','Prise invalide'],
    ['Das Spiel ist beendet','Du bist nicht am Zug','Wähle eine Karte und Aufnahme','Ungültige Aufnahme'],
    ['A partida terminou','Não é sua vez','Escolha uma carta e captura','Captura inválida'],
    ['游戏已结束','还没轮到你','选择出牌和收取的牌','无效的收取'],
    ['खेल समाप्त हो गया','आपकी बारी नहीं है','पत्ता और लेने वाले पत्ते चुनें','अमान्य चयन'],
    ['انتهت اللعبة','ليس دورك','اختر ورقة والأوراق المأخوذة','أخذ غير صالح']
]
for strings, values in zip(STRINGS,ERRORS):
    strings.update(dict(zip(('server_game_over','server_not_your_turn','server_choose',
                             'server_invalid_capture'),values)))


def schemas():
    card = {'type':'string','pattern':'^(?:[1-9]|10)[SHDC]$'}
    cards = {'type':'array','items':card,'maxItems':40,'uniqueItems':True}
    pair = lambda item: {'type':'array','items':item,'minItems':2,'maxItems':2}
    number = {'type':'integer','minimum':0,'maximum':40}
    move = {'type':'object','properties':{'card':card,'capture':cards},
            'required':['card','capture'],'additionalProperties':False}
    common = {'table':cards,'sweeps':pair(number),'turn':{'enum':[0,1]},'over':{'type':'boolean'},
              'winner':{'enum':[-1,0,1]},'scores':pair(number)}
    state = {**common,'deck':cards,'hands':pair(cards),'captured':pair(cards),
             'last_capture':{'enum':[-1,0,1]}}
    view = {**common,'hand':cards,'counts':pair(number),'deck_count':number,
            'captured_counts':pair(number),'legal':{'type':'array','items':move,'maxItems':4096}}
    obj = lambda props: {'type':'object','properties':props,'required':list(props),'additionalProperties':False}
    return {'state':obj(state),'view':obj(view),'move':move}


def image(caption):
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90">'
           '<rect width="160" height="90" rx="8" fill="#174d42"/>'
           '<rect x="34" y="13" width="38" height="62" rx="4" fill="#fffdf6" stroke="#d5c6a9"/>'
           '<rect x="88" y="13" width="38" height="62" rx="4" fill="#fffdf6" stroke="#d5c6a9"/>'
           '<path d="M53 28l10 15-10 15-10-15z" fill="#b02e35"/>'
           '<circle cx="107" cy="43" r="10" fill="#1c2b31"/></svg>')
    return {'caption':caption,'svg':svg}


def build():
    schema = schemas()
    code = (DEST/'scopa_rules.js').read_text(encoding='utf-8')
    logic = GameLogic(code,game_schemas=schema)
    ctx = {'players':[{'id':f'p{i}','kind':'human','display_name':f'Player {i+1}',
                       'picture_url':'','max_loss':0,'active':True} for i in range(2)],
           'pot':0,'move_count':0}
    result = logic.call('newMatch',ctx=ctx,seed=7)
    steps = []
    for i in range(36):
        ctx['move_count'] = i
        state = result['state']
        player = result['turn'][0]
        move = logic.call('computerMove',state,player,ctx=ctx,seed=i+11)
        result = logic.call('applyMove',state,player,move,ctx=ctx,seed=i+11)
        steps.append((copy.deepcopy(ctx),state,player,move,result,i+11))
    if result['turn'] is not None:
        raise RuntimeError('Scopa did not finish in 36 plays')
    cases = []
    for kind,index in [('initial',0),('intermediate',12),('terminal',35)]:
        case_ctx,state,player,move,result,seed = steps[index]
        views = [logic.call('viewFor',state,who,ctx=case_ctx,seed=seed) for who in (player,None)]
        after = [logic.call('viewFor',result['state'],who,ctx=case_ctx,seed=seed) for who in (player,None)]
        case = {'name':kind.title()+' play','description':RULES[0],'kind':kind,
                'ctx':{**case_ctx,'seed':seed},'state':state,'view_of_mover':views[0],
                'view_of_other':views[1],'player_id':player,'other_player_id':None,'move':move,
                'expected_state':result['state'],'expected_turn':result['turn'],
                'expected_view_of_mover':after[0],'expected_view_of_other':after[1],
                'images':[image(caption) for caption in ('Before: player','Before: spectator','After: player','After: spectator')]}
        if 'payouts' in result: case['expected_payouts'] = result['payouts']
        cases.append(case)
    ui = {'format':'buildplay-ui','version':1,'viewport':{'width':640,'height':590},
          'boards':[{'id':'table','kind':'free','x':0,'y':0,'width':640,'height':590,
                     'color':'#316f68','line_color':'#e9dcb7'}],
          'piece_types':{key:{'shape':'image','asset':'card_face_soft','width':76,'height':96,
                              'text_color':color}
                         for key,color in [('red','#b02e35'),('black','#1c2b31')]},
          'assets':{'card_face_soft':{'media_type':'image/svg+xml','uri':'data:image/svg+xml;base64,'+
                    base64.b64encode((DEST/'card_face_soft.svg').read_bytes()).decode()}},
          'strings':STRINGS[0],
          'ui_code':'const SOURCE_STRINGS='+json.dumps(STRINGS[0],ensure_ascii=False)+';\n'+
                    (DEST/'scopa_ui.js').read_text(encoding='utf-8')}
    payload = {'name':'Scopa (Declarative)','description':RULES[0],'allowed_player_counts':[2],
               'all_state_public':False,'server_code':code,'declarative_ui':ui,
               'rules':RULES[0],'ui_instructions':UI[0],
               'tutorial':{'text':RULES[0],'html':'<meta name="viewport" content="width=device-width,initial-scale=1"><p>'+html.escape(RULES[0])+'</p>'},
               'images':[image(caption) for caption in ('Cover','Table','Capture','Hand')],
               'unit_tests':{**{name+'_schema':value for name,value in schema.items()},'cases':cases},
               'translations':{locale:{'display_name':STRINGS[i+1]['title']+' (Declarative)',
                  'short_description':RULES[i+1],'game_logic_rules':RULES[i+1],'game_ui_rules':UI[i+1],
                  'tutorial_strings':{RULES[0]:RULES[i+1]},'client_strings':STRINGS[i+1]}
                  for i,locale in enumerate(LOCALES)},
               'game_addition_request_id_and_secret':'example-only-scopa-replace-before-publishing'}
    (DEST/'scopa.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('Built Scopa with three recorded examples.')


if __name__ == '__main__':
    build()
