import copy
from dataclasses import replace
import pytest
from game_platform import builder_flow as flow
from game_platform.models import GameRules
from game_platform.service import GamePlatform, ConflictError, InvalidRequestError
from game_platform.store import InMemoryStore
from game_platform.json_file_store import write_snapshot, read_snapshot
from game_platform.tests.test_game_drafts import create_draft


def draft():
    p=GamePlatform()
    u=p.create_user(display_name='Designer')
    d=p.save_game_draft(caller_id=u.id,draft_id=None,name='',description='',rules=GameRules(allowed_player_counts=(2,),allows_leave_mid_match=False,allows_join_mid_match=False),code='',expected_revision=None)
    return replace(d,builder_workflow=flow.initial())


def test_order_approval_history_and_invalidation():
    d=draft()
    with pytest.raises(ConflictError): flow.propose(d,'identity',{},'','')
    d=flow.propose(d,'understanding',{'text':'Chess','questions':[]},'A chess game')
    d=flow.approve(d,'understanding')
    d=flow.propose(d,'identity',{'display_name':'Chess','short_description':'A game'},'Name')
    d=flow.approve(d,'identity')
    changed=flow.propose(d,'understanding',{'text':'Backwards chess','questions':[]},'Revised')
    assert changed.builder_workflow['artifacts']['identity']['status']=='stale'
    assert d.builder_workflow['artifacts']['identity']['status']=='approved'
    assert changed.builder_workflow['history'][0]['value']['text']=='Chess'
    with pytest.raises(ConflictError): flow.approve(changed,'identity')


def test_unanswered_questions_cannot_be_approved():
    d=flow.propose(draft(),'understanding',{'text':'Chess','questions':['Which variant?']},'Question')
    with pytest.raises(InvalidRequestError): flow.approve(d,'understanding')


def test_reject_remote_schema_and_unsafe_images():
    with pytest.raises(InvalidRequestError):flow.validate_schema({'$ref':'https://example.com/secret'})
    with pytest.raises(InvalidRequestError):flow.validate_image({'caption':'x','svg':'<svg><script>alert(1)</script></svg>'})
    flow.validate_image({'caption':'Board','svg':'<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'})


def test_workflow_round_trips_file_store(tmp_path):
    store=InMemoryStore(); d=draft();store.put_game_draft(d)
    path=tmp_path/'data.json';write_snapshot(path,store.snapshot())
    assert read_snapshot(path).game_drafts[0].builder_workflow==d.builder_workflow


def test_workflow_endpoints_owner_revision_and_publish_gate(api):
    owner,other=api.new_user('owner'),api.new_user('other')
    d=create_draft(api,owner)
    url=f'/game-drafts/{d["id"]}/workflow/initialize'
    body={'expected_revision':d['revision']}
    assert api.request('POST',url,as_user=other,json=body).status_code==404
    first=api.ok('POST',url,as_user=owner,json=body)
    assert first['builder_workflow']['language']=='en'
    assert api.request('POST',url,as_user=owner,json=body).status_code==409
    assert api.request('POST',f'/game-drafts/{d["id"]}/publish',as_user=owner,json={'expected_revision':first['revision']}).status_code==409
    assert api.request('POST',f'/game-drafts/{d["id"]}/workflow/approve',as_user=owner,json={'expected_revision':first['revision']}).status_code==409


def test_generation_uses_saved_approval_and_no_fake_success_without_provider(api,monkeypatch):
    monkeypatch.delenv('MUSE_SPARK_API_KEY',raising=False)
    owner=api.new_user('owner');d=create_draft(api,owner)
    path=f'/game-drafts/{d["id"]}/workflow/'
    d=api.ok('POST',path+'initialize',as_user=owner,json={'expected_revision':d['revision']})
    result=api.request('POST',path+'propose',as_user=owner,json={'expected_revision':d['revision'],'text':'Chess'})
    assert result.status_code==503
    saved=api.ok('GET',f'/game-drafts/{d["id"]}',as_user=owner)
    assert saved['builder_workflow']['artifacts']=={}


def fixture():
    import json
    from pathlib import Path
    return json.loads((Path(__file__).parent/'fixtures/guided-counter.json').read_text())


def approved_draft():
    d=draft()
    values={
      'understanding':{'text':'Count to three','questions':[]},
      'identity':{'display_name':'Count to three','short_description':'Reach three by adding one.'},
      'logic':{'text':'One player adds one each turn, starting at zero. End at three. No stakes, joining or leaving.', 'allowed_player_counts':[1],'allows_join_mid_match':False,'allows_leave_mid_match':False},
      'ui':{'text':'A count and Add one button; readable on phones. Use a calm blue theme.'},
      'tutorial':{'text':'Add one until three.', 'html':'<meta name="viewport" content="width=device-width"><h1>How to play</h1><p>Add one each turn. Reach three to win.</p>'},
      'images':{'images':[{'caption':'Cover','svg':'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><circle cx="80" cy="45" r="30"/></svg>'},*fixture()['contract']['cases'][0]['images'][:3]]},
      'tests':fixture()['contract']}
    for step in flow.STEPS:
        d=flow.approve(flow.propose(d,step,values[step],'Proposed'),step)
    return d


def test_approved_examples_and_schema_runtime_reject_illegal_move():
    from game_platform.builder_validation import verify_examples,ContractLogic
    from game_platform.game_logic import InvalidMoveError,GameLogicError
    f=fixture();flow.validate_artifact('tests',f['contract'])
    results=verify_examples(f['server_code'],f['contract'])
    assert all(r['passed'] for r in results),results
    logic=ContractLogic(f['server_code'],f['contract'])
    with pytest.raises(InvalidMoveError):logic.call('applyMove',{'n':0},'u1',{'add':2},ctx={'players':[]})
    with pytest.raises(GameLogicError):logic.call('viewFor',{'n':99},'u1')


def test_build_job_persists_ready_code_and_does_not_publish(monkeypatch):
    import json
    from game_platform.builder_jobs import run_build
    from game_platform import builder_render
    f=fixture();d=flow.begin_build(approved_draft());store=InMemoryStore();store.put_game_draft(d)
    platform=GamePlatform(store=store)
    # Ownership lookup needs the user record; make it match the draft owner.
    user=platform.create_user(display_name='Builder');store.put_user(replace(user,id=d.owner_user_id))
    class Model:
        def chat(self,messages,**kwargs):
            return json.dumps({'passed':True,'issues':[]}) if 'Review game server' in messages[0]['content'] or isinstance(messages[0]['content'],list) else json.dumps({'code':f['code'],'server_code':f['server_code']})
    monkeypatch.setattr('game_platform.builder_visual.review_views',lambda *args:[])
    monkeypatch.setattr(builder_render,'render_game',lambda *args,**kwargs:[])
    run_build(platform,Model(),d.owner_user_id,d.id,d.builder_workflow['job']['id'])
    saved=platform.get_game_draft(caller_id=d.owner_user_id,draft_id=d.id)
    assert saved.builder_workflow['job']['status']=='ready_for_review',saved.builder_workflow['job']
    assert saved.code==f['code']
    assert store.get_game(d.id) is None
    with pytest.raises(ConflictError):flow.require_publishable(saved)


def test_cancellation_and_code_changes_block_publish():
    d=flow.begin_build(approved_draft())
    with pytest.raises(ConflictError):flow.propose(d,'understanding',{'text':'Different'},'Changed')
    d.builder_workflow['job']['status']='ready'
    d.builder_workflow['job']['code_digest']=flow.digest(['verified','server'])
    d.builder_workflow['final_approval']=d.builder_workflow['job']['id']
    with pytest.raises(ConflictError):flow.require_publishable(d)


def test_approved_metadata_cannot_be_changed_through_legacy_editor():
    d=approved_draft()
    identity=d.builder_workflow['artifacts']['identity']['value']
    d=replace(d,name=identity['display_name'],description=identity['short_description'],
              rules=GameRules(allowed_player_counts=(1,),allows_join_mid_match=False,allows_leave_mid_match=False))
    flow.verify_approved_content(d)
    for changed in (replace(d,name='Other game'),replace(d,description='Different rules'),
                    replace(d,rules=replace(d.rules,allows_join_mid_match=True))):
        with pytest.raises(ConflictError):flow.verify_approved_content(changed)


def test_games_test_rechecks_saved_approved_examples():
    d=approved_draft();store=InMemoryStore();store.put_game_draft(d)
    platform=GamePlatform(store=store)
    broken=fixture()['server_code'].replace('n:0','n:1').replace('n: 0','n: 1')
    assert broken != fixture()['server_code']
    report=platform.test_game_code(server_code=broken,rules=d.rules,game_id=d.id)
    assert not report.passed
    assert report.failures[0].function=='approved_example'


def test_tutorial_is_required_and_earlier_edits_invalidate_it():
    d=approved_draft()
    del d.builder_workflow['artifacts']['tutorial']
    with pytest.raises(ConflictError):flow.begin_build(d)
    with pytest.raises(ConflictError):flow.approve(d,'images')
    d=approved_draft()
    revised=flow.propose(d,'ui',{'text':'Use larger text and a different board layout.'},'Updated UI')
    assert revised.builder_workflow['artifacts']['tutorial']['status']=='stale'
    assert revised.builder_workflow['artifacts']['tests']['status']=='stale'


def test_tutorial_validation_and_language_registry():
    from game_platform.i18n import LOCALE_CODES
    assert flow.LANGUAGES == LOCALE_CODES
    with pytest.raises(InvalidRequestError):flow.validate_artifact('tutorial',{'text':'Help','html':'<h1>Help</h1>'})
    flow.validate_artifact('tutorial',approved_draft().builder_workflow['artifacts']['tutorial']['value'])


def test_guided_client_uses_platform_translation_api():
    from game_platform import game_text
    code=fixture()['code']
    assert game_text.extract_strings(code)=={'title':'Count to three','add':'Add one'}
    assert game_text.lint(code)==[]
    assert 'applyLocale(m)' in code


def test_verification_registry_accepts_additional_checks(monkeypatch):
    from game_platform import builder_checks
    seen=[]
    def extra(code, server, spec, rules):
        seen.append(code)
        return {'passed':False, 'details':'Custom invariant failed'}
    monkeypatch.setattr(builder_checks,'CHECKS',(('custom_invariant',extra),))
    result=builder_checks.run_checks('client','server',{},None)
    assert seen==['client']
    assert result['custom_invariant']['passed'] is False


def test_server_review_failure_repairs_code_before_ready(monkeypatch):
    import json
    from game_platform.builder_jobs import run_build
    from game_platform import builder_render
    f=fixture(); d=flow.begin_build(approved_draft()); store=InMemoryStore(); store.put_game_draft(d)
    platform=GamePlatform(store=store)
    user=platform.create_user(display_name='Builder');store.put_user(replace(user,id=d.owner_user_id))
    class Model:
        generations=0
        reviews=0
        def chat(self,messages,**kwargs):
            if isinstance(messages[0]['content'],list): return json.dumps({'passed':True,'issues':[]})
            if 'Review game server' in messages[0]['content']:
                self.reviews+=1
                return json.dumps({'passed': self.reviews != 1,'issues': ['Fix setup'] if self.reviews==1 else []})
            if 'Now write only the client' in messages[-1]['content']: return json.dumps({'code':f['code']})
            self.generations+=1
            if self.generations==2: assert 'review_rules' in messages[-1]['content']
            return json.dumps({'code':f['code'],'server_code':f['server_code']})
    monkeypatch.setattr('game_platform.builder_visual.review_views',lambda *args:[])
    model=Model();monkeypatch.setattr(builder_render,'render_game',lambda *args,**kwargs:[])
    run_build(platform,model,d.owner_user_id,d.id,d.builder_workflow['job']['id'])
    saved=platform.get_game_draft(caller_id=d.owner_user_id,draft_id=d.id)
    assert saved.builder_workflow['job']['status']=='ready_for_review',saved.builder_workflow['job']
    assert model.generations==2 and model.reviews==8
    assert set(saved.builder_workflow['job']['server_reviews'])=={'rules','privacy','computers','settlement'}


def test_old_workflow_missing_tutorial_has_actionable_conflict():
    d=approved_draft();del d.builder_workflow['artifacts']['tutorial']
    with pytest.raises(ConflictError,match='tutorial'):flow.spec_digest(d.builder_workflow)


def test_approved_identity_renames_draft_and_marks_previous_dependents_stale():
    draft = approved_draft()
    value = {'display_name':'Race to six', 'short_description':'Reach six first.'}
    proposed = flow.propose(draft,'identity',value,'Review the edited name.')
    assert proposed.builder_workflow['artifacts']['logic']['status']=='stale'
    result = flow.approve(proposed,'identity')
    assert (result.name,result.description)==('Race to six','Reach six first.')


# --- Regression tests: negative examples, payouts, seat counts, contract ---

WALL_GAME = """
const game = {
  newMatch(ctx) { return {state: {n: 0, walls: 1}, turn: [ctx.players[0].id]}; },
  applyMove(state, id, move, ctx) {
    if (move.wall) {
      if (state.walls <= 0) throw new InvalidMove('No walls left');
      return {state: {n: state.n, walls: state.walls - 1}, turn: [id]};
    }
    if (move.add !== 1) throw new InvalidMove('Add one');
    const n = state.n + 1;
    return {state: {n, walls: state.walls}, turn: [id]};
  },
  viewFor(state, id, ctx) { return {n: state.n, walls: state.walls}; },
  computerMove() { return {add: 1}; },
  randomMove() { return {add: 1}; }
};
"""

WALL_CONTRACT = {
    'state_schema': {'type': 'object', 'required': ['n', 'walls'], 'additionalProperties': False,
                     'properties': {'n': {'type': 'integer', 'minimum': 0, 'maximum': 3},
                                    'walls': {'type': 'integer', 'minimum': 0, 'maximum': 1}}},
    'view_schema': {'type': 'object', 'required': ['n', 'walls'], 'additionalProperties': False,
                    'properties': {'n': {'type': 'integer', 'minimum': 0, 'maximum': 3},
                                   'walls': {'type': 'integer', 'minimum': 0, 'maximum': 1}}},
    'move_schema': {'type': 'object', 'additionalProperties': False,
                    'properties': {'add': {'const': 1}, 'wall': {'type': 'boolean'}}},
}


def wall_case(**overrides):
    case = {'name': 'No walls left', 'description': 'Placing a wall with none left is rejected.',
            'kind': 'intermediate',
            'ctx': {'players': [{'id': 'u1', 'kind': 'human', 'display_name': 'Alice', 'picture_url': '', 'max_loss': 0},
                                {'id': 'computer-1', 'kind': 'computer', 'display_name': 'Computer', 'picture_url': '', 'max_loss': 0}],
                    'pot': 0, 'move_count': 1, 'seed': 1},
            'state': {'n': 1, 'walls': 0}, 'view_of_mover': {'n': 1, 'walls': 0}, 'view_of_other': {'n': 1, 'walls': 0},
            'player_id': 'u1', 'other_player_id': 'computer-1', 'move': {'wall': True},
            'turn': ['u1'], 'expected_error': 'InvalidMove',
            'expected_state': {'n': 1, 'walls': 0}, 'expected_turn': ['u1'],
            'expected_view_of_mover': {'n': 1, 'walls': 0}, 'expected_view_of_other': {'n': 1, 'walls': 0}}
    case.update(overrides)
    return case


def test_expected_error_example_passes_only_on_typed_invalid_move():
    from game_platform.builder_validation import verify_examples
    contract = {**WALL_CONTRACT, 'cases': [wall_case()]}
    results = verify_examples(WALL_GAME, contract)
    assert results == [{'name': 'No walls left', 'passed': True, 'expected_error': 'InvalidMove'}], results
    # The same move, accepted: a legal move mislabelled as a rejection fails.
    accepted = wall_case(name='Legal move', move={'add': 1})
    results = verify_examples(WALL_GAME, {**WALL_CONTRACT, 'cases': [accepted]})
    assert not results[0]['passed'] and 'Expected InvalidMove' in results[0]['error'], results
    # An arbitrary exception is a game bug, not a correct rejection.
    buggy = WALL_GAME.replace("throw new InvalidMove('No walls left')", "throw new Error('boom')")
    results = verify_examples(buggy, contract)
    assert not results[0]['passed'], results


def negative_fixture_contract():
    contract = copy.deepcopy(fixture()['contract'])
    case = contract['cases'][1]
    case.update({'expected_error': 'InvalidMove', 'turn': ['u1'], 'expected_turn': ['u1'],
                 'expected_state': case['state'], 'expected_view_of_mover': case['view_of_mover'],
                 'expected_view_of_other': case['view_of_other']})
    case.pop('expected_payouts', None)
    return contract


def test_negative_example_validation_preserves_state_turn_and_views():
    flow.validate_artifact('tests', negative_fixture_contract())
    changed_state = negative_fixture_contract()
    changed_state['cases'][1]['expected_state'] = {'n': 2}
    with pytest.raises(InvalidRequestError, match='preserve state and views'):
        flow.validate_artifact('tests', changed_state)
    missing_turn = negative_fixture_contract()
    del missing_turn['cases'][1]['turn']
    with pytest.raises(InvalidRequestError, match='preserve an explicit nonempty turn'):
        flow.validate_artifact('tests', missing_turn)
    paid = negative_fixture_contract()
    paid['cases'][1]['expected_payouts'] = {'u1': 1}
    with pytest.raises(InvalidRequestError, match='cannot pay tokens'):
        flow.validate_artifact('tests', paid)
    wrong_error = negative_fixture_contract()
    wrong_error['cases'][1]['expected_error'] = 'GameOver'
    with pytest.raises(InvalidRequestError, match='expected error must be InvalidMove'):
        flow.validate_artifact('tests', wrong_error)


def test_payouts_are_tokens_for_humans_only_and_conserve_the_pot():
    contract = copy.deepcopy(fixture()['contract'])
    terminal = contract['cases'][-1]
    terminal['ctx']['pot'] = 20
    terminal['expected_payouts'] = {'u1': 20}
    flow.validate_artifact('tests', contract)
    # Winning is not 1 token regardless of the pot.
    one_token = copy.deepcopy(contract)
    one_token['cases'][-1]['expected_payouts'] = {'u1': 1}
    with pytest.raises(InvalidRequestError, match='conserve the pot'):
        flow.validate_artifact('tests', one_token)
    # Computers are never paid.
    pays_computer = copy.deepcopy(contract)
    pays_computer['cases'][-1]['ctx']['players'].append(
        {'id': 'computer-1', 'kind': 'computer', 'display_name': 'Computer', 'picture_url': '', 'max_loss': 0})
    pays_computer['cases'][-1]['expected_payouts'] = {'u1': 10, 'computer-1': 10}
    with pytest.raises(InvalidRequestError, match='active humans only'):
        flow.validate_artifact('tests', pays_computer)
    # Ongoing payouts may not exceed the pot either.
    over_pot = copy.deepcopy(contract)
    over_pot['cases'][1]['expected_payouts'] = {'u1': 5}
    with pytest.raises(InvalidRequestError, match='conserve the pot'):
        flow.validate_artifact('tests', over_pot)


def test_roster_seat_counts_are_total_seats_not_humans():
    workflow = {'artifacts': {'logic': {'value': {'allowed_player_counts': [2]}}}}
    two_seats = {'cases': [wall_case()]}
    flow.validate_test_rosters(workflow, two_seats)
    one_seat = {'cases': [{**wall_case(), 'ctx': {**wall_case()['ctx'], 'players': wall_case()['ctx']['players'][:1]}}]}
    with pytest.raises(InvalidRequestError, match='two seats'):
        flow.validate_test_rosters(workflow, one_seat)
    # The same check fires on propose, before a tests artifact can be approved:
    # the counter draft's approved logic allows [1], its examples use 1 seat.
    d = approved_draft()
    contract = copy.deepcopy(d.builder_workflow['artifacts']['tests']['value'])
    for case in contract['cases']:
        case['ctx']['players'].append(
            {'id': 'u2', 'kind': 'human', 'display_name': 'Bob', 'picture_url': '', 'max_loss': 0})
    with pytest.raises(InvalidRequestError, match='seat counts'):
        flow.propose(d, 'tests', contract, 'Two seats against a one-seat game')


def test_platform_contract_is_shared_by_generation_and_review_prompts():
    from game_platform.builder_checks import DRAFTING_CONTRACT, PLATFORM_CONTRACT
    from game_platform.builder_jobs import STEP_PROMPTS
    for phrase in ('total seats, not humans', 'expected_error', 'ctx.pot', 'never pay computers', '100 ms', 'ctx.random'):
        assert phrase in PLATFORM_CONTRACT, phrase
    assert PLATFORM_CONTRACT in STEP_PROMPTS['logic']
    assert PLATFORM_CONTRACT in STEP_PROMPTS['tests']
    assert 'expected_error' in STEP_PROMPTS['tests']
    for phrase in ('One ruling per situation', 'only when', 'worked example'):
        assert phrase in DRAFTING_CONTRACT, phrase
    assert DRAFTING_CONTRACT in STEP_PROMPTS['logic']
    assert DRAFTING_CONTRACT in STEP_PROMPTS['tests']
    from game_platform.builder_checks import ILLUSTRATION_ACCURACY
    for phrase in ('Transcribe, do not invent', 'Place by coordinates', 'Recount before returning', 'covering exactly N units', 'xmlns="http://www.w3.org/2000/svg"'):
        assert phrase in ILLUSTRATION_ACCURACY, phrase
    assert ILLUSTRATION_ACCURACY in STEP_PROMPTS['images']
    # The cover has no supplied state to transcribe, so it gets its own
    # fidelity rule anchored to the approved board geometry instead.
    from game_platform.builder_checks import COVER_FIDELITY
    for phrase in ("game's real board", 'top-down or straight-on', 'spanning exactly 2 cells', 'Recount the rows and columns'):
        assert phrase in COVER_FIDELITY, phrase
    assert COVER_FIDELITY in STEP_PROMPTS['images']
    # The build failures these clauses prevent: illegal computer candidates,
    # settlement recomputed on later leaves, spectator leaves ending games,
    # weakened difficulties, and reviews demanding impossible behaviour.
    for phrase in ('holds no seat', 'never recomputed', 'forfeit winner may be a computer seat',
                   "requires that seat's remaining count > 0", 'branches on the requested difficulty',
                   'runs no search, evaluation or minimax'):
        assert phrase in PLATFORM_CONTRACT, phrase
    from game_platform.builder_checks import REVIEW_DISCIPLINE
    for phrase in ('do not invent stricter requirements', 'impossible inputs, not code defects',
                   'still active, so paying them is not paying an inactive player',
                   'no difficulty field', 'state.difficulty is the approved channel'):
        assert phrase in REVIEW_DISCIPLINE, phrase
    # The settlement algorithm, randomMove recipe and difficulty channel are
    # stated exactly, because principle-level wording kept producing code
    # that failed the deterministic walks (playerLeft sums, randomMove time).
    for phrase in ('ONE settlement function', 'state.finalPayouts', 'the departing human',
                   'complete legal move list once', 'No weighting between move types',
                   'state.difficulty when the game state carries it'):
        assert phrase in PLATFORM_CONTRACT, phrase
    import inspect
    from game_platform import builder_jobs
    assert 'REVIEW_DISCIPLINE' in inspect.getsource(builder_jobs.run_build)
    # Conditional illegality needs a condition-present negative example, or
    # the only gate for it is an AI review (a wall-between-pawns jump case
    # was caught that way, one attempt too late).
    assert 'with the condition present' in STEP_PROMPTS['tests']


def test_verification_progress_rewards_converging_attempts():
    from game_platform.builder_jobs import _verification_progress
    # The shape of a real converging build: deterministic failures, then
    # several review issues, then a single review issue.
    attempt1 = [{'settlement_probes': ['one failure']}, {'random_walks': '(TestFailure...)'}]
    attempt2 = [{'review_rules': {'passed': False, 'issues': ['a', 'b']}},
                {'review_computers': {'passed': False, 'issues': ['a', 'b']}},
                {'review_settlement': {'passed': False, 'issues': ['a', 'b']}}]
    attempt3 = [{'review_rules': {'passed': False, 'issues': ['a']}}]
    assert _verification_progress(attempt1) == (1, -2)
    assert _verification_progress(attempt2) == (2, -6)
    assert _verification_progress(attempt3) == (2, -1)
    assert _verification_progress(attempt1) < _verification_progress(attempt2) < _verification_progress(attempt3)
    # No progress: identical failures, or a stage regression.
    assert _verification_progress(attempt3) == _verification_progress(attempt3)
    assert _verification_progress([{'server_load': 'boom'}]) == (0, -1)
    assert _verification_progress(attempt1) < _verification_progress(attempt2)
    assert _verification_progress([{'approved_examples': [{'passed': True}, {'passed': False}]}]) == (1, -1)
