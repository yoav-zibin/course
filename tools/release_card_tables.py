"""Prepare or publish the ten reviewed editions, retaining existing game IDs.

Preparation is local. Publication uses the ordinary recorded authoring flow and
PATCH API. Credentials and resumable publication state must stay outside Git.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import secrets
import quickjs
import time
import urllib.request

from game_platform.agent_import import GameImport
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.game_contract import ContractLogic
from game_platform.game_traces import canonical_json
from game_platform.tools import publish_declarative_games as publisher

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = ROOT / 'games/declarative/card-table'
TARGETS = {
    'six-card-golf': 'c435beb6-12d7-427e-80ba-2ebb619cabfa',
    'war': '42d06892-449c-44d2-9251-7b9448ce4ddc',
    'crazy-eights': 'af765df8-d2c2-4074-959d-dbd1a6f0c621',
    'hearts': 'c5ef8730-9876-4874-8a4d-0cf4065d5a9c',
    'michigan': 'a6669442-7d52-40c4-ab67-aa515ccc7ec4',
    'quoridor': 'ef602ade-7aa1-472e-879f-5813291017e3',
    'concentration': None,
    'casino-war': '07415b38-c214-424a-9a38-a38bf7806c79',
    'old-maid': 'f6fd77da-3b3d-41b7-8bb0-b094f7a5ee73',
    'blackjack': 'f56aedfa-bc90-4b73-8bbc-e9706a444e71',
}


def trace_once(body, *, seed, mode, human_seat, num_players):
    # War intentionally derives its shuffle from roster IDs, so vary those
    # along with the numeric seed when selecting another complete test deal.
    players = [{'id': f'authoring-{seed}-seat-{i}',
                'kind': 'human' if mode != 'against_computers' or i == human_seat else 'computer',
                'display_name': f'Seat {i+1}', 'picture_url': '', 'max_loss': 0}
               for i in range(num_players)]
    ctx = {'players': players, 'pot': 0, 'move_count': 0}
    logic = ContractLogic(body.server_code, body.unit_tests, game_schemas=body.game_schemas())
    ui = DeclarativeLogic(body.declarative_ui)
    result = logic.call('newMatch', ctx=ctx, seed=seed)
    states, moves, observations, local = [result['state']], [], [], [None]*num_players
    for index in range(1000):
        if result['turn'] is None:
            break
        ctx['move_count'] = index
        seat = next(i for i, player in enumerate(players) if player['id'] == result['turn'][0])
        move = logic.call('computerMove', result['state'], players[seat]['id'], ctx=ctx, seed=seed+index)
        message = publisher.ui_message(logic, result, ctx, seat, seed+index)
        # A computer chooses through authoritative rules; only human seats send
        # UI events. In War the computer owns the automatic showdown continuation.
        if players[seat]['kind'] == 'human':
            frame = ui.reduce(message, local[seat])
            try:
                emitted = publisher.scene_event(ui, message, frame, move, budget=400)
            except ValueError:
                # Golf deliberately maps a hidden-card tap after a stock draw
                # to discard-and-reveal. A computer may instead recommend a
                # legal hidden replacement, which is not that human gesture.
                # Choose an actually offered human action and verify it below.
                frontier, seen = [frame], set()
                emitted = None
                for _ in range(3):
                    following = []
                    for candidate in frontier:
                        for event in publisher.offered_events(candidate['scene']):
                            answer = ui.reduce({'type': 'ui_event', 'event': event,
                                                'state_changed': message}, candidate.get('local_state'))
                            if answer.get('make_move') is not None:
                                emitted = answer
                                break
                            key = canonical_json(answer.get('local_state'))
                            if key not in seen:
                                seen.add(key)
                                following.append(answer)
                        if emitted is not None:
                            break
                    if emitted is not None:
                        break
                    frontier = following
                if emitted is None:
                    raise ValueError('No offered human action produces a move')
                move = emitted['make_move']
            local[seat] = emitted.get('local_state')
            assert canonical_json(emitted['make_move']) == canonical_json(move)
        observations.append({'state': result['state'], 'view': message['view'], 'move': move,
                             'move_number': index, 'player_index': seat})
        result = logic.call('applyMove', result['state'], players[seat]['id'], move,
                            ctx=ctx, seed=(seed+index) % 2**32)
        moves.append({'player_index': seat, 'move': move})
        states.append(result['state'])
    if result['turn'] is not None:
        raise ValueError('This deal did not finish within the authoring move limit')
    return {'players': players, 'pot': 0, 'match_seed': seed, 'states': states, 'moves': moves}, observations


def cached_trace(cache, kind, body, *, seed, mode, human_seat=None, num_players=None):
    identity = {'server': body.server_code, 'ui': body.declarative_ui,
                'seed': seed, 'mode': mode, 'human': human_seat, 'count': num_players}
    digest = hashlib.sha256(canonical_json(identity).encode()).hexdigest()
    path = cache / f'{kind}-{digest}.json'
    if path.exists():
        value = json.loads(path.read_text())
        return value['trace'], value['observations']
    candidates = range(1000) if kind == 'war' else range(20)
    for offset in candidates:
        candidate_seed = seed+offset*101
        if kind == 'war':
            # Select a naturally completed short War deal before performing the
            # slower schema/UI replay. This does not shorten or modify the game.
            players = [{'id': f'authoring-{candidate_seed}-seat-{i}',
                        'kind': 'human' if mode != 'against_computers' or i == human_seat else 'computer'}
                       for i in range(num_players)]
            js = quickjs.Context()
            js.set_time_limit(1)
            count = js.eval('class InvalidMove extends Error {};' + body.server_code +
                            ';(function(ctx){let r=game.newMatch(ctx),i=0;for(;i<350&&r.turn!==null;i++)'
                            '{ctx.move_count=i;r=game.applyMove(r.state,r.turn[0],game.computerMove(r.state,r.turn[0],ctx),ctx);}'
                            'return r.turn===null?i:-1;})(' + json.dumps({'players': players, 'pot': 0, 'move_count': 0}) + ')')
            if count < 0:
                continue
        try:
            trace, observations = trace_once(body, seed=candidate_seed, mode=mode,
                                             human_seat=human_seat, num_players=num_players)
            break
        except ValueError as exc:
            if 'authoring move limit' not in str(exc):
                raise
    else:
        raise RuntimeError(f'{kind}: no complete bounded trace found')
    path.write_text(json.dumps({'trace': trace, 'observations': observations}))
    return trace, observations


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--credential-file', type=Path)
    parser.add_argument('--state-file', type=Path)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--kinds', nargs='+', choices=TARGETS, default=list(TARGETS))
    parser.add_argument('--base-url', default='https://buildplay.fun')
    parser.add_argument('--renderer-commit', help='Exact deployed shared renderer revision required before any game write')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    publisher.PACKAGES = PACKAGES
    publisher.play_trace = lambda body, **kw: cached_trace(args.cache, current_kind, body, **kw)
    if not args.publish:
        evidence = []
        for current_kind in args.kinds:
            body = GameImport.model_validate(json.loads((PACKAGES/f'{current_kind}.json').read_text()))
            for i, (mode, count, seat) in enumerate(publisher.publication_configurations(body)):
                trace, _ = publisher.play_trace(body, seed=903+i, mode=mode,
                                                 human_seat=seat, num_players=count)
                evidence.append({'kind': current_kind, 'mode': mode, 'players': count,
                                 'human_seat': seat, 'moves': len(trace['moves'])})
                print(f'Prepared {current_kind}: {mode}, {count} players, seat {seat}, {len(trace["moves"])} moves', flush=True)
        args.report.write_text(json.dumps({'published': False, 'traces': evidence}, indent=2)+'\n')
        return
    if not args.credential_file or not args.state_file or not args.renderer_commit:
        parser.error('--publish requires --credential-file, --state-file and --renderer-commit')
    if args.state_file.resolve().is_relative_to(ROOT):
        parser.error('private state must be outside the checkout')
    master = args.credential_file.read_text().strip()
    state = json.loads(args.state_file.read_text()) if args.state_file.exists() else {'base_url': args.base_url, 'games': {}}
    if state['base_url'] != args.base_url:
        raise ValueError('Publication state belongs to a different server')
    evidence = []
    def read_target(ident):
        try:
            return publisher.request(args.base_url, f'/games/{ident}')
        except RuntimeError as exc:
            if 'HTTP 404' not in str(exc):
                raise
            return publisher.request(args.base_url, f'/legacy/games/{ident}')
    # Complete each master-authorized submission before starting the next one.
    # All credential-bearing authoring requests use POST JSON, never URL queries.
    for current_kind in args.kinds:
        entry = state['games'].setdefault(current_kind, {})
        ident = entry.get('id') or TARGETS[current_kind]
        secret = master if TARGETS[current_kind] else entry.setdefault('secret', secrets.token_urlsafe(32))
        package = json.loads((PACKAGES/f'{current_kind}.json').read_text())
        package['game_addition_request_id_and_secret'] = secret
        body = GameImport.model_validate(package)
        payload = body.model_dump(exclude_none=True)
        source_hash = hashlib.sha256(canonical_json(payload).encode()).hexdigest()
        current = read_target(ident) if ident else {}
        if current_kind in ('crazy-eights', 'hearts', 'quoridor') and current['server_code'] != body.server_code:
            raise RuntimeError(f'{current_kind}: current rules changed; reconcile before publication')
        if entry.get('source_hash') == source_hash and entry.get('published_game_hash') == hashlib.sha256(canonical_json(current).encode()).hexdigest():
            evidence.append(entry['evidence'])
            print(f'Already published {current_kind}: {ident} v{current["version"]}', flush=True)
            continue
        publisher.save_private(args.state_file, state)
        submitted = publisher.request(args.base_url, '/game-test/submissions',
                                      {'secret': secret, 'game_name': body.name, 'body': payload})
        common = {'secret': secret, 'submission_id': submitted['submission_id']}
        checked = publisher.request(args.base_url, '/game-test/server-check', common)
        if not checked.get('passed'):
            raise RuntimeError(f'{current_kind}: release server checks failed')
        sessions = []
        for i, (mode, count, seat) in enumerate(publisher.publication_configurations(body)):
            trace, observations = publisher.play_trace(body, seed=903+i, mode=mode,
                                                       human_seat=seat, num_players=count)
            config = {'num_players': count, 'resolution': publisher.RESOLUTIONS[i % len(publisher.RESOLUTIONS)]['label'],
                      'orientation': 'vertical' if i % 2 == 0 else 'horizontal', 'human_player_index': seat}
            record = {**common, 'mode': mode, 'config': config,
                      'session_id': f'card-table-{current_kind}-{secrets.token_hex(8)}'}
            verified = publisher.request(args.base_url, '/game-test/verify-match', {**record, **trace})
            if not verified.get('verified'):
                raise RuntimeError(f'{current_kind}: release trace verification failed')
            if mode == 'against_computers':
                observation = next(row for row in observations if row['player_index'] == seat)
                publisher.request(args.base_url, '/game-test/moves', {**record, **observation})
            sessions.append({'mode': mode, 'config': config, 'moves_verified': len(trace['moves'])})
            print(f'Recorded {current_kind}: {mode}, {count} players, seat {seat}', flush=True)
        for attempt in range(90):
            with urllib.request.urlopen(args.base_url+'/static/app/version.json', timeout=30) as response:
                deployed = json.load(response)
            if deployed.get('commit') == args.renderer_commit:
                break
            if attempt % 6 == 0:
                print('Waiting for the tested shared renderer deployment before publishing games.', flush=True)
            time.sleep(10)
        else:
            raise RuntimeError('Required renderer is not deployed; no game write was attempted')
        if ident:
            if read_target(ident)['version'] != current['version']:
                raise RuntimeError('Target changed during authoring; review before retrying')
            mapping = {'rules': 'game_logic_rules', 'ui_instructions': 'game_ui_rules'}
            patch = {key: value for key, value in payload.items()
                     if key == 'game_addition_request_id_and_secret'
                     or key not in current and key not in mapping
                     or value != current.get(mapping.get(key, key))}
            # The API itself requires and verifies completion for the exact
            # merged payload. No synthetic status or bypass is used here.
            game = publisher.request(args.base_url, f'/games/{ident}', patch, method='PATCH')
        else:
            try:
                game = publisher.request(args.base_url, '/games/declarative', payload)
            except publisher.ExistingPublication as existing:
                # A lost creation response must recover its ID, never duplicate it.
                game = read_target(existing.existing_game_id)
                if game['declarative_ui'] != body.declarative_ui:
                    raise RuntimeError('Recovered creation differs from the reviewed payload')
        ident = game['id']
        entry.update(id=ident, version=game['version'], source_hash=source_hash,
                     published_game_hash=hashlib.sha256(canonical_json(game).encode()).hexdigest())
        proof = {'kind': current_kind, 'id': ident, 'name': game['name'], 'version': game['version'],
                 'renderer_type': game['renderer_type'], 'authoring_complete': True,
                 'verified_sessions': sessions, 'link': f'{args.base_url}/portal#game={ident}'}
        entry['evidence'] = proof
        publisher.save_private(args.state_file, state)
        fresh = publisher.request(args.base_url, f'/games/{ident}')
        if fresh['declarative_ui'] != body.declarative_ui or fresh['server_code'] != body.server_code:
            raise RuntimeError('Published payload readback differs from reviewed content')
        evidence.append(proof)
        args.report.write_text(json.dumps({'base_url': args.base_url, 'games': evidence}, indent=2)+'\n')
        print(f'Published {current_kind}: {ident} v{game["version"]}', flush=True)
    args.report.write_text(json.dumps({'base_url': args.base_url, 'games': evidence}, indent=2)+'\n')


if __name__ == '__main__':
    main()
