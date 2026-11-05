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
