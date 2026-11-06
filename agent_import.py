"""Bounded complete-game imports into the existing private Builder draft store."""
import asyncio
import json
import subprocess
import sys

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.concurrency import run_in_threadpool

from game_platform import builder_flow as flow
from game_platform.models import GameRules
from game_platform.schemas import GameDraftOut, Name, PlayerCounts
from game_platform.service import InvalidRequestError

MAX_BODY_BYTES = 900_000
MAX_CODE_BYTES = 200_000
MAX_IMAGE_BYTES = 120_000
MAX_WORKFLOW_BYTES = 400_000
UPLOAD_TIMEOUT_SECONDS = 15


class GameImport(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    name: Name
    description: str = Field(min_length=1, max_length=2000)
    allowed_player_counts: PlayerCounts
    allows_leave_mid_match: bool = False
    allows_join_mid_match: bool = False
    client_code: str = Field(min_length=1, max_length=MAX_CODE_BYTES)
    server_code: str = Field(min_length=1, max_length=MAX_CODE_BYTES)
    language: str = Field(default='en', min_length=2, max_length=16)
    rules: str = Field(min_length=1, max_length=20000)
    ui_instructions: str = Field(min_length=1, max_length=20000)
    tutorial: dict
    images: list[dict] = Field(min_length=4, max_length=6)
    unit_tests: dict

    def game_schemas(self):
        return {key: self.unit_tests[key + "_schema"] for key in ("state", "move", "view")}

    def game_rules(self):
        return GameRules(allowed_player_counts=tuple(self.allowed_player_counts),
                         allows_leave_mid_match=self.allows_leave_mid_match,
                         allows_join_mid_match=self.allows_join_mid_match)


def prepare(body):
    """Validate without writes. Run in a killable process, including user schemas."""
    for code in (body.client_code, body.server_code):
        if len(code.encode('utf-8')) > MAX_CODE_BYTES:
            raise InvalidRequestError('Each code field must be at most 200000 UTF-8 bytes')
    workflow = flow.initial(body.language)
    values = {
        'understanding': {'text': body.rules, 'questions': []},
        'identity': {'display_name': body.name, 'short_description': body.description},
        'logic': {'text': body.rules, 'allowed_player_counts': body.allowed_player_counts,
                  'allows_leave_mid_match': body.allows_leave_mid_match,
                  'allows_join_mid_match': body.allows_join_mid_match},
        'ui': {'text': body.ui_instructions}, 'tutorial': body.tutorial,
        'images': {'images': body.images}, 'tests': body.unit_tests,
    }
    for step, value in values.items():
        try:
            flow.validate_artifact(step, value)
        except Exception as exc:
            # The shared validator can embed user schema values in its message.
            # Identify the failing artifact without reflecting that content.
            raise InvalidRequestError(f'Invalid {step} artifact; see the Builder artifact contract') from exc
        workflow['artifacts'][step] = {'value': value, 'status': 'draft', 'revision': 1}
    for image in [*body.images, *(i for case in body.unit_tests['cases'] for i in case['images'])]:
        if len(image['svg'].encode('utf-8')) > MAX_IMAGE_BYTES:
            raise InvalidRequestError('Each SVG must be at most 120000 UTF-8 bytes')
    if len(json.dumps(workflow).encode()) > MAX_WORKFLOW_BYTES:
        raise InvalidRequestError('Combined metadata and images exceed 400000 bytes')
    stored_content = {'builder_workflow': workflow, 'game_schemas': body.game_schemas(),
                      'code': body.client_code, 'server_code': body.server_code,
                      'name': body.name, 'description': body.description}
    if len(json.dumps(stored_content).encode()) > MAX_BODY_BYTES:
        raise InvalidRequestError('Stored game package exceeds 900000 bytes; reduce code or schemas')
    from game_platform.builder_checks import run_checks
    checks = run_checks(body.client_code, body.server_code, values, body.game_rules())
    failed = [name for name, result in checks.items() if not result['passed']]
    if failed:
        raise InvalidRequestError('Game verification failed: ' + ', '.join(failed))
    # No approval digests, build status, translations or publication claims are trusted.
    return workflow


def verify_submission(body):
    try:
        result = subprocess.run([sys.executable, '-m', 'game_platform.agent_import'],
                                input=body.model_dump_json(), text=True,
                                capture_output=True, timeout=20, check=False)
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(422, 'Game validation exceeded the 20 second limit') from exc
    if result.returncode:
        raise HTTPException(422, 'Game validation failed; check schemas, images and code')
    response = json.loads(result.stdout)
    if 'error' in response:
        raise HTTPException(422, response['error'])
    return response['workflow']


def make_router(platform_dependency, caller_dependency):
    router = APIRouter()

    @router.post('/agent/games', status_code=201, response_model=GameDraftOut,
                 summary='Import a complete game as a private draft',
                 openapi_extra={'requestBody': {'required': True, 'content': {
                     'application/json': {'schema': GameImport.model_json_schema()}}}})
    async def import_game(request: Request, platform=Depends(platform_dependency),
                          caller=Depends(caller_dependency)):
        # Authentication runs before reading or parsing the upload (including chunked bodies).
        if request.headers.get('content-type', '').split(';')[0].lower() != 'application/json':
            raise HTTPException(415, 'Use application/json')
        if request.headers.get('content-encoding', 'identity').lower() != 'identity':
            raise HTTPException(415, 'Compressed request bodies are not supported')
        length = request.headers.get('content-length')
        if length is not None:
            try:
                declared_length = int(length)
            except ValueError as exc:
                raise HTTPException(400, 'Invalid Content-Length') from exc
            if declared_length < 0:
                raise HTTPException(400, 'Invalid Content-Length')
            if declared_length > MAX_BODY_BYTES:
                raise HTTPException(413, 'Request exceeds 900000 bytes')
        slots = request.app.state.builder_slots
        if not slots.acquire(blocking=False):
            raise HTTPException(429, 'Validation capacity is busy', headers={'Retry-After': '15'})
        try:
            data = bytearray()
            try:
                async with asyncio.timeout(UPLOAD_TIMEOUT_SECONDS):
                    async for chunk in request.stream():
                        if len(data) + len(chunk) > MAX_BODY_BYTES:
                            raise HTTPException(413, 'Request exceeds 900000 bytes')
                        data.extend(chunk)
            except TimeoutError as exc:
                raise HTTPException(408, 'Upload exceeded the 15 second limit') from exc
            try:
                body = GameImport.model_validate_json(data)
            except ValidationError as exc:
                raise HTTPException(422, [{'loc': list(e['loc']), 'msg': e['msg'], 'type': e['type']}
                                          for e in exc.errors(include_input=False, include_context=False)]) from exc
            workflow = await run_in_threadpool(verify_submission, body)
            draft = await run_in_threadpool(platform.save_game_draft,
                caller_id=caller, draft_id=None, expected_revision=None,
                name=body.name, description=body.description, rules=body.game_rules(),
                code=body.client_code, server_code=body.server_code,
                game_schemas=body.game_schemas(), _initial_workflow=workflow)
            return GameDraftOut.of(draft)
        finally:
            slots.release()

    @router.get('/agent/games/schema')
    def schema(caller=Depends(caller_dependency)):
        return GameImport.model_json_schema()

    return router


if __name__ == '__main__':
    try:
        prepared = prepare(GameImport.model_validate_json(sys.stdin.buffer.read(MAX_BODY_BYTES + 1)))
        print(json.dumps({'workflow': prepared}))
    except InvalidRequestError as exc:
        print(json.dumps({'error': str(exc)}))
    except Exception:
        # Never echo submitted code, paths, credentials or internal exception details.
        print(json.dumps({'error': 'Invalid game artifacts or failed verification; check Builder contract and tests'}))
