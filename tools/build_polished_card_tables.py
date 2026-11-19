"""Synchronize the ten private card-table handoff packages from portable UI sources.

These editions are isolated from main's existing Hearts/Quoridor conversions.
Run from this repository: python3 tools/build_polished_card_tables.py
No API, network, rules generation, publication or production writes occur.
"""
from pathlib import Path
import json, html
import runpy
cover_builder=runpy.run_path(str(Path(__file__).with_name("card_table_covers.py")))
ROOT = Path(__file__).resolve().parents[1] / 'games/declarative/card-table'
KINDS = ('six-card-golf','war','crazy-eights','hearts','michigan','quoridor','concentration','casino-war','old-maid','blackjack')
def build():
    for kind in KINDS:
        path = ROOT / (kind + '.json')
        package = json.loads(path.read_text())
        # Preserve main's current rules, schemas, examples and translations for
        # already converted games. Only their declarative presentation changes.
        current = {'hearts':'hearts','quoridor':'quoridor','crazy-eights':'crazy_eights'}.get(kind)
        if current:
            base = json.loads((ROOT.parent/(current+'.json')).read_text())
            presentation = package['declarative_ui']
            presentation['strings'] = base['declarative_ui']['strings']
            base['declarative_ui'] = presentation
            package = base
            (ROOT/(kind+'.server.js')).write_text(package['server_code'].rstrip()+'\n')
        spec = package['declarative_ui']
        if kind in ('crazy-eights','hearts','michigan','casino-war','old-maid','blackjack'):
            titles={'crazy-eights':'Crazy Eights','hearts':'Hearts','michigan':'Michigan','casino-war':'Casino War','old-maid':'Old Maid','blackjack':'Blackjack'}
            code=(ROOT/'card-games.ui.template.js').read_text().replace('__GAME__',json.dumps(kind)).replace('__TITLE__',json.dumps(titles[kind]))
            (ROOT/(kind+'.ui.js')).write_text(code)
        spec['ui_code'] = (ROOT / (kind + '.ui.js')).read_text()
        spec.setdefault('motion', {}).update(animate_own=True)
        if kind in ('crazy-eights','hearts','michigan','casino-war','old-maid','blackjack'):
            height = {'hearts':910,'michigan':1120,'old-maid':850}.get(kind,740)
            spec['viewport'] = {'width':600,'height':height,'camera_enabled':True}
            spec['boards'][0].update(width=600,height=height,color='#164b3d',line_color='#a58a55')
            for typ in spec['piece_types'].values():
                typ.update(width=78,height=104)
            spec['motion'].update(move_ms=440,turn_pause_ms=650)
        elif kind == 'six-card-golf':
            spec['viewport'].update(width=600,height=930)
            spec['boards'][0].update(width=600,height=930)
        elif kind == 'concentration':
            for name in ('back','red-card','black-card'):
                spec['piece_types'][name]['action_outline']='rect'
        elif kind == 'war':
            spec['viewport'].update(width=600,height=700)
            spec['boards'][0].update(width=600,height=700)
            spec['motion'].update(move_ms=360,turn_pause_ms=650)
        if kind == 'casino-war':
            package['description']='Ten high-card hands against the dealer. Aces are high, ties count as ties, and most hand wins takes the match.'
            package['rules']='Compare one card each, ace high. The higher card earns one hand win; equal ranks count as a tie. After ten hands, most hand wins takes the match; equal totals are a draw.'
            package['ui_instructions']='Deal your card, reveal the dealer, then review the result before Next hand. Aces beat kings. Equal ranks and equal match totals are ties.'
        elif kind == 'blackjack':
            package['rules']='Aces count as 1 or 11 and face cards as 10. Place a bet, then Hit or Stand to get close to 21 without going over. A natural two-card 21 pays 3:2, ordinary wins pay 1:1, and ties return the bet. Double adds an equal bet and takes exactly one card. Split equal ranks into up to four hands; a split 21 pays as an ordinary hand. The dealer stands on all 17s, including soft 17. Highest chips wins after ten rounds or when at most one player has chips.'
            package['ui_instructions']='Choose an affordable bet, then use Hit or Stand. Double and Split appear only when affordable and legal. When splitting, the active hand and every hand value/bet are shown separately. Review each hand result before Next round.'
        if kind in ('casino-war','blackjack'):
            package['tutorial']={'text':package['rules'],'html':'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><h1>'+html.escape(package['name'])+'</h1><p>'+html.escape(package['rules'])+'</p>'}
            for translated in package.get('translations',{}).values():
                translated['short_description']=package['description']
                translated['game_logic_rules']=package['rules']
                translated['game_ui_rules']=package['ui_instructions']
                translated['tutorial_strings']={package['name']:package['name'],package['rules']:package['rules']}
        cover_builder['attach'](package,kind)
        path.write_text(json.dumps(package,ensure_ascii=False,indent=2)+'\n')
if __name__ == '__main__': build()
