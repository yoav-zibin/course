"""Saved approval workflow for the guided builder. All transitions are server enforced."""
import copy
import hashlib
import json
import time
import uuid
from dataclasses import replace
from typing import Any

from jsonschema import Draft202012Validator
from game_platform.models import GameRules
from game_platform.service import ConflictError, InvalidRequestError

STEPS = ('understanding', 'identity', 'logic', 'ui', 'images', 'tests')
LANGUAGES = ('en', 'es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar')
ACTIVE = ('queued', 'running')


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def initial(language='en'):
    if language not in LANGUAGES:
        raise InvalidRequestError('Unsupported language')
    return {'version': 1, 'language': language, 'artifacts': {}, 'history': [],
            'conversation': [], 'job': None, 'translations': {}, 'final_approval': None}


def assert_idle(flow):
    if (flow.get('job') or {}).get('status') in ACTIVE:
        raise ConflictError('A build is running. Cancel it before editing the specification.')


def prerequisites(flow, step):
    if step not in STEPS:
        raise InvalidRequestError('Unknown builder step')
    for earlier in STEPS[:STEPS.index(step)]:
        if flow['artifacts'].get(earlier, {}).get('status') != 'approved':
            raise ConflictError('Approve earlier steps before continuing')


def validate_schema(schema):
    # Never fetch external references supplied by a user/model.
    def visit(item):
        if isinstance(item, dict):
            for key, value in item.items():
                if key in ('$ref', '$dynamicRef') and (not isinstance(value, str) or not value.startswith('#')):
                    raise InvalidRequestError('Only local JSON Schema references are allowed')
                if key in ('$id', '$schema') and key == '$id':
                    raise InvalidRequestError('Schema $id is not supported')
                visit(value)
        elif isinstance(item, list):
            for child in item: visit(child)
    visit(schema)
    try: Draft202012Validator.check_schema(schema)
    except Exception as exc: raise InvalidRequestError(f'Invalid schema: {exc.message}') from exc


def text(value, name):
    if not isinstance(value, str) or not value.strip():
        raise InvalidRequestError(f'{name} must contain text')


def validate_artifact(step, value):
    if not isinstance(value, dict) or len(json.dumps(value)) > 2_000_000:
        raise InvalidRequestError('Artifact must be an object smaller than 2 MB')
    if step in ('understanding', 'logic', 'ui'): text(value.get('text'), 'Specification')
    if step == 'understanding' and value.get('questions'):
        raise InvalidRequestError('Answer the outstanding questions before approving')
    if step == 'identity':
        text(value.get('display_name'), 'Name'); text(value.get('short_description'), 'Description')
    if step == 'logic':
        counts = value.get('allowed_player_counts')
        if not isinstance(counts, list) or not counts or any(type(n) is not int or n < 1 or n > 10 for n in counts):
            raise InvalidRequestError('Player counts must be integers from 1 to 10')
        for key in ('allows_join_mid_match', 'allows_leave_mid_match'):
            if type(value.get(key)) is not bool: raise InvalidRequestError(f'Missing {key}')
    if step == 'images':
        images = value.get('images', [])
        if not 4 <= len(images) <= 6: raise InvalidRequestError('Approve one cover and 3–5 supporting images')
        for image in images: validate_image(image)
    if step == 'tests':
        for name in ('state_schema', 'view_schema', 'move_schema'):
            if name not in value: raise InvalidRequestError(f'Missing {name}')
            validate_schema(value[name])
        cases = value.get('cases', [])
        if not 3 <= len(cases) <= 10: raise InvalidRequestError('Provide 3–10 test cases')
        if len({case.get('name') for case in cases}) != len(cases): raise InvalidRequestError('Test names must be unique')
        kinds = [case.get('kind') for case in cases]
        for kind, low, high in [('initial',1,2), ('intermediate',1,4), ('terminal',1,4)]:
            if not low <= kinds.count(kind) <= high: raise InvalidRequestError(f'Provide {low}–{high} {kind} test cases')
        required = ('name','description','ctx','state','player_id','other_player_id','move','expected_state',
                    'expected_turn','view_of_mover','view_of_other','expected_view_of_mover','expected_view_of_other')
        for case in cases:
            for key in required:
                if key not in case: raise InvalidRequestError(f'Test is missing {key}')
            if type(case['ctx'].get('seed')) is not int: raise InvalidRequestError('Each test needs a fixed integer seed')
            if not isinstance(case['ctx'].get('players'), list): raise InvalidRequestError('Each test needs its roster')
            if len(case.get('images', [])) != 4: raise InvalidRequestError('Every test needs four view images')
            for image in case['images']: validate_image(image)
            for field, schema in [('state','state_schema'), ('expected_state','state_schema'), ('move','move_schema'),
                                  ('view_of_mover','view_schema'),('view_of_other','view_schema'),
                                  ('expected_view_of_mover','view_schema'),('expected_view_of_other','view_schema')]:
                error = next(Draft202012Validator(value[schema]).iter_errors(case[field]), None)
                if error: raise InvalidRequestError(f'{case["name"]}: {field}: {error.message}')


def validate_image(image):
    text(image.get('caption'), 'Image caption')
    svg = image.get('svg', '')
    if not isinstance(svg, str) or '<svg' not in svg or len(svg) > 120_000:
        raise InvalidRequestError('Image must contain an SVG preview under 120 KB')
    # Render only as an <img>, never inject model markup into the application DOM.
    import xml.etree.ElementTree as ET
    try: root = ET.fromstring(svg)
    except ET.ParseError as exc: raise InvalidRequestError('Malformed SVG') from exc
    allowed = {'svg','g','path','rect','circle','ellipse','line','polyline','polygon','text','tspan','defs','linearGradient','radialGradient','stop','clipPath','title','desc'}
    for element in root.iter():
        if element.tag.split('}')[-1] not in allowed: raise InvalidRequestError('Unsupported element in SVG')
        for key, value in element.attrib.items():
            if key.lower().startswith('on') or key.split('}')[-1] in ('href','style') or 'url(' in value and not value.startswith('url(#'):
                raise InvalidRequestError('SVG cannot load external resources or execute code')


def propose(draft, step, value, message, correction=''):
    flow = copy.deepcopy(draft.builder_workflow or initial())
    assert_idle(flow); prerequisites(flow, step)
    old = flow['artifacts'].get(step)
    # Keep unanswered clarification proposals visible, but unapprovable.
    if not (step == 'understanding' and value.get('questions')): validate_artifact(step, value)
    if old and old['value'] == value:
        if old['status'] == 'stale':
            old['status'] = 'draft'
            return replace(draft, builder_workflow=flow)
        return draft
    if old: flow['history'].append({'step':step, **old})
    flow['artifacts'][step] = {'value':value, 'status':'draft', 'revision':(old or {}).get('revision',0)+1}
    for later in STEPS[STEPS.index(step)+1:]:
        if later in flow['artifacts']: flow['artifacts'][later]['status'] = 'stale'
    flow['final_approval'] = None; flow['translations'] = {}; flow['job'] = None
    flow['conversation'].extend([{'role':'user','step':step,'text':correction}, {'role':'assistant','step':step,'text':message}])
    return replace(draft, builder_workflow=flow)


def approve(draft, step):
    flow = copy.deepcopy(draft.builder_workflow or initial())
    assert_idle(flow); prerequisites(flow, step)
    artifact = flow['artifacts'].get(step)
    if not artifact or artifact['status'] == 'stale': raise ConflictError('Revise this artifact before approving it')
    validate_artifact(step, artifact['value'])
    artifact['status'] = 'approved'
    flow['conversation'].append({'role':'user','step':step,'text':'Approved', 'artifact_revision':artifact['revision']})
    return replace(draft, builder_workflow=flow)


def spec_digest(flow):
    return digest({key:flow['artifacts'][key]['value'] for key in STEPS})


def begin_build(draft):
    flow = copy.deepcopy(draft.builder_workflow)
    assert_idle(flow)
    if any(flow['artifacts'].get(step,{}).get('status') != 'approved' for step in STEPS):
        raise ConflictError('Approve all six steps before building')
    flow['final_approval'] = None
    flow['job'] = {'id':str(uuid.uuid4()),'status':'queued','stage':'Queued','started_at':time.time(),
                   'deadline':time.time()+600, 'spec_digest':spec_digest(flow), 'log':[], 'error':None}
    return replace(draft, builder_workflow=flow)


def verify_approved_content(draft):
    flow = draft.builder_workflow
    if any(flow['artifacts'].get(step, {}).get('status') != 'approved' for step in STEPS):
        raise ConflictError('Approve all specifications before publishing')
    identity = flow['artifacts']['identity']['value']
    logic = flow['artifacts']['logic']['value']
    if (draft.name != identity['display_name'] or draft.description != identity['short_description']
        or tuple(draft.rules.allowed_player_counts) != tuple(logic['allowed_player_counts'])
        or draft.rules.allows_join_mid_match != logic['allows_join_mid_match']
        or draft.rules.allows_leave_mid_match != logic['allows_leave_mid_match']):
        raise ConflictError('Game metadata or rules changed after approval; rebuild it')


def require_publishable(draft):
    flow = draft.builder_workflow
    job = flow.get('job') or {}
    if job.get('status') != 'ready' or flow.get('final_approval') != job.get('id'):
        raise ConflictError('Finish verification and give final approval before publishing')
    if job.get('spec_digest') != spec_digest(flow) or job.get('code_digest') != digest([draft.code,draft.server_code]):
        raise ConflictError('The specification or code changed after verification; rebuild it')
    verify_approved_content(draft)
    if set(flow.get('translations',{})) != set(LANGUAGES): raise ConflictError('Translations are incomplete')
