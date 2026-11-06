"""Replay downloaded game pairs locally; never writes to the live service.

PYTHONPATH=.. python game_platform/scripts/audit-game-batch.py snapshot.json report.json
Add --assets game_platform/games/audit-batch3 to test the reviewed patched pairs.
The shipped games/audit-batch3/manifest.json also works directly as the snapshot.
"""
import argparse
import copy
import datetime as dt
import json
from pathlib import Path

from game_platform.game_logic import GameLogic, InvalidMoveError

NOW = dt.datetime(2026, 11, 5, tzinfo=dt.timezone.utc)


def leaves(value, path=()):
    if isinstance(value, dict):
        for key, item in value.items():
            yield from leaves(item, path + (key,))
    elif isinstance(value, list):
        for key, item in enumerate(value):
            yield from leaves(item, path + (key,))
    else:
        yield path


def run(games):
    results = []
    for game in games:
        for count in game['allowed_player_counts']:
            for seed in (11, 29):
                for method in ('randomMove', 'computerMove'):
                    ctx = {'players': [{'id': f'p{i}', 'kind': 'human', 'max_loss': 10}
                                       for i in range(count)], 'pot': count * 10, 'move_count': 0}
                    logic = GameLogic(
                        game['server_code'],
                        game_schemas=game['game_schemas'],
                        game_id=game['id'],
                        game_version=game['version'],
                    )
                    row = {'id': game['id'], 'name': game['name'], 'players': count,
                           'seed': seed, 'method': method, 'calls': 0, 'fuzz_calls': 0,
                           'determinism_checks': 0, 'fuzz_errors': []}
                    def call(function, *args):
                        row['calls'] += 1
                        return logic.call(function, *args, ctx=ctx,
                                          seed=seed + ctx['move_count'], now=NOW)
                    try:
                        current = call('newMatch')
                        for step in range(2000):
                            for player in [p['id'] for p in ctx['players']] + [None]:
                                view = call('viewFor', current['state'], player)
                                if step < 3:
                                    assert view == call('viewFor', current['state'], player), 'view nondeterminism'
                                    row['determinism_checks'] += 1
                            if current['turn'] is None:
                                row['status'] = 'terminal'
                                break
                            actor = current['turn'][0]
                            move = call(method, current['state'], actor)
                            if step < 3:
                                assert move == call(method, current['state'], actor), 'generator nondeterminism'
                                expected = call('applyMove', current['state'], actor, move)
                                assert expected == call('applyMove', current['state'], actor, move), 'transition nondeterminism'
                                row['determinism_checks'] += 2
                            # Only fuzz the first path/mode, keeping counts comparable between releases.
                            if seed == 11 and method == 'randomMove' and step < 5:
                                for path in list(leaves(move))[:12]:
                                    for value in (None, {}, [], 0.5, '0', 1000000000, -1):
                                        bad = copy.deepcopy(move)
                                        if path:
                                            parent = bad
                                            for key in path[:-1]:
                                                parent = parent[key]
                                            parent[path[-1]] = value
                                        else:
                                            bad = value
                                        row['fuzz_calls'] += 1
                                        try:
                                            call('applyMove', current['state'], actor, bad)
                                        except InvalidMoveError:
                                            pass
                                        except Exception as error:
                                            message = str(error)
                                            if not any(x['error'] == message for x in row['fuzz_errors']):
                                                row['fuzz_errors'].append({'error': message, 'move': bad,
                                                                          'state': current['state'], 'ctx': copy.deepcopy(ctx)})
                            current = call('applyMove', current['state'], actor, move)
                            ctx['move_count'] += 1
                        else:
                            row['status'] = 'step_limit'
                        if current['turn'] is None and 'payouts' in current:
                            assert sum(current['payouts'].values()) == ctx['pot'], 'pot not conserved'
                    except Exception as error:
                        row.update(status='error', error=str(error))
                    row['moves'] = ctx['move_count']
                    results.append(row)
                    print(game['name'], count, seed, method, row['status'], row['moves'],
                          'fuzz_errors', len(row['fuzz_errors']), flush=True)
    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('report', type=Path)
    parser.add_argument('--assets', type=Path)
    args = parser.parse_args()
    games = json.loads(args.snapshot.read_text())
    if games and 'server_code' not in games[0] and 'server' in games[0]:
        for game in games:
            game['server_code'] = (args.snapshot.parent / game['server']).read_text()
            game['code'] = (args.snapshot.parent / game['client']).read_text()
    if args.assets:
        manifest = {x['id']: x for x in json.loads((args.assets / 'manifest.json').read_text())}
        for game in games:
            if game['id'] in manifest:
                entry = manifest[game['id']]
                game['server_code'] = (args.assets / entry['server']).read_text()
                game['code'] = (args.assets / entry['client']).read_text()
    results = run(games)
    args.report.write_text(json.dumps(results, indent=2))
    raise SystemExit(1 if any(x['status'] == 'error' or x['fuzz_errors'] for x in results) else 0)
