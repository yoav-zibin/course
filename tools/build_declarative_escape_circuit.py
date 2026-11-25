"""Build the Escape Circuit rules, artwork, localization and approved examples."""
from __future__ import annotations

import base64
import html
import json
from collections import deque
from pathlib import Path

from game_platform.game_logic import GameLogic
from game_platform.tools.escape_circuit_text import INSTRUCTIONS, LOCALES, RULES, STRINGS, TITLES

DEST = Path(__file__).resolve().parents[1] / 'games' / 'declarative'
STARTS = [
    [5, 2, 0, 11, 8, 14, 17, 4, 13, 16],
    [0, 2, 6, 8, 10, 13, 9, 15, 18, 11],
]
SHAPES = [(2, 2), (2, 1), (2, 1), (1, 2), (1, 2), (1, 2), *([(1, 1)] * 4)]
CELL = 80
TYPES = ('core', 'wide', 'wide', 'tall', 'tall', 'tall', *(['chip'] * 4))
COLORS = ('#76ead6', '#e9a7ff')


def strings(index):
    return {key: choices[index] for key, choices in STRINGS.items()}


def occupied(at, width, height):
    row, col = divmod(at, 4)
    return {(row + y, col + x) for y in range(height) for x in range(width)}


def solution_guide():
    def position(tiles):
        return (tiles[0], *sorted(tiles[1:3]), *sorted(tiles[3:6]), *sorted(tiles[6:]))

    def neighbors(board):
        footprints = [occupied(at, *shape) for at, shape in zip(board, SHAPES)]
        filled = set.union(*footprints)
        for tile, (at, footprint) in enumerate(zip(board, footprints)):
            row, col = divmod(at, 4)
            blocked = filled - footprint
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                cells = {(y + dy, x + dx) for y, x in footprint}
                if all(0 <= y < 5 and 0 <= x < 4 for y, x in cells) and not cells & blocked:
                    target = (row + dy) * 4 + col + dx
                    yield position((*board[:tile], target, *board[tile + 1:]))

    guide = {}
    for start in STARTS:
        start = position(start)
        parent = {start: None}
        queue = deque([start])
        while queue:
            board = queue.popleft()
            if board[0] == 13:
                break
            for target in neighbors(board):
                if target not in parent:
                    parent[target] = board
                    queue.append(target)
        else:
            raise ValueError('The starting tray has no solution')
        distance = 0
        while board is not None:
            # JavaScript's default sort is lexicographic.
            key = ','.join(str(at) for at in (board[0], *sorted(board[1:3], key=str),
                            *sorted(board[3:6], key=str), *sorted(board[6:], key=str)))
            guide[key] = distance
            board, distance = parent[board], distance + 1
    return guide


def svg(width, height, content):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}">{content}</svg>'


def art(width, height, content):
    image = base64.b64encode(svg(width, height, content).encode()).decode()
    return {'media_type': 'image/svg+xml', 'uri': f'data:image/svg+xml;base64,{image}'}


def block(kind, width, height):
    x, y = width / 2, height / 2
    fill, base, light, ink = {
        'core': ('#ff9658', '#a63c39', '#ffd899', '#6f282d'),
        'wide': ('#51c8cb', '#22637c', '#a8f1e6', '#1c5a71'),
        'tall': ('#a994f6', '#574086', '#dfcdff', '#493478'),
        'chip': ('#f5d46d', '#94713c', '#fff0a6', '#816236'),
    }[kind]
    if kind == 'core':
        mark = (f'<circle cx="{x}" cy="{y-2}" r="32" fill="{light}"/>'
                f'<path d="M{x-16} {y-9}h32l-16 19Z" fill="{ink}"/>'
                f'<path d="M{x-12} {y+17}h24" stroke="{ink}" stroke-width="4" stroke-linecap="round"/>')
    elif kind == 'chip':
        mark = f'<circle cx="{x}" cy="{y-3}" r="9" fill="{ink}"/><circle cx="{x-2}" cy="{y-5}" r="2" fill="{light}"/>'
    else:
        line = 'h56' if kind == 'wide' else 'v56'
        start_x, start_y = (x - 28, y - 3) if kind == 'wide' else (x, y - 31)
        mark = f'<path d="M{start_x} {start_y}{line}" stroke="{ink}" stroke-width="8" stroke-linecap="round"/>'
    return (f'<rect x="1" y="4" width="{width-2}" height="{height-5}" rx="13" fill="{base}"/>'
            f'<rect x="1" y="1" width="{width-2}" height="{height-9}" rx="13" fill="{fill}"/>'
            f'<path d="M12 17V14Q12 9 18 9H{width-19}" fill="none" stroke="{light}" stroke-width="3" stroke-linecap="round"/>'
            f'{mark}')


def tray(color):
    cells = ''.join(
        f'<rect x="{x+2}" y="{y+2}" width="76" height="76" rx="10" fill="#291d35" stroke="#4e3c55" stroke-width="2"/>'
        for y in range(0, 400, CELL) for x in range(0, 320, CELL)
    )
    return (f'<rect width="320" height="400" rx="12" fill="#1b1326"/>{cells}'
            f'<path d="M2 380v17h77M241 397h77v-17" fill="none" stroke="{color}" stroke-width="4"/>'
            f'<path d="M82 325h156v70H82Z" fill="none" stroke="{color}" stroke-width="2" stroke-dasharray="7 6"/>')


def gate(color):
    return (f'<rect x="3" y="2" width="154" height="22" rx="6" fill="{color}"/>'
            '<path d="M47 9l6 7 6-7m14 0 7 7 7-7m14 0 6 7 6-7" fill="none" stroke="#261831" stroke-width="2.5"/>')


def specification(geometry):
    assets = {
        'mat': art(700, 570, '<rect width="700" height="570" rx="21" fill="#20152d"/>'
                            '<path d="M20 76h660" stroke="#56415e" stroke-width="2"/>'),
        'tray_a': art(320, 400, tray(COLORS[0])),
        'tray_b': art(320, 400, tray(COLORS[1])),
        'gate': art(160, 26, gate('#a89bb6')),
        'gate_open': art(160, 26, gate('#ffca82')),
        'target': art(68, 68, '<circle cx="34" cy="34" r="19" fill="#22192f" stroke="#fff8d9" stroke-width="3"/>'
                              '<circle cx="34" cy="34" r="6" fill="#fff8d9"/>'),
    }
    types = {'gate': {'shape': 'image', 'width': 160, 'height': 26, 'asset': 'gate'}}
    for kind, width, height in [('core', 2, 2), ('wide', 2, 1), ('tall', 1, 2), ('chip', 1, 1)]:
        w, h = width * CELL - 6, height * CELL - 6
        assets[kind] = art(w, h, block(kind, w, h))
        types[kind] = {'shape': 'image', 'width': w, 'height': h, 'asset': kind}
    return {
        'format': 'buildplay-ui', 'version': 1, 'viewport': {'width': 700, 'height': 570, 'camera_controls': True},
        'boards': [
            {'id': 'mat', 'kind': 'zone', 'x': 0, 'y': 0, 'width': 700, 'height': 570,
             'background_asset': 'mat'},
            *[{'id': f'tray-{seat}', 'kind': 'free', 'x': 18 + 344 * seat, 'y': 111,
               'width': 320, 'height': 400, 'background_asset': asset}
              for seat, asset in enumerate(('tray_a', 'tray_b'))],
        ],
        'assets': assets, 'piece_types': types, 'strings': strings(0),
        'ui_code': f'const SOURCE_STRINGS = {json.dumps(strings(0), ensure_ascii=False)};\n'
                   + geometry + (DEST / 'escape_circuit.ui.js').read_text(),
    }


def illustration(state, caption):
    layout = ['<rect width="800" height="450" fill="#20152d"/>',
              '<path d="M240 18h320M240 432h320" stroke="#765386" stroke-width="2"/>',
              '<path d="M390 187h20m-20 76h20" stroke="#f0c4fd" stroke-width="3"/>',
              '<path d="M403 199l-15 28h11l-3 24 16-32h-11z" fill="#ff9658"/>']
    for seat, board in enumerate(state['boards']):
        color = COLORS[seat]
        layout.append(f'<g transform="translate({38+426*seat} 48) scale(.91)">')
        layout.append(f'<rect x="-11" y="-11" width="342" height="442" rx="18" fill="#33223f" stroke="{color}" stroke-width="2"/>')
        layout.append(tray(color))
        layout.append(f'<g transform="translate(80 400)">{gate(color)}</g>')
        for tile, (at, (width, height), kind) in enumerate(zip(board, SHAPES, TYPES)):
            y, x = divmod(at, 4)
            w, h = width * CELL - 6, height * CELL - 6
            layout.append(f'<g transform="translate({x*CELL+3} {y*CELL+3})">{block(kind, w, h)}</g>')
            last = state['last']
            if last and last['seat'] == seat and last['tile'] == tile:
                layout.append(f'<rect x="{x*CELL+3}" y="{y*CELL+3}" width="{w}" height="{h}" rx="12" fill="none" stroke="#fff5cb" stroke-width="4"/>')
        layout.append('</g>')
    return {'caption': caption, 'svg': svg(800, 450, ''.join(layout))}


def test_image(state, caption):
    content = ['<rect width="440" height="298" fill="#20152d"/>']
    for seat, board in enumerate(state['boards']):
        content.append(f'<g transform="translate({10+220*seat} 14)">')
        color = COLORS[seat]
        content.append(f'<rect width="208" height="260" rx="8" fill="#33223f" stroke="{color}"/>')
        content.append(f'<rect x="52" y="260" width="104" height="8" rx="3" fill="{color}"/>')
        for tile, (at, (width, height)) in enumerate(zip(board, SHAPES)):
            row, col = divmod(at, 4)
            fill = ('#ff9658' if tile == 0 else '#51c8cb' if tile < 3
                    else '#a994f6' if tile < 6 else '#f5d46d')
            content.append(f'<rect x="{52*col+2}" y="{52*row+2}" width="{52*width-4}" '
                           f'height="{52*height-4}" rx="7" fill="{fill}"/>')
        content.append('</g>')
    return {'caption': caption, 'svg': svg(440, 298, ''.join(content))}


def object_schema(**properties):
    return {'type': 'object', 'additionalProperties': False,
            'properties': properties, 'required': list(properties)}


def integer(low, high):
    return {'type': 'integer', 'minimum': low, 'maximum': high}


def fixed_array(size, items):
    return {'type': 'array', 'minItems': size, 'maxItems': size, 'items': items}


def schemas():
    move = object_schema(tile=integer(0, 9), to=integer(0, 19))
    state = object_schema(
        boards=fixed_array(2, {**fixed_array(10, integer(0, 19)), 'uniqueItems': True}),
        turn=integer(0, 1), round=integer(1, 60), winner={'enum': [None, -1, 0, 1]},
        last={'oneOf': [{'type': 'null'}, object_schema(seat=integer(0, 1), tile=integer(0, 9),
                **{'from': integer(0, 19), 'to': integer(0, 19)})]},
    )
    return {'state': state, 'move': move, 'view': state}


def approved_cases(code, game_schemas):
    logic = GameLogic(code, game_schemas=game_schemas)
    seed = 11
    ctx = {'players': [{'id': f'p{i}', 'kind': 'human', 'display_name': name,
                        'picture_url': '', 'max_loss': 5, 'active': True}
                       for i, name in enumerate(('Ada', 'Sam'))], 'pot': 10, 'move_count': 0}

    def case(kind, name, before, move, result, *, wrong_seat=False, error=False):
        seat = before['turn'] ^ wrong_seat
        return {'name': name, 'description': RULES[0], 'kind': kind, 'ctx': {**ctx, 'seed': seed},
                'state': before, 'view_of_mover': before, 'view_of_other': before,
                'player_id': f'p{seat}', 'other_player_id': f'p{1-seat}', 'move': move,
                'expected_state': result['state'], 'expected_turn': result['turn'],
                'expected_view_of_mover': result['state'], 'expected_view_of_other': result['state'],
                'images': [test_image(snapshot, caption)
                           for snapshot, caption in ((before, 'Mover before'), (before, 'Opponent before'),
                                                     (result['state'], 'Mover after'), (result['state'], 'Opponent after'))],
                **({'expected_payouts': result['payouts']} if 'payouts' in result else {}),
                **({'expected_error': 'InvalidMove', 'turn': result['turn']} if error else {})}

    position = logic.call('newMatch', ctx=ctx, seed=seed)
    assert position['state']['boards'][0] == position['state']['boards'][1] in STARTS
    initial_state = position['state']
    cases = []
    while position['turn'] is not None:
        before, pid = position['state'], position['turn'][0]
        move = logic.call('computerMove', before, pid, ctx=ctx, seed=seed)
        after = logic.call('applyMove', before, pid, move, ctx=ctx, seed=seed)
        if ctx['move_count'] == 0:
            cases.append(case('initial', 'The first slide only changes its own tray', before, move, after))
            assert before['boards'][1] == after['state']['boards'][1] and after['turn'] == ['p1']
            cases.append(case('intermediate', 'The other seat cannot slide out of turn', before, move,
                              position, wrong_seat=True, error=True))
            cases.append(case('intermediate', 'A core cannot jump to the gate', before, {'tile': 0, 'to': 13},
                              position, error=True))
        if before['turn'] == 0 and after['state']['boards'][0][0] == 13:
            cases.append(case('intermediate', 'The second player gets a final slide', before, move, after))
            assert after['turn'] == ['p1'] and after['state']['winner'] is None
        if after['turn'] is None:
            cases.append(case('terminal', 'Two escapes in the same round draw', before, move, after))
            assert after['state']['winner'] == -1 and after['payouts'] == {'p0': 5, 'p1': 5}
            miss = next(candidate for offset in range(60)
                        if (candidate := logic.call('randomMove', before, pid, ctx=ctx, seed=seed + offset)) != move)
            won = logic.call('applyMove', before, pid, miss, ctx=ctx, seed=seed)
            assert won['state']['winner'] == 0 and won['payouts'] == {'p0': 10}
            cases.append(case('terminal', 'Only one core escapes', before, miss, won))
        position = after
        ctx['move_count'] += 1
    cover = illustration(initial_state, 'Cover')
    artwork = [cover, illustration(cases[0]['expected_state'], 'Slide a block'),
               illustration(cases[3]['expected_state'], 'One more slide to tie'),
               illustration(cases[4]['expected_state'], 'Both cores reach the exit')]
    return cases, artwork


def main():
    geometry = (DEST / 'escape_circuit.geometry.js').read_text()
    guide = solution_guide()
    server = (f'const EC_STARTS = {json.dumps(STARTS)};\n'
              f'const EC_GUIDE = {json.dumps(guide, separators=(",", ":"))};\n'
              + geometry + (DEST / 'escape_circuit.server.js').read_text())
    game_schemas = schemas()
    cases, images = approved_cases(server, game_schemas)
    payload = {
        'name': TITLES[0], 'description': RULES[0], 'rules': RULES[0], 'ui_instructions': INSTRUCTIONS[0],
        'allowed_player_counts': [2], 'all_state_public': True,
        'allows_join_mid_match': False, 'allows_leave_mid_match': False,
        'server_code': server, 'declarative_ui': specification(geometry),
        'tutorial': {'text': RULES[0], 'html': '<meta name="viewport" content="width=device-width,initial-scale=1">'
                                              f'<p>{html.escape(RULES[0])}</p>'},
        'images': images,
        'unit_tests': {**{f'{key}_schema': value for key, value in game_schemas.items()}, 'cases': cases},
        'game_addition_request_id_and_secret': 'example-only-escape-circuit-replace-before-publishing',
        'translations': {locale: {
            'display_name': TITLES[i], 'short_description': RULES[i], 'game_logic_rules': RULES[i],
            'game_ui_rules': INSTRUCTIONS[i], 'tutorial_strings': {RULES[0]: RULES[i]}, 'client_strings': strings(i),
        } for i, locale in enumerate(LOCALES) if i},
    }
    (DEST / 'escape_circuit.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
