"""Authenticated guided-builder endpoints, isolated from the legacy editor."""
import copy
import json
import threading
import time
from dataclasses import replace
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from game_platform import builder_flow as flow
from game_platform.builder_jobs import propose_step, run_build, parse_json
from game_platform.model_api import ModelApiClient
from game_platform.schemas import GameDraftOut
from game_platform.service import InvalidRequestError, ConflictError


class Action(BaseModel):
    expected_revision: int = Field(ge=1)
    step: Literal['understanding','identity','logic','ui','images','tests'] = 'understanding'
    text: str = Field(default='',max_length=20000)
    language: Literal['en','es','fr','de','pt','zh','hi','ar'] = 'en'


def make_router(platform_dependency, caller_dependency):
    router=APIRouter()
    def client_for(request):
        config=request.app.state.model_api_config
        client=ModelApiClient(api_key=config.api_key,model=config.model,base_url=config.base_url)
        if not client.enabled: raise HTTPException(503,'Configure the server Model API key to generate proposals. Saved drafts and manual review still work.')
        return client

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
        elif action=='propose':
            client=client_for(request)
            try: proposed=await run_in_threadpool(propose_step,client,draft,body.step,body.text)
            except (InvalidRequestError,ConflictError): raise
            except Exception as exc: raise HTTPException(502,'Proposal could not be generated: '+str(exc)[:1000]) from exc
            result=save(lambda d:replace(d,builder_workflow=proposed.builder_workflow))
        elif action=='approve': result=save(lambda d:flow.approve(d,body.step))
        elif action=='reopen':
            def reopen(d):
                f=copy.deepcopy(d.builder_workflow); flow.assert_idle(f)
                if body.step not in f['artifacts']: raise InvalidRequestError('Step has no artifact')
                f['history'].append({'step':body.step,**copy.deepcopy(f['artifacts'][body.step])})
                f['artifacts'][body.step]['status']='draft'
                for step in flow.STEPS[flow.STEPS.index(body.step)+1:]:
                    if step in f['artifacts']: f['artifacts'][step]['status']='stale'
                f['job']=None;f['final_approval']=None;f['translations']={}
                return replace(d,builder_workflow=f)
            result=save(reopen)
        elif action=='build':
            client=client_for(request)
            result=save(flow.begin_build)
            threading.Thread(target=run_build,args=(platform,client,caller,draft_id,result.builder_workflow['job']['id']),daemon=True).start()
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
            client=client_for(request)
            specs={key:f['artifacts'][key]['value'] for key in ('identity','logic','ui')}
            try:
                translations=parse_json(await run_in_threadpool(client.chat,[
                    {'role':'system','content':'Translate the provided approved game specifications into en,es,fr,de,pt,zh,hi,ar. Return JSON keyed by these exact locale codes; each value has display_name,short_description,game_logic_rules,game_ui_rules. Preserve all rules exactly.'},
                    {'role':'user','content':json.dumps(specs,ensure_ascii=False)}],max_tokens=16000,temperature=.1))
                if set(translations)!=set(flow.LANGUAGES): raise ValueError('Missing languages')
                for translation in translations.values():
                    for key in ('display_name','short_description','game_logic_rules','game_ui_rules'): flow.text(translation.get(key),key)
            except Exception as exc: raise HTTPException(502,'Translation failed; nothing was published: '+str(exc)[:500]) from exc
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
