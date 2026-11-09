"""Bounded complete-game imports: one POST publishes a fully translated game."""
import asyncio
import json
import subprocess
import sys

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from starlette.concurrency import run_in_threadpool

from game_platform.game_artifacts import validate_artifact, validate_test_rosters
from game_platform.i18n import LOCALE_CODES as LANGUAGES
from game_platform.models import GameRules
from game_platform.schemas import GameOut, Name, PlayerCounts
from game_platform.service import InvalidRequestError

MAX_BODY_BYTES = 900_000
MAX_CODE_BYTES = 200_000
MAX_IMAGE_BYTES = 120_000
MAX_PACKAGE_BYTES = 400_000
UPLOAD_TIMEOUT_SECONDS = 15

# The owner recorded for a game imported without an account: no user can
# authenticate as it (user ids are UUIDs), so no one can edit or unpublish it.
AGENT_IMPORT_OWNER_ID = "agent-import"


class GameTranslation(BaseModel):
    """One language's translation of a game's player-facing texts, in the shape the
    Builder's final approval produces, so the published game serves them directly."""
    model_config = ConfigDict(extra='forbid', strict=True)
    display_name: Name
    short_description: str = Field(min_length=1, max_length=2000)
    game_logic_rules: str = Field(min_length=1, max_length=20000)
    game_ui_rules: str = Field(min_length=1, max_length=20000)
    tutorial_strings: dict[str, str]
    client_strings: dict[str, str]


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
    # The game's texts translated into every language but the one it is written in:
    # name, description, rules, UI instructions, tutorial strings and the client
    # string table. The source language's entry is synthesized server-side, so the
    # published game is translated in all 8 languages from this one POST.
    translations: dict[str, GameTranslation]
    # A string the agent picks when creating the game (a long random secret).
    # Required: every import carries one, so every game can be updated by
    # resubmitting with the same string. Sending the same string again updates
    # the game created with it instead of creating a duplicate: the request is
    # an update, not a new addition. Anyone holding the string can update the
    # game, so keep it secret.
    game_addition_request_id_and_secret: str = Field(min_length=16, max_length=200)

    @model_validator(mode='after')
    def _translations_cover_every_other_language(self):
        if self.language not in LANGUAGES:
            raise ValueError(f'Unsupported language: {self.language!r}')
        required = set(LANGUAGES) - {self.language}
        provided = set(self.translations)
        if provided != required:
            missing = sorted(required - provided)
            extra = sorted(provided - required)
            detail = []
            if missing:
                detail.append('missing translations for ' + ', '.join(missing))
            if extra:
                detail.append('unexpected translations for ' + ', '.join(extra))
            raise ValueError('translations must cover every language but the source language: ' + '; '.join(detail))
        return self

    def game_schemas(self):
        return {key: self.unit_tests[key + "_schema"] for key in ("state", "move", "view")}

    def game_rules(self):
        return GameRules(allowed_player_counts=tuple(self.allowed_player_counts),
                         allows_leave_mid_match=self.allows_leave_mid_match,
                         allows_join_mid_match=self.allows_join_mid_match)


def _validate_translations(body, table, tutorial_vocab):
    """The caller-supplied translations must cover the game's own strings exactly and
    keep every placeholder, so the published game is translated in every language
    from the first request. Returns the package's translations dict, including the
    source language synthesized from the game's own texts."""
    from game_platform import translation as translation_module
    from game_platform.game_tutorial import validate_translations
    translations = {}
    for locale, translation in body.translations.items():
        try:
            validate_translations(table, translation.client_strings)
            validate_translations({s: s for s in tutorial_vocab}, translation.tutorial_strings)
        except ValueError as exc:
            raise InvalidRequestError(f'Translation for {locale} is incomplete: {exc}') from exc
        for field, source in (('display_name', body.name), ('short_description', body.description),
                              ('game_logic_rules', body.rules), ('game_ui_rules', body.ui_instructions)):
            value = getattr(translation, field)
            if translation_module.placeholders_of(value) != translation_module.placeholders_of(source):
                raise InvalidRequestError(f'Translation for {locale} changed placeholders in {field}')
        translations[locale] = translation.model_dump()
    translations[body.language] = {
        'display_name': body.name,
        'short_description': body.description,
        'game_logic_rules': body.rules,
        'game_ui_rules': body.ui_instructions,
        'tutorial_strings': {s: s for s in tutorial_vocab},
        'client_strings': dict(table),
    }
    return translations


def prepare(body):
    """Validate without writes. Run in a killable process, including user schemas."""
    for code in (body.client_code, body.server_code):
        if len(code.encode('utf-8')) > MAX_CODE_BYTES:
            raise InvalidRequestError('Each code field must be at most 200000 UTF-8 bytes')
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
            validate_artifact(step, value)
        except Exception as exc:
            # The shared validator can embed user schema values in its message.
            # Identify the failing artifact without reflecting that content.
            raise InvalidRequestError(f'Invalid {step} artifact; see the game artifact contract') from exc
    # The translations are trusted as supplied (they are checked structurally here,
    # not machine-translated), and they count toward the package size limit below.
    from game_platform.game_tutorial import vocabulary
    from game_platform.game_text import StringsError, extract_strings
    try:
        table = extract_strings(body.client_code)
    except StringsError as exc:
        raise InvalidRequestError(str(exc)) from exc
    if table is None:
        raise InvalidRequestError('Game is missing its translation string table')
    translations = _validate_translations(body, table, vocabulary(body.tutorial['html']))
    # The import package is the game's durable metadata: translations, the
    # resubmission secret, rules/UI text, tutorial, images and unit tests.
    # There is no workflow around it anymore (no job, approvals or history).
    package = {
        'translations': translations,
        'game_addition_request_id_and_secret': body.game_addition_request_id_and_secret,
        'rules_text': body.rules,
        'ui_text': body.ui_instructions,
        'tutorial': body.tutorial,
        'images': body.images,
        'unit_tests': body.unit_tests,
    }
    for image in [*body.images, *(i for case in body.unit_tests['cases'] for i in case['images'])]:
        if len(image['svg'].encode('utf-8')) > MAX_IMAGE_BYTES:
            raise InvalidRequestError('Each SVG must be at most 120000 UTF-8 bytes')
    if len(json.dumps(package).encode()) > MAX_PACKAGE_BYTES:
        raise InvalidRequestError('Combined metadata and images exceed 400000 bytes')
    stored_content = {'import_package': package, 'game_schemas': body.game_schemas(),
                      'code': body.client_code, 'server_code': body.server_code,
                      'name': body.name, 'description': body.description}
    if len(json.dumps(stored_content).encode()) > MAX_BODY_BYTES:
        raise InvalidRequestError('Stored game package exceeds 900000 bytes; reduce code or schemas')
    from game_platform.game_checks import run_checks
    # Every test case's roster must be a seat count the rules allow; a
    # human plus a computer is two seats, so a one-seat roster can never
    # take turns correctly.
    validate_test_rosters(body.allowed_player_counts, body.unit_tests)
    checks = run_checks(body.client_code, body.server_code, values, body.game_rules())
    failed = [name for name, result in checks.items() if not result['passed']]
    if failed:
        # Say exactly what failed and how to reproduce it, not just which
        # check: the game is not inserted, and the author needs the seed,
        # the ctx, the arguments, the result and the cost to fix it.
        detail_lines = []
        for name in failed:
            detail_lines.append(f"[{name}]")
            detail_lines.append(str(checks[name]['details']))
        raise InvalidRequestError(
            'Game verification failed:\n' + '\n'.join(detail_lines)
        )
    # No approval digests, build status or publication claims are trusted.
    return package


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
    return response['package']


def make_router(platform_dependency, caller_dependency):
    router = APIRouter()

    @router.post('/games', status_code=201, response_model=GameOut,
                 summary='Import a complete game as a published game',
                 openapi_extra={'requestBody': {'required': True, 'content': {
                     'application/json': {'schema': GameImport.model_json_schema()}}}})
    async def import_game(request: Request, platform=Depends(platform_dependency),
                          caller=Depends(caller_dependency)):
        # Authentication runs before reading or parsing the upload (including chunked bodies).
        # Credentials are optional: a request without them publishes an ownerless game.
        # Credentials that are sent but invalid are rejected by the dependency.
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
        slots = request.app.state.import_slots
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
            # The game must have passed the full /game-test flow with this
            # secret, for exactly this payload, before it can be submitted.
            from game_platform import game_traces
            from game_platform.service import InvalidRequestError
            try:
                await run_in_threadpool(game_traces.assert_complete, platform, body)
            except InvalidRequestError as exc:
                raise HTTPException(422, str(exc)) from exc
            package = await run_in_threadpool(verify_submission, body)
            # Seed the portal bundle with the supplied translations first, so a failure
            # here leaves nothing behind; the game itself is created right after.
            await run_in_threadpool(platform.set_translations, translations=_bundle_translations(body))
            # A resubmission with the same request id updates the game created with it
            # instead of creating a duplicate; without one, every POST creates a game.
            game = await run_in_threadpool(platform.import_agent_game,
                caller_id=caller if caller is not None else AGENT_IMPORT_OWNER_ID,
                name=body.name, description=body.description, rules=body.game_rules(),
                code=body.client_code, server_code=body.server_code,
                game_schemas=body.game_schemas(), import_package=package,
                request_id=body.game_addition_request_id_and_secret)
            return GameOut.of(game)
        finally:
            slots.release()

    @router.get('/games/schema')
    def schema(caller=Depends(caller_dependency)):
        return GameImport.model_json_schema()

    return router


def _bundle_translations(body):
    """(locale, source, text) triples for the portal bundle: the game's name,
    description and in-game strings, in every supplied language but English
    (English is the source language, so the bundle never translates into it)."""
    from game_platform.game_text import extract_strings
    table = extract_strings(body.client_code) or {}
    triples = []
    for locale, translation in body.translations.items():
        if locale == 'en':
            continue
        triples.append((locale, body.name, translation.display_name))
        triples.append((locale, body.description, translation.short_description))
        for key, text in translation.client_strings.items():
            source = table.get(key)
            if source is not None:
                triples.append((locale, source, text))
    return triples


if __name__ == '__main__':
    try:
        prepared = prepare(GameImport.model_validate_json(sys.stdin.buffer.read(MAX_BODY_BYTES + 1)))
        print(json.dumps({'package': prepared}))
    except InvalidRequestError as exc:
        print(json.dumps({'error': str(exc)}))
    except Exception:
        # Never echo submitted code, paths, credentials or internal exception details.
        print(json.dumps({'error': 'Invalid game artifacts or failed verification; check the game schemas, images and code against the game development guide'}))
