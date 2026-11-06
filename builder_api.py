"""Authenticated guided-builder endpoints, isolated from the legacy editor."""
import copy
import json
import threading
import time
from dataclasses import replace
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from game_platform import builder_flow as flow
from game_platform.builder_jobs import propose_step, run_build, parse_json
from game_platform.model_api import ModelApiClient
from game_platform.schemas import GameDraftOut
from game_platform.service import InvalidRequestError, ConflictError


class Action(BaseModel):
    channels: list[Literal['email','sms']] = Field(default_factory=list, max_length=2)
    expected_revision: int = Field(ge=1)
    step: Literal['understanding','identity','logic','ui','tutorial','images','tests'] = 'understanding'
    text: str = Field(default='',max_length=20000)
    display_name: str = Field(default='', max_length=200)
    short_description: str = Field(default='', max_length=2000)
    language: str = Field(default='en', max_length=16)


def configured_client(config, platform, caller, draft):
    client=ModelApiClient(api_key=config.api_key,model=config.model,base_url=config.base_url)
    if not client.enabled: raise HTTPException(503,'Configure the server Model API key to generate proposals. Saved drafts and manual review still work.')
    from game_platform.builder_budget import BudgetedModel
    return BudgetedModel(client, config, platform, caller, draft)


def make_router(platform_dependency, caller_dependency):
    router=APIRouter()
    def client_for(request, platform, caller, draft):
        return configured_client(request.app.state.model_api_config,platform,caller,draft)

    @router.post('/builder/games/{game_id}/open')
    def open_game(game_id: str, platform=Depends(platform_dependency), caller=Depends(caller_dependency)):
        return GameDraftOut.of(platform.open_builder_game(caller_id=caller, game_id=game_id))

    @router.get('/games/{game_id}/versions/{version}/cover')
    def cover(game_id: str, version: int, platform=Depends(platform_dependency)):
        game = platform.get_game_version(game_id, version)
        artifact = (game.builder_workflow or {}).get('artifacts', {}).get('images', {})
        if artifact.get('status') != 'approved': raise HTTPException(404, 'No approved cover')
        images = artifact.get('value', {}).get('images', [])
        if not images: raise HTTPException(404, 'No approved cover')
        flow.validate_cover(images[0])
        return Response(images[0]['svg'], media_type='image/svg+xml', headers={
            'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options':'nosniff',
            'Cache-Control':'public, max-age=3600'})

    @router.post('/game-drafts/{draft_id}/workflow/{action}')
    async def action(request:Request, draft_id:str, action:str, body:Action,
                     platform=Depends(platform_dependency), caller=Depends(caller_dependency)):
        draft=platform.get_game_draft(caller_id=caller,draft_id=draft_id)
        if draft.revision != body.expected_revision: raise ConflictError('Draft changed; reload before continuing')
        def save(change):
            return platform.change_builder_workflow(caller_id=caller,draft_id=draft_id,expected_revision=body.expected_revision,change=change)
        if action=='initialize':
            if draft.builder_workflow: return GameDraftOut.of(draft)
            result=save(lambda d:replace(d,builder_workflow=flow.initial(body.language)))
        elif action in ('propose', 'feedback'):
            client=client_for(request, platform, caller, draft)
            try: proposed=await run_in_threadpool(propose_step,client,draft,body.step,body.text, feedback=action=='feedback')
            except (InvalidRequestError,ConflictError): raise
            except Exception as exc: raise HTTPException(502,'Proposal could not be generated: '+str(exc)[:1000]) from exc
            body.expected_revision = client.revision
            proposed.builder_workflow['charged_microdollars'] = client.charged
            result=save(lambda d:replace(d,builder_workflow=proposed.builder_workflow))
        elif action=='refresh':
            result = draft
            for step in flow.STEPS:
                artifact = result.builder_workflow['artifacts'].get(step)
                if not artifact or artifact['status']=='draft': break
                if artifact['status']!='stale': continue
                model = client_for(request,platform,caller,result)
                proposal = await run_in_threadpool(propose_step,model,result,step,
                    'Recheck this artifact against the updated approved requirements. Return it exactly unchanged when it still fits. Otherwise propose the smallest required correction.')
                proposal.builder_workflow['charged_microdollars'] = model.charged
                body.expected_revision = model.revision
                result = save(lambda d: replace(d,builder_workflow=proposal.builder_workflow))
                if result.builder_workflow['artifacts'][step]['status']!='approved': break
        elif action=='edit-identity':
            value = {'display_name':body.display_name.strip(), 'short_description':body.short_description.strip()}
            result=save(lambda d:flow.propose(d,'identity',value,'Review the edited name and description.','Edit name and description'))
        elif action=='approve': result=save(lambda d:flow.approve(d,body.step))
        elif action=='reopen':
            def reopen(d):
                f=copy.deepcopy(d.builder_workflow); flow.assert_idle(f)
                if body.step not in f['artifacts']: raise InvalidRequestError('Step has no artifact')
                f['history'].append({'step':body.step,**copy.deepcopy(f['artifacts'][body.step])})
                f['artifacts'][body.step]['status']='draft'
                f['job']=None;f['final_approval']=None;f['translations']={}
                return replace(d,builder_workflow=f)
            result=save(reopen)
        elif action=='recover':
            result=save(flow.recover_expired)
        elif action=='build':
            client=client_for(request, platform, caller, draft)
            from game_platform.builder_jobs import notification_callback
            deliver = notification_callback(platform.get_user(caller), body.channels,
                request.app.state.email_sender,request.app.state.sms_sender)
            slots = request.app.state.builder_slots
            if not slots.acquire(blocking=False):
                raise HTTPException(429,'Two builds are running. Try again shortly.',headers={'Retry-After':'15'})
            try:
                result = save(flow.begin_build)
                client.job_id = result.builder_workflow['job']['id']
                def worker():
                    try: run_build(platform,client,caller,draft_id,client.job_id,deliver)
                    finally: slots.release()
                threading.Thread(target=worker,daemon=True).start()
            except Exception:
                slots.release()
                raise
        elif action=='cancel':
            def cancel(d):
                f=copy.deepcopy(d.builder_workflow)
                if f and f.get('job'): f['job'].update(status='cancelled',stage='Cancelled')
                return replace(d,builder_workflow=f)
            result=save(cancel)
        elif action=='final-approve':
            f=copy.deepcopy(draft.builder_workflow or {})
            job=f.get('job') or {}
            if job.get('status')!='ready_for_review': raise ConflictError('Build and verify this game before final approval')
            if job.get('code_digest')!=flow.digest([draft.code,draft.server_code]) or job.get('spec_digest')!=flow.spec_digest(f):
                raise ConflictError('Code or specifications changed; rebuild before approval')
            flow.verify_approved_content(draft)
            client=client_for(request, platform, caller, draft)
            specs={key:f['artifacts'][key]['value'] for key in ('identity','logic','ui')}
            from game_platform.builder_tutorial import vocabulary
            flow.validate_artifact('tutorial', f['artifacts']['tutorial']['value'])
            specs['tutorial_strings'] = vocabulary(f['artifacts']['tutorial']['value']['html'])
            from game_platform.game_text import extract_strings
            specs['client_strings'] = extract_strings(draft.code)
            if specs['client_strings'] is None:
                raise InvalidRequestError('Rebuild the game with its required translation string table')
            from game_platform.game_text import lint
            text_problems = lint(draft.code)
            if text_problems:
                raise InvalidRequestError("The game's texts cannot be translated: " + '; '.join(text_problems[:5]) + '. Rebuild the game.')
            key = flow.digest(['translate', job['id'], specs, flow.LANGUAGES])
            pending = f.get('pending_generation') or {}
            translations = pending['progress'] if pending.get('key') == key else {}
            for locale in flow.LANGUAGES:
                if locale in translations:
                    from game_platform.builder_tutorial import validate_translations
                    try:
                        validate_translations(specs['client_strings'], translations[locale].get('client_strings'))
                        validate_translations({s:s for s in specs['tutorial_strings']}, translations[locale].get('tutorial_strings'))
                    except ValueError:
                        del translations[locale]
                    else:
                        continue
                try:
                    reply = parse_json(await run_in_threadpool(client.chat,[
                        {'role':'system','content':f'Translate the approved specifications into {locale}. Return JSON keyed by "{locale}" with display_name, short_description, game_logic_rules, game_ui_rules, tutorial_strings (mapping every original tutorial string to its translation), client_strings (preserve every supplied key). Preserve all {{placeholders}}, rules and meaning.'},
                        {'role':'user','content':json.dumps(specs,ensure_ascii=False)}],max_tokens=12000,temperature=1.0,reasoning_effort='low'))
                    translation = reply[locale]
                    strings = translation.get('tutorial_strings', {})
                    from game_platform.builder_tutorial import validate_translations
                    validate_translations({s:s for s in specs['tutorial_strings']}, strings)
                    validate_translations(specs['client_strings'], translation.get('client_strings'))
                    for field in ('display_name','short_description','game_logic_rules','game_ui_rules'):
                        flow.text(translation.get(field),field)
                    translations[locale] = translation
                    client.checkpoint(key,translations)
                except (InvalidRequestError, ConflictError):
                    raise
                except Exception as exc:
                    raise HTTPException(502,f'Translation for {locale} failed. Retry final approval to resume: {str(exc)[:500]}') from exc
            f.pop('pending_generation', None)
            body.expected_revision = client.revision
            f['charged_microdollars'] = client.charged
            f['translations']=translations;f['final_approval']=job['id'];f['job']['status']='ready';f['job']['stage']='Approved and translated; ready to publish'
            result=save(lambda d:replace(d,builder_workflow=f))
        else: raise HTTPException(404,'Unknown workflow action')
        return GameDraftOut.of(result)

    @router.get('/game-drafts/{draft_id}/workflow/images/{filename}')
    def image(draft_id:str, filename:str, platform=Depends(platform_dependency),caller=Depends(caller_dependency)):
        from game_platform.builder_render import ARTIFACT_ROOT
        draft=platform.get_game_draft(caller_id=caller,draft_id=draft_id)
        job=(draft.builder_workflow or {}).get('job') or {}
        if not any(item['file']==filename for item in job.get('screenshots',[])): raise HTTPException(404,'Image not found')
        path=ARTIFACT_ROOT/job['id']/filename
        if not path.is_file(): raise HTTPException(404,'Review image is no longer available; rebuild to regenerate')
        return FileResponse(path,media_type='image/png',headers={'Cache-Control':'private, no-store'})
    return router
