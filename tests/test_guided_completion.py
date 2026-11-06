from dataclasses import replace
from types import SimpleNamespace
import json
import pytest
from game_platform import builder_flow as flow
from game_platform.builder_budget import BudgetedModel, LIMIT
from game_platform.model_api import ChatResult, ModelApiClient, ModelApiError
from game_platform.service import GamePlatform, InvalidRequestError
from game_platform.store import InMemoryStore
from game_platform.tests.test_builder_flow import approved_draft, fixture


def setup_draft():
    store = InMemoryStore()
    platform = GamePlatform(store=store)
    d = approved_draft()
    user = platform.create_user(display_name='Designer')
    store.put_user(replace(user,id=d.owner_user_id))
    store.put_game_draft(d)
    return platform,d


def test_hosted_spark_budget_defaults_and_operator_overrides():
    from game_platform.builder_budget import validate_tariffs
    from game_platform.config import ModelApiConfig

    assert validate_tariffs(ModelApiConfig()) == (1.25, 4.25, 1_048_576)
    config = ModelApiConfig(base_url="https://api.meta.ai/v1/", builder_input_usd_per_million=0)
    assert validate_tariffs(config) == (0, 4.25, 1_048_576)
    for settings in ({"model": "different"}, {"base_url": "https://example.com/v1"}):
        with pytest.raises(InvalidRequestError, match="verified model"):
            validate_tariffs(ModelApiConfig(**settings))


def test_budget_reserves_before_call_and_retains_unknown_charges():
    p,d=setup_draft()
    config=SimpleNamespace(builder_input_usd_per_million=5,builder_output_usd_per_million=10,builder_max_input_tokens=1000)
    class Provider:
        calls=0
        def chat_with_reasoning(self,*args,**kw):
            self.calls+=1
            if self.calls==2:raise TimeoutError()
            return ChatResult('ok',prompt_tokens=100,completion_tokens=7)
    provider=Provider()
    model=BudgetedModel(provider,config,p,d.owner_user_id,d)
    assert model.chat([], max_tokens=100)=='ok' and model.charged==570
    with pytest.raises(TimeoutError): model.chat([],max_tokens=100)
    assert model.charged==6570
    model.record(LIMIT-6570)
    with pytest.raises(InvalidRequestError,match='budget'):model.chat([],max_tokens=1)
    assert provider.calls==2


def test_changed_and_identical_dependencies_need_different_approval():
    d=approved_draft()
    revised=flow.propose(d,'ui',{'text':'Make the board large.'},'Changed')
    revised=flow.approve(revised,'ui')
    tutorial=d.builder_workflow['artifacts']['tutorial']['value']
    assert flow.propose(revised,'tutorial',tutorial,'Still suitable').builder_workflow['artifacts']['tutorial']['status']=='approved'
    assert flow.propose(revised,'tutorial',{**tutorial,'text':'Changed'},'Changed').builder_workflow['artifacts']['tutorial']['status']=='draft'


def test_existing_game_import_preserves_private_edits(api):
    owner=api.new_user('owner');other=api.new_user('other')
    game=api.new_game(owner=owner)
    url=f'/builder/games/{game}/open'
    assert api.request('POST',url,as_user=other).status_code==403
    d=api.ok('POST',url,as_user=owner)
    assert d['base_version']==1 and d['id']==game
    assert api.ok('POST',url,as_user=owner)==d


def test_cover_constraints_and_expired_job():
    with pytest.raises(InvalidRequestError,match='16:9'):flow.validate_cover({'svg':'<svg viewBox="0 0 1 1"/>','caption':'Cover'})
    with pytest.raises(InvalidRequestError,match='text'):flow.validate_cover({'svg':'<svg viewBox="0 0 16 9"><text>Test</text></svg>','caption':'Cover'})
    d=flow.begin_build(approved_draft())
    d.builder_workflow['job']['deadline']=0
    recovered=flow.recover_expired(d)
    assert recovered.builder_workflow['job']['status']=='interrupted'
    assert flow.spec_digest(d.builder_workflow)==flow.spec_digest(recovered.builder_workflow)


def test_reject_visual_then_repair_and_publish(monkeypatch,tmp_path):
    from game_platform import builder_render, builder_jobs
    from game_platform.schemas import GameOut
    p,d=setup_draft()
    d=p.change_builder_workflow(caller_id=d.owner_user_id,draft_id=d.id,expected_revision=d.revision,change=flow.begin_build)
    f=fixture(); job=d.builder_workflow['job']['id']
    class Model:
        generation=0
        reviewed=0
        server_review_calls=0
        client_calls=0
        def chat(self,messages,**kwargs):
            first=messages[0]['content']
            if isinstance(first,list):
                assert sum(item['type']=='image_url' for item in first)==8
                self.reviewed+=1
                return json.dumps({'passed':self.reviewed!=1,'issues':['Missing counter'] if self.reviewed==1 else []})
            if 'Review game server' in first:
                self.server_review_calls+=1
                if self.server_review_calls==1:
                    from game_platform.model_api import ModelOutputLimitError
                    raise ModelOutputLimitError('output limit')
                if self.server_review_calls==2:
                    assert kwargs['max_tokens']==16000
                    assert 'previous reply hit its output limit' in messages[-1]['content']
                return '{"passed":true,"issues":[]}'
            if any('Now write only the client' in m.get('content','') for m in messages if isinstance(m.get('content'),str)):
                # A visual-review failure now retries only the client
                # against the verified server (it once discarded the
                # server and failed the whole attempt).
                self.client_calls+=1
                if self.client_calls==2:
                    assert 'Missing counter' in messages[-1]['content']
                    assert messages[-2]['content']==f['code']
                return json.dumps({'code':f['code']})
            if 'targeted edits' in messages[-1].get('content',''):
                # A repair is first offered as targeted edits; this model
                # answers with an edit that does not apply, so the build
                # falls back to the full-file repair this test exercises.
                return json.dumps({'edits':[{'find':'not present in the attempt','replace':'x'}]})
            self.generation+=1
            assert 'CURRENT OUTPUT REQUIRED: Return only the complete executable server JavaScript' in messages[-1]['content']
            if self.generation==1:return 'const game = {}; unexpected prose'
            if self.generation==2:
                assert 'SyntaxError' in messages[-1]['content']
                assert messages[-2]['content']=='const game = {}; unexpected prose'
            return json.dumps({'code':f['code'],'server_code':f['server_code']})
    def render(*args,**kwargs):
        shots=[]
        for case in f['contract']['cases']:
            for view,width,direction in [('view_of_mover',390,'ltr'),('view_of_other',844,'rtl'),('expected_view_of_mover',820,'ltr'),('expected_view_of_other',1366,'rtl')]:
                shots.append(dict(test=case['name'],view=view,width=width,direction=direction,approvedFile='test.png',file='test.png'))
        return shots
    (tmp_path/job).mkdir();(tmp_path/job/'test.png').write_bytes(b'test image')
    monkeypatch.setattr(builder_render,'ARTIFACT_ROOT',tmp_path);monkeypatch.setattr(builder_render,'render_game',render)
    model=Model();builder_jobs.run_build(p,model,d.owner_user_id,d.id,job)
    saved=p.get_game_draft(caller_id=d.owner_user_id,draft_id=d.id)
    assert saved.builder_workflow['job']['status']=='ready_for_review',saved.builder_workflow['job']
    assert model.generation==2 and model.client_calls==2 and model.reviewed==6
    log=saved.builder_workflow['job']['log']
    assert 'Checking approved_examples' not in log[:log.index('Writing code · attempt 2')]
    assert GameOut.of(replace_game(saved)).cover_url.endswith('/versions/1/cover')


def test_client_localization_failure_retries_only_the_client(monkeypatch,tmp_path):
    from game_platform import builder_render, builder_jobs
    p,d=setup_draft()
    d=p.change_builder_workflow(caller_id=d.owner_user_id,draft_id=d.id,expected_revision=d.revision,change=flow.begin_build)
    f=fixture(); job=d.builder_workflow['job']['id']
    bad_client=f['code'].replace('applyLocale(','applyLocaleDisabled(')
    assert bad_client!=f['code']
    class Model:
        server_generations=0
        client_calls=0
        def chat(self,messages,**kwargs):
            first=messages[0]['content']
            if isinstance(first,list):
                return json.dumps({'passed':True,'issues':[]})
            if 'Review game server' in first:
                return '{"passed":true,"issues":[]}'
            if any('Now write only the client' in m.get('content','') for m in messages if isinstance(m.get('content'),str)):
                self.client_calls+=1
                if self.client_calls==1: return json.dumps({'code':bad_client})
                assert 'must not change' in messages[-1]['content']
                assert 'Missing applyLocale' in messages[-1]['content']
                return json.dumps({'code':f['code']})
            self.server_generations+=1
            return json.dumps({'code':f['code'],'server_code':f['server_code']})
    def render(*args,**kwargs):
        shots=[]
        for case in f['contract']['cases']:
            for view,width,direction in [('view_of_mover',390,'ltr'),('view_of_other',844,'rtl'),('expected_view_of_mover',820,'ltr'),('expected_view_of_other',1366,'rtl')]:
                shots.append(dict(test=case['name'],view=view,width=width,direction=direction,approvedFile='test.png',file='test.png'))
        return shots
    (tmp_path/job).mkdir();(tmp_path/job/'test.png').write_bytes(b'test image')
    monkeypatch.setattr(builder_render,'ARTIFACT_ROOT',tmp_path);monkeypatch.setattr(builder_render,'render_game',render)
    model=Model();builder_jobs.run_build(p,model,d.owner_user_id,d.id,job)
    saved=p.get_game_draft(caller_id=d.owner_user_id,draft_id=d.id)
    assert saved.builder_workflow['job']['status']=='ready_for_review',saved.builder_workflow['job']
    # The verified server was generated once; only the client was rewritten.
    assert model.server_generations==1 and model.client_calls==2
    assert 'Rewriting the client · try 2' in [entry for entry in saved.builder_workflow['job']['log']]
    # Visual-review entries score as the final stage for progress purposes.
    from game_platform.builder_jobs import _verification_progress
    assert _verification_progress([{'visual_review':'Case','issues':['a','b']}])==(3,-2)


def replace_game(draft):
    from game_platform.models import Game
    return Game(id=draft.id,version=1,owner_user_id=draft.owner_user_id,name=draft.name,description=draft.description,
                rules=draft.rules,code=draft.code,server_code=draft.server_code,builder_workflow=draft.builder_workflow,
                created_at=draft.created_at,updated_at=draft.updated_at)


@pytest.mark.skipif(__import__('os').environ.get('GUIDED_BROWSER_BUILD') != '1',reason='requires installed Chrome')
def test_full_guided_http_build_with_real_renderer(api,monkeypatch,tmp_path):
    import time
    from game_platform import builder_render
    from game_platform.model_api import ModelApiClient
    from game_platform.config import ModelApiConfig
    from game_platform.tests.test_game_drafts import create_draft
    monkeypatch.setattr(builder_render,'ARTIFACT_ROOT',tmp_path)
    api.client.app.state.model_api_config=ModelApiConfig(api_key='fixture-only',builder_input_usd_per_million=1,builder_output_usd_per_million=1,builder_max_input_tokens=128000)
    artifacts=approved_draft().builder_workflow['artifacts']
    translated = []
    fail_once = True
    def respond(self,messages,**options):
        nonlocal fail_once
        system=messages[0]['content']
        if isinstance(system,list) or system.startswith('Review game server'):
            value={'passed':True,'issues':[]}
        elif system.startswith('Plan the catalog artwork'):
            value={'message':'Review images','captions':[i['caption'] for i in artifacts['images']['value']['images']]}
        elif system.startswith('Draw only one '):
            caption=json.loads(messages[1]['content'])['draw']
            svg=next(i['svg'] for i in artifacts['images']['value']['images'] if i['caption']==caption)
            return ChatResult(svg,prompt_tokens=500,completion_tokens=200)
        elif system.startswith('Write the approved game tutorial'):
            value={'message':'Review tutorial','artifact':artifacts['tutorial']['value']}
        elif system.startswith('You help a person'):
            step=json.loads(messages[1]['content'])['step']
            value={'message':'Please review','artifact':artifacts[step]['value']}
        elif system.startswith('Translate'):
            locale = next(lang for lang in flow.LANGUAGES if f'"{lang}"' in system)
            if len(translated)==1 and fail_once:
                fail_once = False
                raise ModelApiError('Transient fixture failure')
            translated.append(locale)
            value={l:dict(display_name='Count',short_description='Count to three',game_logic_rules='Count',game_ui_rules='Button',tutorial_strings={s:s for s in json.loads(messages[1]['content'])['tutorial_strings']},client_strings={k:l+' '+v for k,v in json.loads(messages[1]['content'])['client_strings'].items()}) for l in flow.LANGUAGES}
        else:
            field = 'code' if 'Now write only the client' in messages[-1]['content'] else 'server_code'
            source = fixture()[field]
            if field == 'code':
                # Fail the real browser test if the renderer presents an impossible live-match state.
                source = source.replace("m=e.data;applyLocale", """m=e.data;
if (m.status==='over' && (m.turn_of_player_indices!==null || m.acting_for_player_index!==null)) throw Error('Invalid terminal turn');
if (m.acting_for_player_index!==null && !m.turn_of_player_indices?.includes(m.acting_for_player_index)) throw Error('Invalid acting seat');
applyLocale""")
            return ChatResult(source,prompt_tokens=500,completion_tokens=200)
        return ChatResult(json.dumps(value),prompt_tokens=500,completion_tokens=200)
    monkeypatch.setattr(ModelApiClient,'chat_with_reasoning',respond)
    owner=api.new_user('Designer');draft=create_draft(api,owner);path='/game-drafts/'+draft['id']
    def action(name, **extra):
        nonlocal draft
        draft=api.ok('POST',path+'/workflow/'+name,as_user=owner,json={'expected_revision':draft['revision'],**extra})
    action('initialize')
    for step in flow.STEPS:
        action('propose',step=step);action('approve',step=step)
    action('build')
    deadline=time.monotonic()+240
    while draft['builder_workflow']['job']['status'] in flow.ACTIVE and time.monotonic()<deadline:
        time.sleep(.2);draft=api.ok('GET',path,as_user=owner)
    job=draft['builder_workflow']['job']
    assert job['status']=='ready_for_review',job.get('error')
    assert len(job['screenshots'])>=198
    failed = api.request('POST',path+'/workflow/final-approve',as_user=owner,json={'expected_revision':draft['revision']})
    assert failed.status_code == 502
    draft = api.ok('GET',path,as_user=owner)
    assert draft['builder_workflow']['job']['status']=='ready_for_review'
    action('final-approve')
    assert translated == list(flow.LANGUAGES)
    published=api.ok('POST',path+'/publish',as_user=owner,json={'expected_revision':draft['revision']})
    assert api.request('GET',published['cover_url']).headers['content-type'].startswith('image/svg+xml')
    assert published['tutorial_html'] and set(published['translations'])==set(flow.LANGUAGES)
    for locale in flow.LANGUAGES:
        strings=api.ok('GET',f"/games/{published['id']}/versions/{published['version']}/strings?lang={locale}",as_user=owner)
        assert strings['strings']==published['translations'][locale]['client_strings']
        assert strings['status']=='translated'


def test_migration_proposes_all_missing_artifacts_without_publishing(api,monkeypatch):
    from game_platform.builder_migration import prefill
    from game_platform.builder_api import configured_client
    from game_platform.model_api import ModelApiClient
    from game_platform.config import ModelApiConfig
    from game_platform.builder_jobs import STEP_PROMPTS
    owner=api.new_user('Owner'); game_id=api.new_game(owner=owner)
    p=api.client.app.state.platform
    game=p.get_game(game_id);original=api.ok('GET','/games/'+game_id)
    config=ModelApiConfig(api_key='fixture',builder_input_usd_per_million=0,builder_output_usd_per_million=0,builder_max_input_tokens=32000)
    artifacts=approved_draft().builder_workflow['artifacts']
    def generate(self,messages,**kw):
        step=next(s for s,prompt in STEP_PROMPTS.items() if messages[0]['content'].endswith(prompt))
        return ChatResult(json.dumps({'artifact':artifacts[step]['value']}))
    monkeypatch.setattr(ModelApiClient,'chat_with_reasoning',generate)
    def factory(owner,d):return configured_client(config,p,owner,d)
    assert prefill(p,game,factory)
    assert not prefill(p,game,factory)
    saved=p.get_game_draft(caller_id=owner,draft_id=game.id)
    assert {a['status'] for a in saved.builder_workflow['artifacts'].values()}=={'draft'}
    assert api.ok('GET','/games/'+game_id)==original


def test_rejected_browser_move_is_reported_for_repair():
    from game_platform.builder_validation import verify_browser_moves
    f=fixture();case=f['contract']['cases'][0]
    with pytest.raises(RuntimeError,match='illegal move'):
        verify_browser_moves(f['server_code'],f['contract'],[case],[dict(caseIndex=0,view='view_of_mover',emittedMoves=[{'add':99}])])
    with pytest.raises(RuntimeError,match='out of turn'):
        verify_browser_moves(f['server_code'],f['contract'],[case],[dict(caseIndex=0,view='view_of_other',emittedMoves=[{'add':1}])])


def test_random_examples_remain_deterministic_but_skip_fixed_outcome():
    from game_platform.builder_validation import verify_examples
    f=fixture()
    code=f['server_code'].replace('newMatch(ctx){','newMatch(ctx){ctx.random();')
    results=verify_examples(code,f['contract'])
    assert results[0]['passed'] and results[0]['random_outcome']=='newMatch'


def test_notifications_require_verified_contact_and_explicit_opt_in():
    from game_platform.builder_jobs import notification_callback
    sent=[]
    sender=SimpleNamespace(send_message=lambda *args:sent.append(args))
    user=SimpleNamespace(linked_accounts=[SimpleNamespace(kind='phone',identifier='test-phone')])
    notification_callback(user,[],sender,sender)('ready')
    assert not sent
    notification_callback(user,['sms'],sender,sender)('ready')
    assert sent==[('test-phone','ready')]
    with pytest.raises(InvalidRequestError):notification_callback(user,['email'],sender,sender)

def test_empty_proposal_accounts_for_reported_usage(monkeypatch):
    platform, draft = setup_draft()
    config = SimpleNamespace(builder_input_usd_per_million=5, builder_output_usd_per_million=10, builder_max_input_tokens=1000)
    provider = ModelApiClient()
    response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=""), finish_reason="length")],
                               usage=SimpleNamespace(prompt_tokens=100, completion_tokens=7))
    monkeypatch.setattr(provider, "_completions", lambda *args, **kwargs: response)
    model = BudgetedModel(provider, config, platform, draft.owner_user_id, draft)
    with pytest.raises(ModelApiError, match="output limit"):
        model.chat([], max_tokens=100)
    assert model.charged == 570


def test_failed_call_without_usage_charges_nothing(monkeypatch):
    platform, draft = setup_draft()
    config = SimpleNamespace(builder_input_usd_per_million=5, builder_output_usd_per_million=10, builder_max_input_tokens=1000)
    provider = ModelApiClient()
    def fail(*args, **kwargs):
        raise ModelApiError('Muse timed out. Please try again with a smaller change.', retryable=False)
    monkeypatch.setattr(provider, "_completions", fail)
    model = BudgetedModel(provider, config, platform, draft.owner_user_id, draft)
    with pytest.raises(ModelApiError, match="timed out"):
        model.chat([], max_tokens=100)
    # The provider reported no usage (a timeout before generation): the
    # reservation is released in full instead of charging the draft the
    # worst case for a call that produced nothing.
    assert model.charged == 0


def test_test_proposal_requests_illustrations_one_case_at_a_time():
    from copy import deepcopy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    contract = deepcopy(draft.builder_workflow['artifacts']['tests']['value'])
    pictures = {case['name']:case.pop('images') for case in contract['cases']}
    outlines = [{k: c[k] for k in ('name', 'kind', 'description')} for c in contract['cases']]
    schemas = {k: contract[k] for k in ('state_schema', 'view_schema', 'move_schema')}
    full = {case['name']: case for case in contract['cases']}
    class SplitProvider:
        cases = []
        def chat(self, messages, **kwargs):
            instruction = messages[0]['content']
            payload = json.loads(messages[1]['content'])
            if instruction.startswith('Plan the requested tests'):
                return json.dumps({**schemas, 'cases': outlines, 'message': 'Review these cases'})
            if instruction.startswith('Write only the single'):
                return json.dumps(full[payload['outline']['name']])
            name = payload['example']['name']
            self.cases.append(name)
            return json.dumps({'images':pictures[name]})
    provider = SplitProvider()
    result = propose_step(provider,draft,'tests','Generate the examples')
    # Illustrations are requested per case (concurrently, so in any order).
    assert sorted(provider.cases) == sorted(pictures)
    flow.validate_artifact('tests',result.builder_workflow['artifacts']['tests']['value'])


def test_logic_proposal_retries_once_after_output_limit():
    from game_platform.builder_jobs import propose_step
    from game_platform.model_api import ModelOutputLimitError
    artifact = {'text':'Standard rules: race your pawn home; walls must leave a path.',
                'allowed_player_counts':[2],'allows_join_mid_match':False,'allows_leave_mid_match':False}
    class FlakyProvider:
        calls = 0
        def chat(self, messages, **kwargs):
            if messages[0]['content'].startswith('You audit a game specification'):
                return '{"findings":[]}'
            self.calls += 1
            if self.calls == 1:
                assert kwargs['max_tokens'] == 12000
                raise ModelOutputLimitError('output limit')
            assert kwargs['max_tokens'] == 24000
            assert 'previous reply hit its output limit' in messages[-1]['content']
            return json.dumps({'message':'Review the rules', 'artifact':artifact})
    provider = FlakyProvider()
    result = propose_step(provider, approved_draft(), 'logic', 'Use normal rules')
    assert provider.calls == 2
    assert result.builder_workflow['artifacts']['logic']['value'] == artifact


def test_logic_proposal_fails_clearly_after_two_output_limits():
    from game_platform.builder_jobs import propose_step
    from game_platform.model_api import ModelOutputLimitError
    class AlwaysLimited:
        def chat(self, messages, **kwargs):
            raise ModelOutputLimitError('output limit')
    with pytest.raises(ModelOutputLimitError, match='output limit twice'):
        propose_step(AlwaysLimited(), approved_draft(), 'logic', 'Use normal rules')


def test_illustration_prompts_carry_the_accuracy_contract():
    from copy import deepcopy
    from game_platform.builder_jobs import illustrate_test_cases
    artifact = deepcopy(fixture()['contract'])
    originals = {case['name']: case.pop('images') for case in artifact['cases']}
    class Provider:
        def chat(self, messages, **kwargs):
            assert 'Transcribe, do not invent' in messages[0]['content']
            assert 'Recount before returning' in messages[0]['content']
            name = json.loads(messages[1]['content'])['example']['name']
            # The model may omit the SVG namespace; stored images must regain it
            # or browsers refuse to render them through an <img>.
            images = [{**image, 'svg': image['svg'].replace(' xmlns="http://www.w3.org/2000/svg"', '')}
                      for image in originals[name]]
            return json.dumps({'images': images})
    illustrate_test_cases(Provider(), artifact, 'en', 'A count and a button.')
    assert all(len(case['images']) == 4 for case in artifact['cases'])
    assert all('xmlns="http://www.w3.org/2000/svg"' in image['svg']
               for case in artifact['cases'] for image in case['images'])


@pytest.mark.parametrize('output_limit',[False, True])
def test_incomplete_contract_and_svg_recover_without_restarting_draft(output_limit):
    from game_platform.model_api import ModelOutputLimitError
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    contract = copy.deepcopy(draft.builder_workflow['artifacts']['tests']['value'])
    cases = contract.pop('cases')
    for case in cases:
        case.pop('images')
    outlines = [{k:c[k] for k in ('name','kind','description')} for c in cases]
    calls = []
    class Provider:
        def chat(self,messages,**options):
            instruction = messages[0]['content']
            if instruction.startswith('Plan the requested tests'):
                return json.dumps(dict(contract,cases=outlines,message='Review the examples'))
            if instruction.startswith('Write only the single'):
                name = json.loads(messages[1]['content'])['outline']['name']
                calls.append(name)
                if name == outlines[2]['name'] and calls.count(name) <= 2:
                    return '{"bad":'
                return json.dumps(next(c for c in cases if c['name']==name))
            if instruction.startswith('Draw one compact'):
                return '<svg><text x="1" y="10">View</text></svg>'
            if output_limit:
                assert options['reasoning_effort'] == 'low'
                raise ModelOutputLimitError('output limit')
            return '{"broken":"'
        def checkpoint(self,key,progress):
            self.saved = copy.deepcopy({'key':key,'progress':progress})
    client = Provider()
    with pytest.raises(ValueError,match='Retry the same request'):
        propose_step(client,draft,'tests','Use three cases')
    draft.builder_workflow['pending_generation'] = client.saved
    result = propose_step(client,draft,'tests','Use three cases')
    # Cases are written concurrently and committed in outline order: the
    # failed case is attempted twice in the first run and once on resume,
    # while the cases before it are generated exactly once.
    from collections import Counter
    counts = Counter(calls)
    assert counts[outlines[0]['name']] == counts[outlines[1]['name']] == 1
    assert counts[outlines[2]['name']] == 3
    artifact = result.builder_workflow['artifacts']['tests']['value']
    flow.validate_artifact('tests',artifact)
    assert all(len(case['images'])==4 for case in artifact['cases'])


def test_short_test_plan_is_repaired_instead_of_failing():
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    contract = copy.deepcopy(draft.builder_workflow['artifacts']['tests']['value'])
    cases = contract.pop('cases')
    originals = {case['name']: case.pop('images') for case in cases}
    outlines = [{k: c[k] for k in ('name', 'kind', 'description')} for c in cases]
    plan_calls = []
    class Provider:
        def chat(self, messages, **options):
            instruction = messages[0]['content']
            if instruction.startswith('Plan the requested tests'):
                plan_calls.append(messages)
                chosen = outlines[:2] if len(plan_calls) == 1 else outlines
                return json.dumps(dict(contract, cases=chosen, message='Review the examples'))
            if instruction.startswith('Write only the single'):
                name = json.loads(messages[1]['content'])['outline']['name']
                return json.dumps(next(c for c in cases if c['name'] == name))
            if instruction.startswith('Illustrate only this one'):
                name = json.loads(messages[1]['content'])['example']['name']
                return json.dumps({'images': originals[name]})
            return '{"broken":"'
    result = propose_step(Provider(), draft, 'tests', 'Check these moves')
    assert len(plan_calls) == 2
    assert 'must contain 3–10' in plan_calls[1][-1]['content']
    artifact = result.builder_workflow['artifacts']['tests']['value']
    flow.validate_artifact('tests', artifact)
    assert [c['name'] for c in artifact['cases']] == [o['name'] for o in outlines]


def test_test_plan_missing_a_kind_is_completed_instead_of_failing():
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    contract = copy.deepcopy(draft.builder_workflow['artifacts']['tests']['value'])
    cases = contract.pop('cases')
    originals = {case['name']: case.pop('images') for case in cases}
    outlines = [{k: c[k] for k in ('name', 'kind', 'description')} for c in cases]
    # The shape a user actually asks for: named examples, none of them initial.
    # The total is fine (3), so only the composition check can catch this —
    # at outline stage, before any case is written out.
    named = [{'name': 'Diagonal sidestep', 'kind': 'intermediate', 'description': 'A legal diagonal'},
             {'name': 'Blocking wall', 'kind': 'intermediate', 'description': 'A legal blocking wall'},
             {'name': 'Winning move', 'kind': 'terminal', 'description': 'A legal winning move'}]
    plan_calls = []
    class Provider:
        def chat(self, messages, **options):
            instruction = messages[0]['content']
            if instruction.startswith('Plan the requested tests'):
                plan_calls.append(messages)
                chosen = named if len(plan_calls) == 1 else outlines
                return json.dumps(dict(contract, cases=chosen, message='Review the examples'))
            if instruction.startswith('Write only the single'):
                name = json.loads(messages[1]['content'])['outline']['name']
                return json.dumps(next(c for c in cases if c['name'] == name))
            if instruction.startswith('Illustrate only this one'):
                name = json.loads(messages[1]['content'])['example']['name']
                return json.dumps({'images': originals[name]})
            return '{"broken":"'
    result = propose_step(Provider(), draft, 'tests', 'a diagonal move that is legal, a wall that blocks, a winning move')
    assert len(plan_calls) == 2
    assert '0 initial outlines; it must contain 1–2' in plan_calls[1][-1]['content']
    assert 'keep every example the user asked for' in plan_calls[1][-1]['content']
    artifact = result.builder_workflow['artifacts']['tests']['value']
    flow.validate_artifact('tests', artifact)
    assert [c['name'] for c in artifact['cases']] == [o['name'] for o in outlines]


def test_negative_case_paperwork_is_completed_by_code():
    import copy
    from game_platform.builder_jobs import validate_test_data
    contract = copy.deepcopy(fixture()['contract'])
    case = contract['cases'][1]
    # A rejected-move case as generators actually produce it: the required
    # preservation copies (turn, expected state/views, no payouts) omitted
    # or garbled. The copies are definitional, so validation completes
    # them instead of failing the whole proposal for a missing field.
    case['expected_error'] = 'InvalidMove'
    case.pop('turn', None)
    case['expected_state'] = {'n': 999}
    case['expected_view_of_mover'] = {'n': 999}
    case['expected_payouts'] = {'u1': 0}
    validate_test_data(contract)
    assert case['turn'] == case['expected_turn'] == ['u1']
    assert case['expected_state'] == case['state']
    assert case['expected_view_of_mover'] == case['view_of_mover']
    assert case['expected_view_of_other'] == case['view_of_other']
    assert not case.get('expected_payouts')


def test_negative_case_missing_turn_no_longer_needs_model_repair():
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    contract = copy.deepcopy(draft.builder_workflow['artifacts']['tests']['value'])
    cases = contract.pop('cases')
    originals = {case['name']: case.pop('images') for case in cases}
    outlines = [{k: c[k] for k in ('name', 'kind', 'description')} for c in cases]
    def expanded(name):
        case = next(c for c in cases if c['name'] == name)
        if name == 'Intermediate move':
            case = {**case, 'expected_error': 'InvalidMove', 'expected_state': {'n': 999}}
            case.pop('turn', None)
        return case
    class Provider:
        def chat(self, messages, **options):
            instruction = messages[0]['content']
            if instruction.startswith('Plan the requested tests'):
                return json.dumps(dict(contract, cases=outlines, message='Review the examples'))
            if instruction.startswith('Write only the single'):
                name = json.loads(messages[1]['content'])['outline']['name']
                return json.dumps(expanded(name))
            if instruction.startswith('Illustrate only this one'):
                name = json.loads(messages[1]['content'])['example']['name']
                return json.dumps({'images': originals[name]})
            return '{"broken":"'
    result = propose_step(Provider(), draft, 'tests', 'check the walls cannot fully block a dragon')
    artifact = result.builder_workflow['artifacts']['tests']['value']
    flow.validate_artifact('tests', artifact)
    case = next(c for c in artifact['cases'] if c['name'] == 'Intermediate move')
    assert case['turn'] == ['u1']
    assert case['expected_state'] == case['state']
    assert case['expected_view_of_mover'] == case['view_of_mover']


@pytest.mark.parametrize('inline', [True, False])
def test_repair_only_malformed_test_view(inline):
    import copy
    from game_platform.builder_jobs import illustrate_test_cases
    contract = copy.deepcopy(fixture()['contract'])
    case = contract['cases'][0]
    images = copy.deepcopy(case['images'])
    images[1]['svg'] = '<svg><text>A & B</text></svg>'
    if inline:
        case['images'] = images
    else:
        del case['images']
    class Provider:
        repairs = []
        def chat(self, messages, **kwargs):
            req = json.loads(messages[1]['content'])
            if 'example' in req:
                return json.dumps({'images': images})
            self.repairs.append(req['view'])
            return '<svg><text>A &amp; B</text></svg>'
    provider = Provider()
    illustrate_test_cases(provider, contract, 'en', 'Game UI')
    assert provider.repairs == ['view_of_other']
    assert case['images'][0] == images[0]
    flow.validate_artifact('tests', contract)


def test_reopened_test_proposal_reuses_verified_cases_after_network_failure():
    from copy import deepcopy
    from game_platform.builder_jobs import propose_step
    p,d = setup_draft()
    artifacts = d.builder_workflow['artifacts']
    contract = deepcopy(artifacts['tests']['value'])
    pictures = {case['name']:case.pop('images') for case in contract['cases']}
    outlines = [{k: c[k] for k in ('name', 'kind', 'description')} for c in contract['cases']]
    schemas = {k: contract[k] for k in ('state_schema', 'view_schema', 'move_schema')}
    full = {case['name']: case for case in contract['cases']}
    illustrated = []
    failing = {'enabled': True}
    class Provider:
        def chat_with_reasoning(self, messages, **opts):
            instruction = messages[0]['content']
            data = json.loads(messages[1]['content'])
            if instruction.startswith('Plan the requested tests'):
                value = {**schemas, 'cases': outlines, 'message': 'Review cases'}
            elif instruction.startswith('Write only the single'):
                value = full[data['outline']['name']]
            else:
                name = data['example']['name']
                illustrated.append(name)
                if failing['enabled'] and name == outlines[-1]['name']:
                    raise TimeoutError()
                value = {'images':pictures[name]}
            return ChatResult(json.dumps(value),prompt_tokens=10,completion_tokens=10)
    cfg = SimpleNamespace(builder_input_usd_per_million=1,builder_output_usd_per_million=1,builder_max_input_tokens=10000)
    def run(draft):
        return propose_step(BudgetedModel(Provider(),cfg,p,draft.owner_user_id,draft),draft,'tests','Use three cases')
    with pytest.raises(TimeoutError):
        run(d)
    reopened = p.get_game_draft(caller_id=d.owner_user_id,draft_id=d.id)
    assert reopened.builder_workflow['pending_generation']['progress']['request_text']=='Use three cases'
    illustrated.clear()
    failing['enabled'] = False
    result = run(reopened)
    # The reopened draft resumes the saved proposal: only the illustrations
    # that never completed are requested again, not the whole set.
    assert outlines[-1]['name'] in illustrated
    assert len(illustrated) <= 2
    assert 'pending_generation' not in result.builder_workflow
    flow.validate_artifact('tests',result.builder_workflow['artifacts']['tests']['value'])


@pytest.mark.parametrize("extra_data", [False, True])
def test_test_proposal_repairs_invalid_data_before_drawing(extra_data):
    from copy import deepcopy
    from game_platform.builder_jobs import propose_step
    d = approved_draft()
    contract = deepcopy(d.builder_workflow['artifacts']['tests']['value'])
    pictures = {case['name']: case.pop('images') for case in contract['cases']}
    outlines = [{k: c[k] for k in ('name', 'kind', 'description')} for c in contract['cases']]
    schemas = {k: contract[k] for k in ('state_schema', 'view_schema', 'move_schema')}
    full = {case['name']: case for case in contract['cases']}
    # A duplicated case name is a set-level error no single-case repair can
    # fix, so the whole-contract repair remains the fallback for it.
    duplicated = outlines + [dict(outlines[1])]
    calls = []
    class Provider:
        def chat(self,messages,**options):
            instruction = messages[0]['content']
            calls.append(instruction.split()[0])
            if instruction.startswith('Repair'):
                if extra_data and calls.count('Repair') == 1:
                    return json.dumps({**contract, 'cases': [
                        {**case, 'images': pictures[case['name']]} for case in contract['cases']]}) + ' {}'
                return json.dumps({**contract, 'cases': [
                    {**case, 'images': pictures[case['name']]} for case in contract['cases']]})
            if instruction.startswith('Plan'):
                return json.dumps({**schemas, 'cases': duplicated, 'message': 'Review'})
            if instruction.startswith('Write'):
                name = json.loads(messages[1]['content'])['outline']['name']
                return json.dumps(full[name])
            raise AssertionError(instruction)
    draft = propose_step(Provider(),d,'tests','Review tests')
    assert calls[0] == 'Plan'
    assert calls.count('Repair') == 1 + (1 if extra_data else 0)
    flow.validate_artifact('tests',draft.builder_workflow['artifacts']['tests']['value'])


def test_case_repair_regenerates_only_the_broken_case():
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    contract = copy.deepcopy(draft.builder_workflow['artifacts']['tests']['value'])
    cases = contract.pop('cases')
    originals = {case['name']: case.pop('images') for case in cases}
    outlines = [{k: c[k] for k in ('name', 'kind', 'description')} for c in cases]
    singles = []
    instructions = []
    class Provider:
        def chat(self, messages, **options):
            instruction = messages[0]['content']
            instructions.append(instruction)
            if instruction.startswith('Plan the requested tests'):
                return json.dumps(dict(contract, cases=outlines, message='Review the examples'))
            if instruction.startswith('Write only the single'):
                payload = json.loads(messages[1]['content'])
                singles.append(payload)
                case = next(c for c in cases if c['name'] == payload['outline']['name'])
                if payload['outline']['name'] == 'Intermediate move' and 'validation_error' not in payload:
                    case = {k: v for k, v in case.items() if k != 'move'}
                return json.dumps(case)
            if instruction.startswith('Illustrate only this one'):
                name = json.loads(messages[1]['content'])['example']['name']
                return json.dumps({'images': originals[name]})
            raise AssertionError(instruction)
    result = propose_step(Provider(), draft, 'tests', 'Check these moves')
    artifact = result.builder_workflow['artifacts']['tests']['value']
    flow.validate_artifact('tests', artifact)
    # The tests pipeline goes straight to the plan now: no doomed attempt
    # at the whole contract in a single reply.
    assert not any(i.startswith('You help a person specify') for i in instructions)
    regens = [p for p in singles if 'validation_error' in p]
    assert len(regens) == 1
    assert regens[0]['outline']['name'] == 'Intermediate move'
    assert 'Test is missing move' in regens[0]['validation_error']


def test_case_repair_drops_a_case_that_keeps_failing():
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    contract = copy.deepcopy(draft.builder_workflow['artifacts']['tests']['value'])
    cases = contract.pop('cases')
    originals = {case['name']: case.pop('images') for case in cases}
    extra = copy.deepcopy(next(c for c in cases if c['name'] == 'Intermediate move'))
    extra['name'] = 'Second intermediate'
    all_cases = cases + [extra]
    originals['Second intermediate'] = originals['Intermediate move']
    outlines = [{k: c[k] for k in ('name', 'kind', 'description')} for c in all_cases]
    class Provider:
        def chat(self, messages, **options):
            instruction = messages[0]['content']
            if instruction.startswith('Plan the requested tests'):
                return json.dumps(dict(contract, cases=outlines, message='Review the examples'))
            if instruction.startswith('Write only the single'):
                payload = json.loads(messages[1]['content'])
                case = next(c for c in all_cases if c['name'] == payload['outline']['name'])
                if payload['outline']['name'] == 'Second intermediate':
                    case = {k: v for k, v in case.items() if k != 'move'}
                elif payload['outline']['name'] == cases[0]['name']:
                    # Differ from the approved artifact so the proposal (and
                    # its message) is recorded rather than treated as a
                    # no-change re-proposal.
                    case = {**case, 'description': case['description'] + ' (regenerated)'}
                return json.dumps(case)
            if instruction.startswith('Illustrate only this one'):
                name = json.loads(messages[1]['content'])['example']['name']
                return json.dumps({'images': originals[name]})
            raise AssertionError(instruction)
    result = propose_step(Provider(), draft, 'tests', 'Check these moves')
    artifact = result.builder_workflow['artifacts']['tests']['value']
    flow.validate_artifact('tests', artifact)
    assert [c['name'] for c in artifact['cases']] == [c['name'] for c in cases]
    assert any('Second intermediate' in entry.get('text', '')
               for entry in result.builder_workflow['conversation'])


def test_terminally_failed_checkpoint_is_discarded():
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    contract = copy.deepcopy(draft.builder_workflow['artifacts']['tests']['value'])
    cases = contract.pop('cases')
    originals = {case['name']: case.pop('images') for case in cases}
    outlines = [{k: c[k] for k in ('name', 'kind', 'description')} for c in cases]
    duplicated = outlines + [dict(outlines[1])]
    class Failing:
        def chat(self, messages, **options):
            instruction = messages[0]['content']
            if instruction.startswith('Plan the requested tests'):
                return json.dumps(dict(contract, cases=duplicated, message='Review the examples'))
            if instruction.startswith('Write only the single'):
                name = json.loads(messages[1]['content'])['outline']['name']
                return json.dumps(next(c for c in cases if c['name'] == name))
            return '{"broken":"'
        def checkpoint(self, key, progress):
            self.saved = copy.deepcopy({'key': key, 'progress': progress})
    failing = Failing()
    with pytest.raises(ValueError, match='start over'):
        propose_step(failing, draft, 'tests', 'Check these moves')
    assert failing.saved['progress'].get('discarded') is True
    draft.builder_workflow['pending_generation'] = failing.saved
    planned = []
    class Healthy:
        def chat(self, messages, **options):
            instruction = messages[0]['content']
            if instruction.startswith('Plan the requested tests'):
                planned.append(instruction)
                return json.dumps(dict(contract, cases=outlines, message='Review the examples'))
            if instruction.startswith('Write only the single'):
                name = json.loads(messages[1]['content'])['outline']['name']
                return json.dumps(next(c for c in cases if c['name'] == name))
            if instruction.startswith('Illustrate only this one'):
                name = json.loads(messages[1]['content'])['example']['name']
                return json.dumps({'images': originals[name]})
            raise AssertionError(instruction)
    result = propose_step(Healthy(), draft, 'tests', 'Check these moves')
    # The discarded checkpoint was not resumed: generation started fresh.
    assert planned
    flow.validate_artifact('tests', result.builder_workflow['artifacts']['tests']['value'])


def test_repair_parse_failure_reports_the_real_problem():
    # When the whole-contract repair replies are malformed JSON, the
    # error the user sees must still name the actual validation problem
    # with the artifact, not the JSON parse noise that killed the repair.
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    contract = copy.deepcopy(draft.builder_workflow['artifacts']['tests']['value'])
    cases = contract.pop('cases')
    for case in cases:
        case.pop('images')
    outlines = [{k: c[k] for k in ('name', 'kind', 'description')} for c in cases]
    duplicated = outlines + [dict(outlines[1])]
    class Failing:
        def chat(self, messages, **options):
            instruction = messages[0]['content']
            if instruction.startswith('Plan the requested tests'):
                return json.dumps(dict(contract, cases=duplicated, message='Review the examples'))
            if instruction.startswith('Write only the single'):
                name = json.loads(messages[1]['content'])['outline']['name']
                return json.dumps(next(c for c in cases if c['name'] == name))
            return '{"broken":"'
        def checkpoint(self, key, progress):
            pass
    with pytest.raises(ValueError) as excinfo:
        propose_step(Failing(), draft, 'tests', 'Check these moves')
    message = str(excinfo.value)
    assert 'Test names must be unique' in message
    assert 'not valid JSON' in message
    assert message.index('Test names must be unique') < message.index('not valid JSON')


def test_garbled_repair_replies_are_rerolled_inside_the_job():
    # Torn envelopes must not reach the user: two unparseable repair
    # replies are re-rolled automatically, the third (valid) one repairs
    # the set, and the proposal completes in the same job.
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    contract = copy.deepcopy(draft.builder_workflow['artifacts']['tests']['value'])
    cases = contract.pop('cases')
    originals = {case['name']: case.pop('images') for case in cases}
    outlines = [{k: c[k] for k in ('name', 'kind', 'description')} for c in cases]
    duplicated = outlines + [dict(outlines[1])]
    repairs = []
    class Flaky:
        def chat(self, messages, **options):
            instruction = messages[0]['content']
            if instruction.startswith('Plan the requested tests'):
                return json.dumps(dict(contract, cases=duplicated, message='Review the examples'))
            if instruction.startswith('Write only the single'):
                name = json.loads(messages[1]['content'])['outline']['name']
                return json.dumps(next(c for c in cases if c['name'] == name))
            if instruction.startswith('Repair the specific'):
                repairs.append(1)
                if len(repairs) <= 2:
                    return '{"broken":"'
                return json.dumps(dict(contract, cases=cases))
            if instruction.startswith('Illustrate only this one'):
                name = json.loads(messages[1]['content'])['example']['name']
                return json.dumps({'images': originals[name]})
            raise AssertionError(instruction)
        def checkpoint(self, key, progress):
            pass
    result = propose_step(Flaky(), draft, 'tests', 'Check these moves')
    assert len(repairs) == 3
    artifact = result.builder_workflow['artifacts']['tests']['value']
    flow.validate_artifact('tests', artifact)
    assert [c['name'] for c in artifact['cases']] == [c['name'] for c in cases]


def test_unversioned_checkpoint_is_ignored():
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    contract = copy.deepcopy(draft.builder_workflow['artifacts']['tests']['value'])
    cases = contract.pop('cases')
    originals = {case['name']: case.pop('images') for case in cases}
    outlines = [{k: c[k] for k in ('name', 'kind', 'description')} for c in cases]
    class Flaky:
        def chat(self, messages, **options):
            instruction = messages[0]['content']
            if instruction.startswith('Plan the requested tests'):
                return json.dumps(dict(contract, cases=outlines, message='Review the examples'))
            if instruction.startswith('Write only the single'):
                name = json.loads(messages[1]['content'])['outline']['name']
                return json.dumps(next(c for c in cases if c['name'] == name))
            raise TimeoutError()
        def checkpoint(self, key, progress):
            self.saved = copy.deepcopy({'key': key, 'progress': progress})
    flaky = Flaky()
    with pytest.raises(TimeoutError):
        propose_step(flaky, draft, 'tests', 'Check these moves')
    saved = flaky.saved
    assert saved['progress'].get('v') == 1
    # A checkpoint in the pre-versioning shape (no stamp) must not resume.
    del saved['progress']['v']
    draft.builder_workflow['pending_generation'] = saved
    planned = []
    class Healthy:
        def chat(self, messages, **options):
            instruction = messages[0]['content']
            if instruction.startswith('Plan the requested tests'):
                planned.append(instruction)
                return json.dumps(dict(contract, cases=outlines, message='Review the examples'))
            if instruction.startswith('Write only the single'):
                name = json.loads(messages[1]['content'])['outline']['name']
                return json.dumps(next(c for c in cases if c['name'] == name))
            if instruction.startswith('Illustrate only this one'):
                name = json.loads(messages[1]['content'])['example']['name']
                return json.dumps({'images': originals[name]})
            raise AssertionError(instruction)
    result = propose_step(Healthy(), draft, 'tests', 'Check these moves')
    assert planned
    flow.validate_artifact('tests', result.builder_workflow['artifacts']['tests']['value'])


def test_feedback_routes_to_spec_and_requires_reapproval():
    from game_platform.builder_jobs import propose_step
    d=approved_draft()
    original=d.builder_workflow['artifacts']['logic']['value']
    class Model:
        def chat(self,messages,**kwargs):
            if messages[0]['content'].startswith('You audit a game specification'):
                return '{"findings":[]}'
            assert 'earliest artifact' in messages[0]['content']
            return json.dumps({'target_step':'logic','message':'Clarify the winning total',
                'artifact':{**original,'text':'Reach exactly four to win.'}})
    changed=propose_step(Model(),d,'tests','It stops at three; I wanted four.',feedback=True)
    assert changed.builder_workflow['review_step']=='logic'
    assert changed.builder_workflow['artifacts']['logic']['status']=='draft'
    assert changed.builder_workflow['artifacts']['ui']['status']=='stale'
    assert changed.builder_workflow['final_approval'] is None
    assert changed.code==d.code
    assert changed.builder_workflow['history'][-1]['value']==original
    with pytest.raises(InvalidRequestError,match='pending'):
        propose_step(Model(),changed,'tests','Another problem',feedback=True)


def test_translation_requires_complete_keys_and_preserves_placeholders():
    from game_platform.builder_tutorial import validate_translations
    source={'win':'{name} wins with {count} points'}
    validate_translations(source,{'win':'{name} gana con {count} puntos'})
    for invalid in ({}, {'win':'Gana'}, {'win':None}, {'win':'{name} wins with {count} points','extra':'text'}):
        with pytest.raises(ValueError):validate_translations(source,invalid)


def test_tutorial_dynamic_vocabulary_and_legacy_upgrade_message():
    from game_platform.builder_tutorial import vocabulary
    from game_platform.game_text import HELPER_JS
    html='''<meta name="viewport" content="width=device-width"><h1>Learn</h1>
<script type="application/json" id="i18n-strings">{"result":"Total: {count}"}</script>
<button id="result"></button><script>'''+HELPER_JS+'''
let n=0;function render(){result.textContent=t('result',{count:n});}
result.onclick=()=>{n++;render();};window.addEventListener('message',e=>{if(e.data.type==='tutorial_locale'){applyLocale(e.data);render();}});render();</script>'''
    assert 'Total: {count}' in vocabulary(html)
    flow.validate_artifact('tutorial',{'text':'Learn','html':html})
    with pytest.raises(InvalidRequestError,match='Regenerate'):
        flow.validate_artifact('tutorial',{'text':'Learn','html':'<meta name="viewport"><script>document.body.textContent="Won"</script>'})


@pytest.mark.parametrize("repair", [False, True])
def test_tutorial_raw_html_validates_and_repairs_once(repair):
    from game_platform.builder_jobs import propose_step
    import copy
    draft = approved_draft()
    before = copy.deepcopy(draft.builder_workflow)
    valid = '<html><head><title>Practice</title><meta name="viewport"></head><body><script id="i18n-strings" type="application/json">{"ready":"Ready"}</script><script>const eventType="tutorial_locale"; label.textContent=t("ready");</script></body></html>'
    invalid = valid.replace('t("ready")', '"Untranslated message"')
    class Provider:
        calls = 0
        def chat(self, messages, **kwargs):
            self.calls += 1
            if self.calls == 2:
                assert "Tutorial translation" in messages[-1]['content']
                assert "literal_key" in messages[-1]['content']
            return invalid if repair and self.calls == 1 else valid
    provider = Provider()
    result = propose_step(provider, draft, 'tutorial', 'Make a concise tutorial')
    assert provider.calls == (2 if repair else 1)
    assert result.builder_workflow['artifacts']['tutorial']['value']['html'] == valid
    assert result.builder_workflow['artifacts']['tutorial']['status'] == 'draft'
    assert draft.builder_workflow == before


def test_tutorial_failed_repair_preserves_approvals_and_stops():
    from game_platform.builder_jobs import propose_step
    import copy
    draft = approved_draft()
    before = copy.deepcopy(draft.builder_workflow)
    class Provider:
        calls = 0
        def chat(self, messages, **kwargs):
            self.calls += 1
            return '<html><meta name="viewport"><script>label.textContent="Not translated";</script></html>'
    provider = Provider()
    with pytest.raises(InvalidRequestError, match='after one automatic repair'):
        propose_step(provider, draft, 'tutorial', 'Teach the game')
    assert provider.calls == 2
    assert draft.builder_workflow == before


def test_tutorial_generation_failure_retries_once_with_specific_error():
    from game_platform.builder_jobs import propose_step
    from game_platform.model_api import ModelApiError
    draft = approved_draft()
    valid = '<html><head><title>Practice</title><meta name="viewport"></head><body><script id="i18n-strings" type="application/json">{"ready":"Ready"}</script><script>const eventType="tutorial_locale"; label.textContent=t("ready");</script></body></html>'
    class Flaky:
        calls = 0
        def chat(self, messages, **kwargs):
            self.calls += 1
            if self.calls == 1:
                raise ModelApiError('Muse returned an empty reply.')
            assert 'could not be used' in messages[-1]['content']
            return valid
    provider = Flaky()
    result = propose_step(provider, draft, 'tutorial', 'Teach the game')
    assert provider.calls == 2
    assert result.builder_workflow['artifacts']['tutorial']['value']['html'] == valid
    class Down:
        def chat(self, messages, **kwargs):
            raise ModelApiError('Muse returned an empty reply.')
    with pytest.raises(InvalidRequestError, match='Tutorial generation failed after one retry'):
        propose_step(Down(), draft, 'tutorial', 'Teach the game')


def test_conditional_tutorial_messages_and_joined_fragments():
    from game_platform.game_text import lint
    table = '<script id="i18n-strings" type="application/json">{"win":"Winner","start":"Start"}</script>'
    assert lint(table + "label.textContent = ended ? t('win') : t('start');") == []
    assert any('joining pieces' in msg for msg in lint(table + "label.textContent = t('win')+' '+t('start');"))
    assert any('Hardcoded' in msg for msg in lint(table + "label.textContent = ended ? t('win') : 'Hardcoded';"))


def test_image_step_resumes_at_failed_drawing():
    from game_platform.builder_jobs import propose_step
    platform, draft = setup_draft()
    calls = []
    systems = {}
    captions = ['Cover', 'Start', 'Middle', 'End']
    class Provider:
        def chat_with_reasoning(self, messages, **options):
            payload = json.loads(messages[1]['content'])
            label = payload.get('draw', 'plan')
            calls.append(label)
            systems[label] = messages[0]['content']
            if label == 'Middle' and calls.count(label) == 1:
                raise TimeoutError()
            if label == 'plan':
                raw = json.dumps({'message':'Review images', 'captions':captions})
            elif label == 'Cover' and calls.count(label) == 1:
                raw = '<svg><text>Invalid cover</text></svg>'
            else:
                raw = '<svg viewBox="0 0 160 90"><circle r="4"/></svg>'
            return ChatResult(raw,prompt_tokens=12,completion_tokens=20)
    cfg = SimpleNamespace(builder_input_usd_per_million=1,builder_output_usd_per_million=1,builder_max_input_tokens=10000)
    def run(d):
        return propose_step(BudgetedModel(Provider(),cfg,platform,d.owner_user_id,d),d,'images','Please draw the example board')
    with pytest.raises(TimeoutError):
        run(draft)
    reopened = platform.get_game_draft(caller_id=draft.owner_user_id, draft_id=draft.id)
    result = run(reopened)
    assert calls == ['plan','Cover','Cover','Start','Middle','Middle','End']
    images = result.builder_workflow['artifacts']['images']
    assert images['status'] == 'draft'
    assert [i['caption'] for i in images['value']['images']] == captions
    assert 'pending_generation' not in result.builder_workflow
    # The cover brief is planned faithfully (flat board, exact grid) and only
    # the cover drawing carries the cover-fidelity clause, not screenshots.
    assert 'top-down or straight-on' in systems['plan']
    assert 'never scattered pieces' in systems['plan']
    assert 'Recount the rows and columns' in systems['Cover']
    assert 'Recount the rows and columns' not in systems['Start']


def test_review_output_limit_is_bounded_and_names_failed_stage():
    from game_platform import builder_jobs
    from game_platform.model_api import ModelOutputLimitError
    p,d=setup_draft()
    d=p.change_builder_workflow(caller_id=d.owner_user_id,draft_id=d.id,expected_revision=d.revision,change=flow.begin_build)
    f=fixture()
    class Model:
        reviews=0
        def chat(self,messages,**kwargs):
            if 'Review game server' in messages[0]['content']:
                self.reviews+=1
                raise ModelOutputLimitError('output limit')
            return f['server_code']
    model=Model()
    builder_jobs.run_build(p,model,d.owner_user_id,d.id,d.builder_workflow['job']['id'])
    saved=p.get_game_draft(caller_id=d.owner_user_id,draft_id=d.id)
    job=saved.builder_workflow['job']
    assert model.reviews==2
    assert job['status']=='failed'
    assert 'Reviewing server:' in job['error']
    assert 'output limit twice' in job['error']
    assert 'code_digest' not in job


def test_expansion_stamps_outline_name_and_kind():
    # A case that re-decides its own kind during expansion silently breaks
    # the composition the plan was checked against (the failure behind
    # "Provide 1–4 intermediate test cases" on a correction). The outline's
    # name and kind are determined values, so expansion stamps them.
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    contract = copy.deepcopy(draft.builder_workflow['artifacts']['tests']['value'])
    cases = contract.pop('cases')
    originals = {case['name']: case.pop('images') for case in cases}
    outlines = [{k: c[k] for k in ('name', 'kind', 'description')} for c in cases]
    repair_calls = []
    class Provider:
        def chat(self, messages, **options):
            instruction = messages[0]['content']
            if instruction.startswith('Plan the requested tests'):
                return json.dumps(dict(contract, cases=outlines, message='Review the examples'))
            if instruction.startswith('Write only the single'):
                name = json.loads(messages[1]['content'])['outline']['name']
                case = copy.deepcopy(next(c for c in cases if c['name'] == name))
                if name == 'Terminal move':
                    case['kind'] = 'intermediate'
                return json.dumps(case)
            if instruction.startswith('Illustrate only this one'):
                name = json.loads(messages[1]['content'])['example']['name']
                return json.dumps({'images': originals[name]})
            if instruction.startswith('Repair the specific'):
                repair_calls.append(messages)
            return '{"broken":"'
    result = propose_step(Provider(), draft, 'tests', 'Check these moves')
    artifact = result.builder_workflow['artifacts']['tests']['value']
    assert [c['kind'] for c in artifact['cases']] == ['initial', 'intermediate', 'terminal']
    assert repair_calls == []
    flow.validate_artifact('tests', artifact)


def test_initial_cases_share_one_canonical_start():
    # Two initial cases for the same match configuration recorded two
    # different starting positions (the Pancakes vs Waffles "set difficulty
    # before start" failure: "Initial state differs"). Validation completes
    # the determined value from the first initial case instead of letting
    # the set disagree with itself.
    import copy
    from game_platform.builder_jobs import validate_test_data
    contract = copy.deepcopy(fixture()['contract'])
    second = copy.deepcopy(contract['cases'][0])
    second['name'] = 'Second opening'
    second['state'] = {'n': 2}
    contract['cases'].insert(1, second)
    validate_test_data(contract)
    initials = [c for c in contract['cases'] if c['kind'] == 'initial']
    assert [c['state'] for c in initials] == [{'n': 0}, {'n': 0}]


def test_canonical_start_leaves_other_configurations_alone():
    # An initial case for a different match (different players) has its
    # own starting position and must not be overwritten.
    import copy
    from game_platform.builder_jobs import _complete_determined_fields
    contract = copy.deepcopy(fixture()['contract'])
    other = copy.deepcopy(contract['cases'][0])
    other['name'] = 'Two player opening'
    other['ctx'] = copy.deepcopy(other['ctx'])
    other['ctx']['players'] = [*other['ctx']['players'],
                               {**other['ctx']['players'][0], 'id': 'u2'}]
    other['state'] = {'n': 7}
    contract['cases'].append(other)
    _complete_determined_fields(contract)
    assert other['state'] == {'n': 7}


def test_named_case_correction_patches_only_that_case():
    # A correction naming one existing case regenerates only that case on
    # top of the current set; the whole-set plan path never runs, and the
    # untouched cases keep their exact content, artwork included.
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    before = copy.deepcopy(draft.builder_workflow['artifacts']['tests']['value'])
    calls = {'plan': 0, 'expand': 0, 'repair': 0, 'illustrate': []}
    class Provider:
        def chat(self, messages, **options):
            instruction = messages[0]['content']
            payload = json.loads(messages[1]['content'])
            if instruction.startswith('Plan the requested tests'):
                calls['plan'] += 1
                return '{"broken":"'
            if instruction.startswith('Write only the single'):
                if 'validation_error' not in payload:
                    calls['expand'] += 1
                    return '{"broken":"'
                case = copy.deepcopy(next(c for c in before['cases'] if c['name'] == 'Intermediate move'))
                case.pop('images', None)
                case['description'] = 'Patched description'
                return json.dumps(case)
            if instruction.startswith('Illustrate only this one'):
                calls['illustrate'].append(payload['example']['name'])
                images = next(c['images'] for c in before['cases'] if c['name'] == 'Intermediate move')
                return json.dumps({'images': images})
            if instruction.startswith('Repair the specific'):
                calls['repair'] += 1
            return '{"broken":"'
    result = propose_step(Provider(), draft, 'tests',
                          'In the "Intermediate move" example, describe the position after the first move more clearly')
    artifact = result.builder_workflow['artifacts']['tests']['value']
    assert calls['plan'] == 0 and calls['expand'] == 0 and calls['repair'] == 0
    assert calls['illustrate'] == ['Intermediate move']
    by_name = {c['name']: c for c in artifact['cases']}
    original = {c['name']: c for c in before['cases']}
    assert by_name['Initial move'] == original['Initial move']
    assert by_name['Terminal move'] == original['Terminal move']
    assert by_name['Intermediate move']['description'] == 'Patched description'
    assert by_name['Intermediate move']['images'] == original['Intermediate move']['images']
    flow.validate_artifact('tests', artifact)


def test_repair_operations_patch_instead_of_redrafting():
    # When regeneration cannot fix a case, the whole-set repair may answer
    # with patch operations on the current contract. The named case is
    # replaced; the others keep exactly the content expansion produced.
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    contract = copy.deepcopy(draft.builder_workflow['artifacts']['tests']['value'])
    cases = contract.pop('cases')
    originals = {case['name']: case.pop('images') for case in cases}
    outlines = [{k: c[k] for k in ('name', 'kind', 'description')} for c in cases]
    repair_calls = []
    class Provider:
        def chat(self, messages, **options):
            instruction = messages[0]['content']
            payload = json.loads(messages[1]['content'])
            if instruction.startswith('Plan the requested tests'):
                return json.dumps(dict(contract, cases=outlines, message='Review the examples'))
            if instruction.startswith('Write only the single'):
                name = payload['outline']['name']
                case = copy.deepcopy(next(c for c in cases if c['name'] == name))
                if 'validation_error' in payload:
                    return 'not json at all'
                if name == 'Intermediate move':
                    case['expected_state'] = {'n': 'two'}
                return json.dumps(case)
            if instruction.startswith('Repair the specific'):
                repair_calls.append(messages)
                good = copy.deepcopy(next(c for c in cases if c['name'] == 'Intermediate move'))
                return json.dumps({'message': 'Patched the broken case',
                                    'operations': [{'op': 'replace_case', 'name': 'Intermediate move', 'case': good}]})
            if instruction.startswith('Illustrate only this one'):
                name = payload['example']['name']
                return json.dumps({'images': originals[name]})
            return '{"broken":"'
    result = propose_step(Provider(), draft, 'tests', 'Check these moves')
    artifact = result.builder_workflow['artifacts']['tests']['value']
    assert len(repair_calls) == 1
    assert 'operations' in repair_calls[0][0]['content']
    by_name = {c['name']: c for c in artifact['cases']}
    for name, images in originals.items():
        expected = next(c for c in cases if c['name'] == name)
        assert by_name[name] == {**expected, 'images': images}
    flow.validate_artifact('tests', artifact)


def test_apply_test_operations_guards():
    import copy
    import pytest as _pytest
    from game_platform.builder_jobs import _apply_test_operations
    contract = copy.deepcopy(fixture()['contract'])
    replaced = _apply_test_operations(contract, [
        {'op': 'replace_case', 'name': 'Initial move',
         'case': {**contract['cases'][0], 'description': 'New text'}}], protected=[])
    assert replaced['cases'][0]['description'] == 'New text'
    assert contract['cases'][0]['description'] != 'New text'
    with _pytest.raises(ValueError, match='may not drop'):
        _apply_test_operations(contract, [{'op': 'remove_case', 'name': 'Initial move'}],
                               protected=['Initial move'])
    with _pytest.raises(ValueError, match='unknown case'):
        _apply_test_operations(contract, [{'op': 'remove_case', 'name': 'Nope'}], protected=[])
    with _pytest.raises(ValueError, match='duplicates'):
        _apply_test_operations(contract, [{'op': 'add_case', 'case': contract['cases'][0]}], protected=[])
    with _pytest.raises(ValueError, match='unknown operation'):
        _apply_test_operations(contract, [{'op': 'rewrite_everything'}], protected=[])
    reschemaed = _apply_test_operations(contract, [
        {'op': 'set_schema', 'field': 'state_schema', 'schema': {'type': 'object'}}], protected=[])
    assert reschemaed['state_schema'] == {'type': 'object'}


def test_divergent_difficulty_opening_is_canonicalized_end_to_end():
    # Replay of the local Pancakes vs Waffles failure: the plan adds a
    # second initial case (a difficulty setup) whose expansion records a
    # different starting position than the opening case. The proposal
    # completes the determined start instead of shipping a set whose cases
    # disagree — the build later failed exactly that case with
    # "Initial state differs".
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    contract = copy.deepcopy(draft.builder_workflow['artifacts']['tests']['value'])
    cases = contract.pop('cases')
    originals = {case['name']: case.pop('images') for case in cases}
    outlines = [{k: c[k] for k in ('name', 'kind', 'description')} for c in cases]
    outlines.insert(1, {'name': 'Set difficulty first', 'kind': 'initial',
                        'description': 'Set difficulty before the first move'})
    repair_calls = []
    class Provider:
        def chat(self, messages, **options):
            instruction = messages[0]['content']
            payload = json.loads(messages[1]['content'])
            if instruction.startswith('Plan the requested tests'):
                return json.dumps(dict(contract, cases=outlines, message='Review the examples'))
            if instruction.startswith('Write only the single'):
                name = payload['outline']['name']
                if name == 'Set difficulty first':
                    case = copy.deepcopy(next(c for c in cases if c['name'] == 'Initial move'))
                    case['name'] = name
                    case['description'] = 'Set difficulty before the first move'
                    case['state'] = {'n': 2}
                    return json.dumps(case)
                return json.dumps(copy.deepcopy(next(c for c in cases if c['name'] == name)))
            if instruction.startswith('Illustrate only this one'):
                return json.dumps({'images': originals['Initial move']})
            if instruction.startswith('Repair the specific'):
                repair_calls.append(messages)
            return '{"broken":"'
    result = propose_step(Provider(), draft, 'tests', 'Check these moves')
    artifact = result.builder_workflow['artifacts']['tests']['value']
    by_name = {c['name']: c for c in artifact['cases']}
    assert by_name['Set difficulty first']['state'] == by_name['Initial move']['state'] == {'n': 0}
    assert repair_calls == []
    flow.validate_artifact('tests', artifact)


def _audit_provider(generated, audit_reply, fix_artifact=None, calls=None):
    """A provider for prose proposals: generation, then the audit pass."""
    import copy
    calls = calls if calls is not None else {'generation': 0, 'audit': 0, 'fix': 0, 'audit_payloads': []}
    class Provider:
        def chat(self, messages, **options):
            instruction = messages[0]['content']
            if instruction.startswith('You audit a game specification'):
                calls['audit'] += 1
                calls['audit_payloads'].append(messages)
                if isinstance(audit_reply, Exception):
                    raise audit_reply
                return audit_reply
            if instruction.startswith('Apply these audit corrections'):
                calls['fix'] += 1
                return json.dumps({'message': 'Fixed', 'artifact': fix_artifact})
            if instruction.startswith('You help a person specify'):
                calls['generation'] += 1
                return json.dumps({'message': 'Review this draft', 'artifact': copy.deepcopy(generated)})
            return '{"broken":"'
    return Provider(), calls


def test_audit_corrects_mechanical_finding_before_review():
    # A worked example that contradicts the stated rules is the audit's
    # home case: the finding is mechanical, so one fix regeneration runs
    # and the corrected artifact — not the flawed one — reaches the user.
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    logic = copy.deepcopy(draft.builder_workflow['artifacts']['logic']['value'])
    flawed = {**logic, 'text': 'RULES with a wrong example'}
    fixed = {**logic, 'text': 'RULES with the example corrected'}
    finding = {'where': 'Section 7', 'claim': 'h at (2,3) overlaps h at (2,2)',
               'expected': 'h at (3,2) overlaps h at (2,2)', 'severity': 'mechanical'}
    provider, calls = _audit_provider(flawed, json.dumps({'findings': [finding]}), fix_artifact=fixed)
    result = propose_step(provider, draft, 'logic', '')
    artifact = result.builder_workflow['artifacts']['logic']['value']
    assert artifact['text'] == 'RULES with the example corrected'
    assert calls == {'generation': 1, 'audit': 1, 'fix': 1, 'audit_payloads': calls['audit_payloads']}
    message = result.builder_workflow['conversation'][-1]['text']
    assert 'automatic audit corrected' in message and 'Section 7' in message


def test_audit_clean_draft_passes_through_untouched():
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    logic = copy.deepcopy(draft.builder_workflow['artifacts']['logic']['value'])
    generated = {**logic, 'text': 'RULES, lightly revised and clean'}
    provider, calls = _audit_provider(generated, '{"findings":[]}')
    result = propose_step(provider, draft, 'logic', '')
    assert result.builder_workflow['artifacts']['logic']['value'] == generated
    assert calls['audit'] == 1 and calls['fix'] == 0
    assert result.builder_workflow['conversation'][-1]['text'] == 'Review this draft'


def test_audit_unavailable_never_blocks_the_proposal():
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    logic = copy.deepcopy(draft.builder_workflow['artifacts']['logic']['value'])
    generated = {**logic, 'text': 'RULES, revised while the audit is down'}
    provider, calls = _audit_provider(generated, ModelApiError('audit service down'))
    result = propose_step(provider, draft, 'logic', '')
    assert result.builder_workflow['artifacts']['logic']['value'] == generated
    assert 'audit was unavailable' in result.builder_workflow['conversation'][-1]['text']


def test_audit_decision_findings_are_notes_not_fixes():
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    logic = copy.deepcopy(draft.builder_workflow['artifacts']['logic']['value'])
    finding = {'where': 'Section 5', 'claim': 'the default difficulty is ambiguous',
               'expected': 'the author decides', 'severity': 'decision'}
    generated = {**logic, 'text': 'RULES with an ambiguous default'}
    provider, calls = _audit_provider(generated, json.dumps({'findings': [finding]}))
    result = propose_step(provider, draft, 'logic', '')
    assert result.builder_workflow['artifacts']['logic']['value'] == generated
    assert calls['fix'] == 0
    message = result.builder_workflow['conversation'][-1]['text']
    assert 'Worth a look before approving' in message and 'Section 5' in message


def test_audit_failed_fix_keeps_original_and_warns():
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    logic = copy.deepcopy(draft.builder_workflow['artifacts']['logic']['value'])
    finding = {'where': 'Section 7', 'claim': 'wrong example', 'expected': 'right example',
               'severity': 'mechanical'}
    generated = {**logic, 'text': 'RULES with a wrong example'}
    provider, calls = _audit_provider(generated, json.dumps({'findings': [finding]}), fix_artifact={})
    result = propose_step(provider, draft, 'logic', '')
    assert result.builder_workflow['artifacts']['logic']['value'] == generated
    assert calls['fix'] == 1
    assert 'found possible problems' in result.builder_workflow['conversation'][-1]['text']


def test_ui_audit_sees_logic_source_and_platform_constraints():
    # The ui audit cross-checks against the approved rules and carries the
    # platform's client constraints; the ui generation prompt states the
    # 30px floor too, so the generator hears the number the checker uses.
    import copy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    logic = copy.deepcopy(draft.builder_workflow['artifacts']['logic']['value'])
    generation_instructions = []
    class Provider:
        def chat(self, messages, **options):
            instruction = messages[0]['content']
            if instruction.startswith('You audit a game specification'):
                Provider.audit_messages = messages
                return '{"findings":[]}'
            if instruction.startswith('You help a person specify'):
                generation_instructions.append(instruction)
                return json.dumps({'message': 'Review the layout', 'artifact': {'text': 'UI SPEC'}})
            return '{"broken":"'
    result = propose_step(Provider(), draft, 'ui', '')
    assert result.builder_workflow['artifacts']['ui']['value'] == {'text': 'UI SPEC'}
    audit_system, audit_user = Provider.audit_messages
    assert '30px' in audit_system['content'] and '844x390' in audit_system['content']
    payload = json.loads(audit_user['content'])
    assert payload['approved_sources']['logic'] == logic
    assert '30px' in generation_instructions[0] and '844x390' in generation_instructions[0]


def test_prose_prompts_carry_length_budget_and_audit_checks_completeness():
    # The rules/layout prompts target about a page and forbid restating the
    # platform contract (the build injects it separately), while the audit
    # checklist gains the completeness item: shorter must not mean skipped.
    from game_platform.builder_jobs import STEP_PROMPTS, _AUDIT_INSTRUCTION
    assert 'about one page' in STEP_PROMPTS['logic']
    assert 'Do not restate the platform contract' in STEP_PROMPTS['logic']
    assert 'Cut words, never rulings' in STEP_PROMPTS['logic']
    assert 'about one page' in STEP_PROMPTS['ui']
    assert 'Completeness' in _AUDIT_INSTRUCTION


def test_summarize_failures_flattens_reviews_checks_and_examples():
    from game_platform.builder_jobs import _summarize_failures
    errors = [
        {'review_computers': {'passed': False, 'issues': ['fallback returns a hardcoded move',
                                                          'randomMove unguarded']}},
        {'move_agreement': ["example 'opening': randomMove returned a move applyMove rejects"]},
        {'approved_examples': [{'name': 'goal win', 'passed': False, 'error': 'Payouts differ'},
                               {'name': 'opening', 'passed': True}]},
        {'random_walks': 'seed 123 failed'},
    ]
    summary = _summarize_failures(errors)
    assert summary[0] == 'review_computers: fallback returns a hardcoded move'
    assert any(item.startswith('move_agreement:') for item in summary)
    assert 'approved_examples: goal win: Payouts differ' in summary
    assert not any(item.startswith('approved_examples: opening') for item in summary)
    assert summary[-1] == 'random_walks: seed 123 failed'
    assert len(summary) == 5


def test_begin_build_carries_failure_summary_only_for_the_same_spec():
    import copy
    from dataclasses import replace
    from game_platform import builder_flow as flow
    draft = approved_draft()
    workflow = copy.deepcopy(draft.builder_workflow)
    workflow['job'] = {'id': 'old-job', 'status': 'failed',
                       'spec_digest': flow.spec_digest(workflow),
                       'failure_summary': ['review_computers: fallback returns a hardcoded move']}
    draft = replace(draft, builder_workflow=workflow)
    rebuilt = flow.begin_build(draft)
    assert rebuilt.builder_workflow['job']['failure_summary'] == [
        'review_computers: fallback returns a hardcoded move']
    workflow['job']['spec_digest'] = 'a-different-spec'
    draft = replace(draft, builder_workflow=workflow)
    rebuilt = flow.begin_build(draft)
    assert 'failure_summary' not in rebuilt.builder_workflow['job']


TUTORIAL_WITH_DEAD_STRING = """<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Learn</title>
<script type="application/json" id="i18n-strings">{"welcome": "Welcome", "exercise_prompt2": "Never rendered"}</script>
</head><body><p id="w"></p><script>
function show() { document.getElementById("w").textContent = t("welcome"); }
window.addEventListener("message", function (e) { if (e.data && e.data.type === "tutorial_locale") show(); });
show();
</script></body></html>"""


def test_tutorial_dead_strings_are_pruned_not_rejected():
    from game_platform.game_text import absorb_unshown_strings
    artifact = {'text': 'Learn the game', 'html': TUTORIAL_WITH_DEAD_STRING}
    with pytest.raises(InvalidRequestError, match='never shows'):
        flow.validate_artifact('tutorial', artifact)
    pruned, removed = absorb_unshown_strings(TUTORIAL_WITH_DEAD_STRING)
    assert removed == ['exercise_prompt2']
    flow.validate_artifact('tutorial', {'text': 'Learn the game', 'html': pruned})

def test_standalone_svg_adds_namespace_and_viewbox():
    from game_platform.builder_jobs import _standalone_svg
    bare = '<svg width="900" height="600"><rect width="900" height="600" fill="white"/></svg>'
    fixed = _standalone_svg(bare)
    assert 'xmlns="http://www.w3.org/2000/svg"' in fixed
    assert 'viewBox="0 0 900 600"' in fixed
    complete = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" width="160" height="90"></svg>'
    assert _standalone_svg(complete) == complete
    # Without width/height there is no extent to derive a viewBox from.
    no_extent = '<svg><circle r="5"/></svg>'
    assert 'viewBox' not in _standalone_svg(no_extent)
    assert _standalone_svg('not an svg') == 'not an svg'


FAKE_SERVER = (
    "const game={newMatch(ctx){return {state:{n:0},turn:[ctx.players[0].id]};},"
    "applyMove(state,id,move,ctx){if(move.add!==1)throw new InvalidMove('Add one');"
    "const n=state.n+move.add;return {state:{n},turn:[ctx.players[0].id]};},"
    "viewFor(state,id,ctx){return {n:state.n};}};"
)


def test_apply_server_patches_applies_edits_in_order():
    from game_platform.builder_jobs import _apply_server_patches
    patched = _apply_server_patches(FAKE_SERVER, [
        {'find': 'move.add!==1', 'replace': 'move.add!==2'},
        {'find': "throw new InvalidMove('Add one')", 'replace': "throw new InvalidMove('Add two')"},
    ])
    assert "move.add!==2" in patched and "InvalidMove('Add two')" in patched
    # Edits apply sequentially to the evolving text: the second edit's find
    # does not exist in the original source at all — the first edit creates
    # it — so the pair only succeeds if application is sequential.
    with pytest.raises(ValueError):
        _apply_server_patches(FAKE_SERVER, [{'find': '{state:{n:1}', 'replace': '{state:{n:2}'}])
    sequential = _apply_server_patches(FAKE_SERVER, [
        {'find': '{state:{n:0}', 'replace': '{state:{n:1}'},
        {'find': '{state:{n:1}', 'replace': '{state:{n:2}'},
    ])
    assert '{state:{n:2}' in sequential and '{state:{n:0}' not in sequential


def test_apply_server_patches_leaves_untouched_regions_byte_identical():
    from game_platform.builder_jobs import _apply_server_patches
    find = '{state:{n:0}'
    at = FAKE_SERVER.index(find)
    prefix, suffix = FAKE_SERVER[:at], FAKE_SERVER[at + len(find):]
    patched = _apply_server_patches(FAKE_SERVER, [{'find': find, 'replace': '{state:{n:5}'}])
    assert patched == prefix + '{state:{n:5}' + suffix
    assert patched.startswith(prefix) and patched.endswith(suffix)
    assert len(patched) == len(FAKE_SERVER)


def test_apply_server_patches_rejects_unusable_edits():
    from game_platform.builder_jobs import _apply_server_patches
    with pytest.raises(ValueError):
        _apply_server_patches(FAKE_SERVER, [])
    with pytest.raises(ValueError):
        _apply_server_patches(FAKE_SERVER, [{'find': 'n:0', 'replace': 'n:0'}])
    with pytest.raises(ValueError):
        _apply_server_patches(FAKE_SERVER, [{'find': '', 'replace': 'x'}])
    with pytest.raises(ValueError):
        _apply_server_patches(FAKE_SERVER, [{'find': 'no such text anywhere', 'replace': 'x'}])
    # 'state' occurs many times: a find that is not unique cannot be applied.
    with pytest.raises(ValueError):
        _apply_server_patches(FAKE_SERVER, [{'find': 'state', 'replace': 'x'}])
    with pytest.raises(ValueError):
        _apply_server_patches(FAKE_SERVER, [{'find': '{n:0}'}])
    with pytest.raises(ValueError):
        _apply_server_patches(FAKE_SERVER, [{'find': f'x{i}', 'replace': 'y'} for i in range(13)])
    with pytest.raises(ValueError):
        _apply_server_patches(FAKE_SERVER, 'not a list')


def _patch_repair_model(fixture_value, broken, patch_reply):
    """Scripted model for a two-attempt build: attempt 1 generates the
    broken server (full file), attempt 2 is offered the patch request."""
    import json as _json

    class Model:
        server_generations = 0
        patch_calls = 0
        diagnoses = 0

        def chat(self, messages, **kwargs):
            first = messages[0]['content']
            last = messages[-1].get('content', '') if isinstance(messages[-1].get('content'), str) else ''
            if 'targeted edits' in last:
                self.patch_calls += 1
                return _json.dumps(patch_reply)
            if isinstance(first, str) and first.startswith('Determine whether the code or an example'):
                self.diagnoses += 1
                return '{"cause":"implementation"}'
            if isinstance(first, list) or (isinstance(first, str) and 'Review game server' in first):
                return _json.dumps({'passed': True, 'issues': []})
            if any('Now write only the client' in str(m.get('content', '')) for m in messages):
                return _json.dumps({'code': fixture_value['code']})
            self.server_generations += 1
            return _json.dumps({'code': fixture_value['code'],
                                'server_code': broken if self.server_generations == 1 else fixture_value['server_code']})

    return Model()


def _run_patch_repair_build(monkeypatch, model):
    from game_platform import builder_jobs, builder_render
    p, d = setup_draft()
    d = p.change_builder_workflow(caller_id=d.owner_user_id, draft_id=d.id,
                                  expected_revision=d.revision, change=flow.begin_build)
    monkeypatch.setattr('game_platform.builder_visual.review_views', lambda *args: [])
    monkeypatch.setattr(builder_render, 'render_game', lambda *args, **kwargs: [])
    builder_jobs.run_build(p, model, d.owner_user_id, d.id, d.builder_workflow['job']['id'])
    return p.get_game_draft(caller_id=d.owner_user_id, draft_id=d.id)


def test_build_repairs_server_with_targeted_patch(monkeypatch):
    f = fixture()
    broken = f['server_code'].replace('n:0', 'n:1')
    assert broken != f['server_code']
    model = _patch_repair_model(f, broken, {'edits': [{'find': '{state:{n:1}', 'replace': '{state:{n:0}'}]})
    saved = _run_patch_repair_build(monkeypatch, model)
    assert saved.builder_workflow['job']['status'] == 'ready_for_review', saved.builder_workflow['job']
    # The patch was offered once, applied in code, and no second full-file
    # generation happened: the accepted server is attempt 1's file with
    # exactly the one snippet changed — i.e. the fixture server itself.
    assert model.patch_calls == 1 and model.server_generations == 1 and model.diagnoses == 1
    assert saved.server_code == f['server_code']
    assert saved.server_code == broken.replace('{state:{n:1}', '{state:{n:0}')
    assert any('Applied 1 targeted edit' in entry for entry in saved.builder_workflow['job']['log'])


def test_build_falls_back_to_full_generation_when_patch_does_not_apply(monkeypatch):
    f = fixture()
    broken = f['server_code'].replace('n:0', 'n:1')
    assert broken != f['server_code']
    model = _patch_repair_model(f, broken, {'edits': [{'find': 'a snippet that is not in the file', 'replace': 'x'}]})
    saved = _run_patch_repair_build(monkeypatch, model)
    assert saved.builder_workflow['job']['status'] == 'ready_for_review', saved.builder_workflow['job']
    # The unusable patch cost one call and changed nothing: attempt 2 fell
    # back to the full-file generation and the build proceeded as before.
    assert model.patch_calls == 1 and model.server_generations == 2
    assert saved.server_code == f['server_code']


def test_cover_brief_follows_the_authors_ask():
    from game_platform.builder_jobs import _cover_brief
    from game_platform.builder_checks import COVER_CREATIVE, COVER_FIDELITY
    assert _cover_brief('Show the board in its starting position') is COVER_FIDELITY
    assert _cover_brief('A screenshot of the mid-game grid') is COVER_FIDELITY
    assert _cover_brief('The two rivals facing off at sunset, dramatic') is COVER_CREATIVE
    assert _cover_brief('') is COVER_CREATIVE
    assert _cover_brief(None) is COVER_CREATIVE


def test_image_step_creative_cover_when_board_not_mentioned():
    from game_platform.builder_jobs import propose_step
    platform, draft = setup_draft()
    systems = {}
    captions = ['Cover', 'Start', 'Middle', 'End']
    class Provider:
        def chat_with_reasoning(self, messages, **options):
            payload = json.loads(messages[1]['content'])
            label = payload.get('draw', 'plan')
            systems[label] = messages[0]['content']
            if label == 'plan':
                raw = json.dumps({'message':'Review images', 'captions':captions})
            else:
                raw = '<svg viewBox="0 0 160 90"><circle r="4"/></svg>'
            return ChatResult(raw,prompt_tokens=12,completion_tokens=20)
    cfg = SimpleNamespace(builder_input_usd_per_million=1,builder_output_usd_per_million=1,builder_max_input_tokens=10000)
    result = propose_step(BudgetedModel(Provider(),cfg,platform,draft.owner_user_id,draft),draft,'images','Draw the two rivals facing off at sunset')
    assert result.builder_workflow['artifacts']['images']['status'] == 'draft'
    # The plan asks for key art, and only the cover drawing carries the
    # creative brief; screenshots get neither cover brief.
    assert 'key art' in systems['plan']
    assert 'top-down or straight-on' not in systems['plan']
    assert 'Creative cover' in systems['Cover']
    assert 'Recount the rows and columns' not in systems['Cover']
    assert 'Creative cover' not in systems['Start']
    assert 'Cover fidelity' not in systems['Start']
