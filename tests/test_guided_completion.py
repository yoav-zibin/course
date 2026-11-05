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
                    assert kwargs['max_tokens']==8000
                    assert 'previous reply hit its output limit' in messages[-1]['content']
                return '{"passed":true,"issues":[]}'
            if 'Now write only the client' in messages[-1]['content']: return json.dumps({'code':f['code']})
            self.generation+=1
            assert 'CURRENT OUTPUT REQUIRED: Return only the complete executable server JavaScript' in messages[-1]['content']
            if self.generation==1:return 'const game = {}; unexpected prose'
            if self.generation==2:
                assert 'SyntaxError' in messages[-1]['content']
                assert messages[-2]['content']=='const game = {}; unexpected prose'
            if self.generation==3:
                assert 'Missing counter' in messages[-1]['content']
                assert messages[-2]['content']==f['server_code']
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
    assert model.generation==3 and model.reviewed==6
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


def test_test_proposal_requests_illustrations_one_case_at_a_time():
    from copy import deepcopy
    from game_platform.builder_jobs import propose_step
    draft = approved_draft()
    contract = deepcopy(draft.builder_workflow['artifacts']['tests']['value'])
    pictures = {case['name']:case.pop('images') for case in contract['cases']}
    class SplitProvider:
        cases = []
        def chat(self, messages, **kwargs):
            payload = json.loads(messages[1]['content'])
            if 'example' in payload:
                name = payload['example']['name']
                self.cases.append(name)
                return json.dumps({'images':pictures[name]})
            return json.dumps({'message':'Review these cases', 'artifact':contract})
    provider = SplitProvider()
    result = propose_step(provider,draft,'tests','Generate the examples')
    assert provider.cases == list(pictures)
    flow.validate_artifact('tests',result.builder_workflow['artifacts']['tests']['value'])


def test_logic_proposal_retries_once_after_output_limit():
    from game_platform.builder_jobs import propose_step
    from game_platform.model_api import ModelOutputLimitError
    artifact = {'text':'Standard rules: race your pawn home; walls must leave a path.',
                'allowed_player_counts':[2],'allows_join_mid_match':False,'allows_leave_mid_match':False}
    class FlakyProvider:
        calls = 0
        def chat(self, messages, **kwargs):
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
    assert calls == [o['name'] for o in outlines[:2]] + [outlines[2]['name']]*3 + [o['name'] for o in outlines[3:]]
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
    calls = []
    class Provider:
        def chat_with_reasoning(self, messages, **opts):
            data = json.loads(messages[1]['content'])
            if 'example' in data:
                name = data['example']['name']
                calls.append(name)
                if len(calls)==3:
                    raise TimeoutError()
                value = {'images':pictures[name]}
            else:
                calls.append('plan')
                value = {'message':'Review cases','artifact':contract}
            return ChatResult(json.dumps(value),prompt_tokens=10,completion_tokens=10)
    cfg = SimpleNamespace(builder_input_usd_per_million=1,builder_output_usd_per_million=1,builder_max_input_tokens=10000)
    def run(draft):
        return propose_step(BudgetedModel(Provider(),cfg,p,draft.owner_user_id,draft),draft,'tests','Use three cases')
    with pytest.raises(TimeoutError):
        run(d)
    reopened = p.get_game_draft(caller_id=d.owner_user_id,draft_id=d.id)
    assert reopened.builder_workflow['pending_generation']['progress']['request_text']=='Use three cases'
    result = run(reopened)
    assert calls == ['plan',*list(pictures)[:2],*list(pictures)[1:]]
    assert 'pending_generation' not in result.builder_workflow
    flow.validate_artifact('tests',result.builder_workflow['artifacts']['tests']['value'])


@pytest.mark.parametrize("extra_data", [False, True])
def test_test_proposal_repairs_invalid_data_before_drawing(extra_data):
    from copy import deepcopy
    from game_platform.builder_jobs import propose_step
    d = approved_draft()
    contract = d.builder_workflow['artifacts']['tests']['value']
    invalid = deepcopy(contract)
    invalid['cases'][-1]['expected_turn'] = ['unknown-seat']
    calls = []
    class Provider:
        def chat(self,messages,**options):
            calls.append(messages[0]['content'].split()[0])
            if calls[-1]=='Repair':
                if extra_data and calls.count('Repair') == 1:
                    return json.dumps(contract) + ' {}'
                return json.dumps(contract)
            return json.dumps({'message':'Review','artifact':invalid})
    draft = propose_step(Provider(),d,'tests','Review tests')
    assert calls == ['You','Repair'] + (['Repair'] if extra_data else [])
    flow.validate_artifact('tests',draft.builder_workflow['artifacts']['tests']['value'])


def test_feedback_routes_to_spec_and_requires_reapproval():
    from game_platform.builder_jobs import propose_step
    d=approved_draft()
    original=d.builder_workflow['artifacts']['logic']['value']
    class Model:
        def chat(self,messages,**kwargs):
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
    captions = ['Cover', 'Start', 'Middle', 'End']
    class Provider:
        def chat_with_reasoning(self, messages, **options):
            payload = json.loads(messages[1]['content'])
            label = payload.get('draw', 'plan')
            calls.append(label)
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
        return propose_step(BudgetedModel(Provider(),cfg,platform,d.owner_user_id,d),d,'images','Please draw the example')
    with pytest.raises(TimeoutError):
        run(draft)
    reopened = platform.get_game_draft(caller_id=draft.owner_user_id, draft_id=draft.id)
    result = run(reopened)
    assert calls == ['plan','Cover','Cover','Start','Middle','Middle','End']
    images = result.builder_workflow['artifacts']['images']
    assert images['status'] == 'draft'
    assert [i['caption'] for i in images['value']['images']] == captions
    assert 'pending_generation' not in result.builder_workflow


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
