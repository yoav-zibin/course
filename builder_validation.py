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


def verify_examples(code, contract):
    logic = ContractLogic(code, contract)
    results = []
    for case in contract['cases']:
        try:
            ctx = {k:v for k,v in case['ctx'].items() if k != 'seed'}
            seed = case['ctx']['seed']
            def call(fn, *args):
                first = logic.call(fn,*args,ctx=ctx,seed=seed)
                second = logic.call(fn,*args,ctx=ctx,seed=seed)
                if first != second: raise GameLogicError(f'{fn} is not deterministic')
                return first
            if case['kind'] == 'initial':
                if call('newMatch')['state'] != case['state']: raise GameLogicError('Initial state differs')
            for who, key in [('player_id','view_of_mover'),('other_player_id','view_of_other')]:
                if call('viewFor',case['state'],case[who]) != case[key]: raise GameLogicError(f'{key} differs')
            result = call('applyMove',case['state'],case['player_id'],case['move'])
            for actual, expected in [('state','expected_state'),('turn','expected_turn')]:
                if result.get(actual) != case[expected]: raise GameLogicError(f'{expected} differs')
            if 'expected_payouts' in case and result.get('payouts') != case['expected_payouts']: raise GameLogicError('Payouts differ')
            ctx = {**ctx, 'move_count':ctx.get('move_count', 0) + 1}
            for who, key in [('player_id','expected_view_of_mover'),('other_player_id','expected_view_of_other')]:
                if call('viewFor',result['state'],case[who]) != case[key]: raise GameLogicError(f'{key} differs')
            results.append({'name':case['name'],'passed':True})
        except Exception as exc:
            results.append({'name':case['name'],'passed':False,'error':str(exc)})
    return results
