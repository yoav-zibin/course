"""Schema and approved-example validation shared by runtime and guided builds."""
from jsonschema import Draft202012Validator
from game_platform.game_logic import GameLogic, GameLogicError, InvalidMoveError


class ContractLogic(GameLogic):
    def __init__(self, code, contract):
        super().__init__(code)
        self.contract = contract
        self.validators = {key:Draft202012Validator(contract[key]) for key in ('state_schema','view_schema','move_schema')}

    def check(self, schema, value, *, move=False):
        error = next(self.validators[schema].iter_errors(value), None)
        if error:
            exception = InvalidMoveError if move else GameLogicError
            raise exception(f'{schema}: {error.message}')

    def call(self, function, *args, **kwargs):
        if args and function != 'newMatch': self.check('state_schema', args[0])
        if function == 'applyMove': self.check('move_schema', args[2], move=True)
        result = super().call(function, *args, **kwargs)
        if function == 'viewFor': self.check('view_schema', result)
        elif function in ('computerMove','randomMove') and result is not None: self.check('move_schema', result)
        elif isinstance(result, dict) and 'state' in result: self.check('state_schema', result['state'])
        return result


class _RandomExample(Exception):
    """The illustrated outcome depends on a random draw."""


def verify_examples(code, contract):
    logic = ContractLogic(code, contract)
    results = []
    for case in contract['cases']:
        try:
            ctx = {k:v for k,v in case['ctx'].items() if k != 'seed'}
            seed = case['ctx']['seed']
            def call(fn, *args):
                first = logic.call(fn,*args,ctx=ctx,seed=seed)
                random_draw = logic.last_call_used_random and fn in ('newMatch','applyMove')
                second = logic.call(fn,*args,ctx=ctx,seed=seed)
                if first != second: raise GameLogicError(f'{fn} is not deterministic')
                if random_draw: raise _RandomExample(fn)
                return first
            if case['kind'] == 'initial':
                if call('newMatch')['state'] != case['state']: raise GameLogicError('Initial state differs')
            for who, key in [('player_id','view_of_mover'),('other_player_id','view_of_other')]:
                if call('viewFor',case['state'],case[who]) != case[key]: raise GameLogicError(f'{key} differs')
            if 'expected_error' in case:
                # A negative example passes only on the typed rejection, not
                # on an arbitrary exception (a game bug) or a silently
                # accepted move. Run it twice, like every other call, so a
                # non-deterministic rejection also fails.
                if case['expected_error'] != 'InvalidMove':
                    raise GameLogicError(f"Unknown expected_error {case['expected_error']!r}")
                for _ in range(2):
                    try:
                        logic.call('applyMove',case['state'],case['player_id'],case['move'],ctx=ctx,seed=seed)
                    except InvalidMoveError:
                        pass
                    else:
                        raise GameLogicError('Expected InvalidMove, but the move was accepted')
                # The match did not advance: every player's view of the
                # unchanged state must still be the before/expected view.
                for who, key in [('player_id','view_of_mover'),('other_player_id','view_of_other')]:
                    if call('viewFor',case['state'],case[who]) != case[key]:
                        raise GameLogicError('Rejected move changed the player view')
                results.append({'name':case['name'],'passed':True,'expected_error':'InvalidMove'})
                continue
            result = call('applyMove',case['state'],case['player_id'],case['move'])
            for actual, expected in [('state','expected_state'),('turn','expected_turn')]:
                if result.get(actual) != case[expected]: raise GameLogicError(f'{expected} differs')
            if 'expected_payouts' in case and result.get('payouts') != case['expected_payouts']: raise GameLogicError('Payouts differ')
            ctx = {**ctx, 'move_count':ctx.get('move_count', 0) + 1}
            for who, key in [('player_id','expected_view_of_mover'),('other_player_id','expected_view_of_other')]:
                if call('viewFor',result['state'],case[who]) != case[key]: raise GameLogicError(f'{key} differs')
            results.append({'name':case['name'],'passed':True})
        except _RandomExample as exc:
            results.append({'name':case['name'],'passed':True,'random_outcome':str(exc),'detail':'Determinism checked; illustrated random outcome skipped'})
        except Exception as exc:
            results.append({'name':case['name'],'passed':False,'error':str(exc)})
    return results


def probe_leaving(code, contract, *, allowed_player_counts, allows_leave_mid_match):
    """Deterministic leaving/settlement scenarios for a generated server.

    Random walks only ever leave with an active human in an ongoing match,
    so whole classes of leaving bugs (a duplicate leave re-settling the
    match, a spectator ending it, payouts recomputed after the end) were
    previously gated only by AI review. These probes exercise them with
    scripted rosters and pots and return failure strings; an empty list
    means every scenario behaved as the platform contract requires."""
    logic = ContractLogic(code, contract)
    if not logic.has('playerLeft'):
        return []
    failures = []

    def player(pid, kind, *, active=None):
        entry = {'id': pid, 'kind': kind, 'display_name': pid, 'picture_url': '', 'max_loss': 0}
        if active is not None:
            entry['active'] = active
        return entry

    def make_ctx(players, pot, move_count=0):
        return {'players': [dict(p) for p in players], 'pot': pot, 'move_count': move_count}

    def paid(result):
        return sum((result.get('payouts') or {}).values())

    def start(players, pot, label):
        try:
            result = logic.call('newMatch', ctx=make_ctx(players, pot), seed=4242, time_limit_seconds=2.0)
            return result['state'], result['turn']
        except Exception as exc:
            failures.append(f'{label}: newMatch failed: {exc}')
            return None, None

    def leave(state, who, players, pot, label, move_count=0):
        try:
            return logic.call('playerLeft', state, who, ctx=make_ctx(players, pot, move_count),
                              seed=4243, time_limit_seconds=2.0)
        except Exception as exc:
            failures.append(f'{label}: playerLeft raised: {exc}')
            return None

    def advance(state, turn, players, pot):
        """Best-effort walk to a mid-game state; None when unreachable."""
        generator = 'randomMove' if logic.has('randomMove') else 'computerMove' if logic.has('computerMove') else None
        if generator is None or not turn:
            return None
        current_state, current_turn = state, turn
        for step in range(5):
            if not current_turn:
                return None
            mover = current_turn[0]
            ctx = make_ctx(players, pot, step)
            try:
                move = logic.call(generator, current_state, mover, ctx=ctx, seed=5000 + step)
                following = logic.call('applyMove', current_state, mover, move, ctx=ctx, seed=5000 + step)
            except Exception:
                return None
            current_state, current_turn = following['state'], following['turn']
        return (current_state, current_turn) if current_turn else None

    def expect_noop(label, result, state, turn):
        if result is None:
            return
        if result['state'] != state:
            failures.append(f'{label}: the leave changed the state; it must change nothing')
        if result['turn'] != turn:
            failures.append(f'{label}: the leave changed the turn; it must change nothing')
        if paid(result) != 0:
            failures.append(f'{label}: the leave paid out tokens; it must pay nothing')

    two_humans = [player('human-1', 'human'), player('human-2', 'human')]

    # A leave from an ID that holds no seat is a no-op, from the initial
    # state and from a mid-game state alike.
    state, turn = start(two_humans, 10, 'non-seat leave')
    if state is not None:
        expect_noop('non-seat leave', leave(state, 'spectator-1', two_humans, 10, 'non-seat leave'), state, turn)
        mid = advance(state, turn, two_humans, 10)
        if mid is not None:
            expect_noop('non-seat leave (mid-game)', leave(mid[0], 'spectator-1', two_humans, 10, 'non-seat leave (mid-game)'), mid[0], mid[1])

    # A leave that leaves fewer than two active humans ends the match and
    # conserves the pot; afterwards every further leave — by the other
    # player or a duplicate by the (now inactive) leaver — returns the
    # recorded state and identical payouts instead of re-settling.
    def forfeit(players, pot, leaver, label):
        state, turn = start(players, pot, label)
        if state is None:
            return
        result = leave(state, leaver, players, pot, label)
        if result is None:
            return
        if result['turn'] is not None:
            failures.append(f'{label}: the match must end when fewer than two active humans remain, but playerLeft returned a turn')
            return
        if paid(result) != pot:
            failures.append(f'{label}: final payouts add up to {paid(result)}, not the pot of {pot}')
            return
        # Only still-active players can leave an ended match: the platform
        # marks the leaver inactive, and its own result validator rejects
        # terminal payouts naming inactive players (even a zero entry), so
        # a duplicate leave by the (now inactive) leaver is outside the
        # call contract. For the same reason the recorded payouts can only
        # be re-reported verbatim when they name still-active players
        # alone; when they also paid the departed player, that share was
        # settled when the match ended and may only be folded into the
        # remaining players' reported amounts, never reduce them.
        after = [dict(p, active=False) if p['id'] == leaver else dict(p) for p in players]
        recorded = result.get('payouts') or {}
        still_active = {p['id'] for p in after if p['kind'] == 'human' and p.get('active', True)}
        for other in players:
            if other['id'] == leaver:
                continue
            again = leave(result['state'], other['id'], after, pot, label + ' (after the end)')
            if again is None:
                continue
            if again['turn'] is not None or again['state'] != result['state']:
                failures.append(f'{label}: a leave after the match ended must return the recorded state unchanged and a null turn; settlement is computed once and never recomputed')
            elif set(recorded) <= still_active:
                if again.get('payouts') != recorded:
                    failures.append(f'{label}: a leave after the match ended must return the recorded payouts identically; settlement is computed once and never recomputed')
            else:
                reported = again.get('payouts') or {}
                for pid, amount in recorded.items():
                    if pid in still_active and reported.get(pid, 0) < amount:
                        failures.append(f'{label}: a leave after the match ended reduced the recorded payout of still-active {pid}; recorded amounts for still-active players never decrease')
                        break

    forfeit(two_humans, 10, 'human-1', 'two-human forfeit')

    # Against a computer the forfeit winner is the computer seat, which is
    # never payable: the only eligible payee is the departing human, so the
    # whole pot goes to them.
    mixed = [player('human-1', 'human'), player('computer-1', 'computer')]
    if logic.has('computerMove') or logic.has('randomMove'):
        state, turn = start(mixed, 25, 'human-vs-computer forfeit')
        if state is not None:
            result = leave(state, 'human-1', mixed, 25, 'human-vs-computer forfeit')
            if result is not None:
                if result['turn'] is not None:
                    failures.append('human-vs-computer forfeit: the match must end when the only human leaves, but playerLeft returned a turn')
                elif result.get('payouts') != {'human-1': 25}:
                    failures.append(f"human-vs-computer forfeit: payouts must be exactly {{'human-1': 25}} (the computer seat is never payable and the departing human is still active), got {result.get('payouts')}")

    # A solo player leaving ends the match and, as the only eligible
    # payee, receives the pot.
    if 1 in allowed_player_counts:
        forfeit([player('human-1', 'human')], 10, 'human-1', 'solo leave')

    # With three or more humans a leave can continue the match: the turn
    # must exclude the leaver, and a duplicate leave by the now-inactive
    # leaver is then a no-op.
    if allows_leave_mid_match and any(count >= 3 for count in allowed_player_counts):
        trio = [player(f'human-{n}', 'human') for n in (1, 2, 3)]
        state, turn = start(trio, 30, 'continuing leave')
        if state is not None:
            result = leave(state, 'human-1', trio, 30, 'continuing leave')
            if result is not None:
                if result['turn'] is None:
                    failures.append('continuing leave: the match ended although two active humans remain and the game allows leaving mid-match')
                elif 'human-1' in result['turn']:
                    failures.append('continuing leave: the returned turn still contains the departing player')
                else:
                    after = [dict(p, active=False) if p['id'] == 'human-1' else dict(p) for p in trio]
                    expect_noop('duplicate leave', leave(result['state'], 'human-1', after, 30, 'duplicate leave'), result['state'], result['turn'])
    return failures


def sampled_positions(server, contract, rules):
    """Use actual legal moves to obtain additional player and spectator views."""
    logic = ContractLogic(server, contract)
    samples = []
    for index,count in enumerate(sorted(set([min(rules.allowed_player_counts),max(rules.allowed_player_counts)]))):
        for mixed in ([False,True] if count>1 else [False]):
            players = [{'id':f'p{n}', 'kind':'computer' if mixed and n else 'human',
                        'max_loss':0,'display_name':f'Player {n+1}','picture_url':''} for n in range(count)]
            ctx = {'players':players,'pot':0,'move_count':0}
            seed = 716 + index + int(mixed)
            current = logic.call('newMatch',ctx=ctx,seed=seed)
            sample = None
            for turn_number in range(4):
                if not current['turn']: break
                mover = current['turn'][0]
                generator = 'randomMove' if logic.has('randomMove') else 'computerMove'
                if not logic.has(generator): break
                state = current['state']
                move = logic.call(generator,state,mover,ctx=ctx,seed=seed+turn_number)
                following = logic.call('applyMove',state,mover,move,ctx=ctx,seed=seed+turn_number)
                next_ctx = {**ctx,'move_count':turn_number+1}
                sample = {'name':f'Walk {count} players, {"mixed" if mixed else "human"} roster',
                          'ctx':{**ctx,'seed':seed+turn_number},'state':state,'player_id':mover,'other_player_id':None,
                          'expected_state':following['state'],'expected_turn':following['turn'], 'turn':current['turn']}
                for who,label in ((mover,'mover'),(None,'other')):
                    sample['view_of_'+label]=logic.call('viewFor',state,who,ctx=ctx,seed=seed)
                    sample['expected_view_of_'+label]=logic.call('viewFor',following['state'],who,ctx=next_ctx,seed=seed)
                current,ctx=following,next_ctx
            if sample is not None: samples.append(sample)
    return samples


def verify_browser_moves(server, contract, cases, screenshots):
    logic = ContractLogic(server, contract)
    for shot in screenshots:
        moves = shot.pop('emittedMoves', [])
        if not moves: continue
        case = cases[shot['caseIndex']]
        after = shot['view'].startswith('expected')
        who = case['other_player_id'] if 'other' in shot['view'] else case['player_id']
        turn = case['expected_turn'] if after else case.get('turn',[case['player_id']])
        if who is None or who not in (turn or []):
            raise RuntimeError('UI verification failed: client submitted a move out of turn')
        ctx = {k:v for k,v in case['ctx'].items() if k!='seed'}
        # A rejected move does not advance the match, so its "expected"
        # view is still at the before move_count.
        ctx['move_count'] += int(after and not case.get('expected_error'))
        for move in moves:
            try:
                logic.call('applyMove',case['expected_state' if after else 'state'],who,move,ctx=ctx,seed=case['ctx']['seed'])
            except (InvalidMoveError, GameLogicError) as exc:
                raise RuntimeError('UI verification failed: client submitted an illegal move: '+str(exc)) from exc
