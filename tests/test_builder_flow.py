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
      'images':{'images':fixture()['contract']['cases'][0]['images']},
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
