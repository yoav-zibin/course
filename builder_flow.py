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
from game_platform.i18n import LOCALE_CODES
from game_platform.service import ConflictError, InvalidRequestError

STEPS = ('understanding', 'identity', 'logic', 'ui', 'tutorial', 'images', 'tests')
LANGUAGES = LOCALE_CODES
ACTIVE = ('queued', 'running')


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def initial(language='en'):
    if language not in LANGUAGES:
        raise InvalidRequestError('Unsupported language')
    return {'version': 2, 'language': language, 'artifacts': {}, 'history': [],
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


def validate_artifact(step, value, *, require_test_images=True):
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
    if step == 'tutorial':
        text(value.get('text'), 'Tutorial description')
        text(value.get('html'), 'Tutorial HTML')
        from game_platform.game_text import extract_strings
        import re
        scripts = re.findall(r'<script\b([^>]*)>(.*?)</script\s*>', value['html'], re.I | re.S)
        executable = any('application/json' not in attrs.lower() and body.strip() for attrs, body in scripts) or bool(re.search(r'\son\w+\s*=', value['html'], re.I))
        if executable and (not extract_strings(value['html']) or 'tutorial_locale' not in value['html']):
            raise InvalidRequestError('Regenerate the interactive tutorial with an i18n-strings table and tutorial_locale handler so its changing text can be translated')
        if executable:
            from game_platform.game_text import lint
            errors = lint(value['html'])
            if errors: raise InvalidRequestError('Tutorial translation: ' + '; '.join(errors))
        if len(value['html']) > 120_000: raise InvalidRequestError('Tutorial is too large')
        if 'viewport' not in value['html'].lower(): raise InvalidRequestError('Tutorial needs a responsive viewport meta tag')
    if step == 'images':
        images = value.get('images', [])
        if not 4 <= len(images) <= 6: raise InvalidRequestError('Approve one cover and 3–5 supporting images')
        for image in images: validate_image(image)
        validate_cover(images[0])
    if step == 'tests':
        for name in ('state_schema', 'view_schema', 'move_schema'):
            if name not in value: raise InvalidRequestError(f'Missing {name}')
            validate_schema(value[name])
        cases = value.get('cases', [])
        if not isinstance(cases,list) or not all(isinstance(case,dict) for case in cases): raise InvalidRequestError('Test cases must be a list of objects')
        for case in cases: text(case.get('name'), 'Test name')
        if not 3 <= len(cases) <= 10: raise InvalidRequestError('Provide 3–10 test cases')
        if len({case.get('name') for case in cases}) != len(cases): raise InvalidRequestError('Test names must be unique')
        kinds = [case.get('kind') for case in cases]
        for kind, low, high in [('initial',1,2), ('intermediate',1,4), ('terminal',1,4)]:
            if not low <= kinds.count(kind) <= high: raise InvalidRequestError(f'Provide {low}–{high} {kind} test cases')
        required = ('name','description','ctx','state','player_id','other_player_id','move','expected_state',
                    'expected_turn','view_of_mover','view_of_other','expected_view_of_mover','expected_view_of_other')
        for case in cases:
            for key in required:
                if key not in case: raise InvalidRequestError(f"{case.get('name')}: Test is missing {key}")
            if case.get('expected_turn') is None and not isinstance(case.get('expected_payouts'),dict):
                raise InvalidRequestError(f"{case.get('name')}: Terminal examples must include expected payouts")
            if not isinstance(case['ctx'],dict): raise InvalidRequestError(f"{case.get('name')}: Each test needs a context object")
            if type(case['ctx'].get('move_count')) is not int or case['ctx']['move_count'] < 0:
                raise InvalidRequestError(f"{case.get('name')}: Each test needs a nonnegative integer move_count")
            if type(case['ctx'].get('seed')) is not int: raise InvalidRequestError(f"{case.get('name')}: Each test needs a fixed integer seed")
            players = case['ctx'].get('players')
            if not isinstance(players, list) or not players or not all(isinstance(p,dict) and isinstance(p.get('id'),str) and p['id'] for p in players):
                raise InvalidRequestError(f"{case.get('name')}: Each test needs players with nonempty string IDs")
            ids = [p['id'] for p in players]
            if len(set(ids)) != len(ids) or case['player_id'] not in ids or (case['other_player_id'] is not None and case['other_player_id'] not in ids):
                raise InvalidRequestError(f"{case['name']}: player IDs must refer to unique seats in the roster")
            turn = case['expected_turn']
            if turn is not None and (not isinstance(turn,list) or not turn or any(pid not in ids for pid in turn)):
                raise InvalidRequestError(f"{case['name']}: expected_turn must contain roster IDs or be null")
            if case['kind']=='terminal' and turn is not None:
                raise InvalidRequestError(f"{case['name']}: a terminal example must end the match")
            if type(case['ctx'].get('pot')) is not int or case['ctx']['pot'] < 0:
                raise InvalidRequestError(f"{case['name']}: supply a nonnegative integer pot (0 for a free match)")
            if 'expected_error' in case:
                # A negative example: the move is legal in shape (it matches
                # move_schema below) but the game rules must reject it. The
                # match does not advance, so nothing about it may change.
                if case['expected_error'] != 'InvalidMove':
                    raise InvalidRequestError(f"{case['name']}: expected error must be InvalidMove")
                if not isinstance(case.get('turn'), list) or not case['turn'] or any(pid not in ids for pid in case['turn']) or case['turn'] != turn:
                    raise InvalidRequestError(f"{case['name']}: rejected moves must preserve an explicit nonempty turn")
                if case['expected_state'] != case['state'] or case['expected_view_of_mover'] != case['view_of_mover'] or case['expected_view_of_other'] != case['view_of_other']:
                    raise InvalidRequestError(f"{case['name']}: rejected moves must preserve state and views")
                if case.get('expected_payouts'):
                    raise InvalidRequestError(f"{case['name']}: rejected moves cannot pay tokens")
            if 'expected_payouts' in case:
                # Payouts are token settlement, not a win score: on a terminal
                # move they must distribute exactly the pot, on an ongoing
                # move at most the pot, and only to active humans.
                payouts = case['expected_payouts']
                humans = {p['id'] for p in players if p.get('kind') == 'human' and p.get('active', True)}
                if not isinstance(payouts, dict) or any(pid not in humans or type(amount) is not int or amount < 0 for pid, amount in payouts.items()):
                    raise InvalidRequestError(f"{case['name']}: payouts must be nonnegative integer tokens for active humans only")
                total = sum(payouts.values())
                if total > case['ctx']['pot'] or (turn is None and total != case['ctx']['pot']):
                    raise InvalidRequestError(f"{case['name']}: expected payouts must conserve the pot; payouts are tokens, not win scores")
            if require_test_images or case.get('images'):
                if len(case.get('images', [])) != 4: raise InvalidRequestError(f"{case.get('name')}: Every test needs four view images")
                for image in case['images']: validate_image(image)
            for field, schema in [('state','state_schema'), ('expected_state','state_schema'), ('move','move_schema'),
                                  ('view_of_mover','view_schema'),('view_of_other','view_schema'),
                                  ('expected_view_of_mover','view_schema'),('expected_view_of_other','view_schema')]:
                error = next(Draft202012Validator(value[schema]).iter_errors(case[field]), None)
                if error: raise InvalidRequestError(f'{case["name"]}: {field}: {error.message}')


def validate_test_rosters(allowed_player_counts, value):
    """Every example's roster must be a seat count the approved logic allows.

    allowed_player_counts counts total seats, not humans: one human versus
    one computer is two seats. A one-seat roster with two pawns can never
    take turns correctly, so it is rejected before approval, not repaired
    later by steering code generation with contradictory examples.
    """
    counts = allowed_player_counts
    if not counts:
        return
    for case in value.get('cases', []):
        players = (case.get('ctx') or {}).get('players') or []
        if len(players) not in counts:
            raise InvalidRequestError(f"{case.get('name')}: roster must match approved total seat counts; a human plus a computer uses two seats")


def validate_image(image):
    if not isinstance(image, dict): raise InvalidRequestError('Image must be an object')
    text(image.get('caption'), 'Image caption')
    svg = image.get('svg', '')
    if not isinstance(svg, str) or '<svg' not in svg or len(svg) > 120_000:
        raise InvalidRequestError('Image must contain an SVG preview under 120 KB')
    # Render only as an <img>, never inject model markup into the application DOM.
    import xml.etree.ElementTree as ET
    if '<!DOCTYPE' in svg or '<!ENTITY' in svg: raise InvalidRequestError('SVG declarations are not supported')
    try: root = ET.fromstring(svg)
    except ET.ParseError as exc: raise InvalidRequestError(f'Malformed SVG: {exc}') from exc
    if root.tag not in ('svg','{http://www.w3.org/2000/svg}svg'): raise InvalidRequestError('Expected SVG root')
    allowed = {'svg','g','path','rect','circle','ellipse','line','polyline','polygon','text','tspan','defs','linearGradient','radialGradient','stop','clipPath','title','desc'}
    for element in root.iter():
        if element.tag.split('}')[-1] not in allowed: raise InvalidRequestError('Unsupported element in SVG')
        for key, value in element.attrib.items():
            if key.lower().startswith('on') or key.split('}')[-1] in ('href','style') or 'url(' in value and not value.startswith('url(#'):
                raise InvalidRequestError('SVG cannot load external resources or execute code')


def validate_cover(image):
    """The first image is the catalog cover, never a screenshot with labels."""
    import math
    import xml.etree.ElementTree as ET
    validate_image(image)
    root = ET.fromstring(image['svg'])
    try:
        x, y, width, height = map(float, root.attrib.get('viewBox', '').replace(',', ' ').split())
        valid = all(math.isfinite(v) for v in (x, y, width, height)) and width > 0 and height > 0 and abs(width / height - 16 / 9) < .001
    except (ValueError, ZeroDivisionError):
        valid = False
    if not valid: raise InvalidRequestError('Cover must have a 16:9 viewBox')
    if any(e.tag.split('}')[-1] in ('text', 'tspan') for e in root.iter()):
        raise InvalidRequestError('Cover must not contain text')


def recover_expired(draft):
    state = copy.deepcopy(draft.builder_workflow)
    job = (state or {}).get('job') or {}
    if job.get('status') in ACTIVE and time.time() > job.get('deadline', 0):
        job.update(status='interrupted', stage='Build interrupted or timed out; retry when ready',
                   error='The build deadline expired. Saved approvals are intact. No automatic paid retry was made.')
        return replace(draft, builder_workflow=state)
    return draft


def propose(draft, step, value, message, correction=''):
    flow = copy.deepcopy(draft.builder_workflow or initial())
    assert_idle(flow); prerequisites(flow, step)
    old = flow['artifacts'].get(step)
    # Keep unanswered clarification proposals visible, but unapprovable.
    if not (step == 'understanding' and value.get('questions')): validate_artifact(step, value)
    if step == 'tests': validate_test_rosters(flow, value)
    if old and old['value'] == value:
        if old['status'] == 'stale':
            old['status'] = 'approved' if old.get('approved_digest') == digest(value) else 'draft'
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
    if step == 'tests': validate_test_rosters(flow, artifact['value'])
    artifact['status'] = 'approved'
    artifact['approved_digest'] = digest(artifact['value'])
    flow['conversation'].append({'role':'user','step':step,'text':'Approved', 'artifact_revision':artifact['revision']})
    if step == 'identity':
        return replace(draft, name=artifact['value']['display_name'], description=artifact['value']['short_description'], builder_workflow=flow)
    return replace(draft, builder_workflow=flow)


def spec_digest(flow):
    if any(key not in flow['artifacts'] for key in STEPS):
        raise ConflictError('This draft needs all current specification steps, including the tutorial')
    return digest({key:flow['artifacts'][key]['value'] for key in STEPS})


def begin_build(draft):
    flow = copy.deepcopy(draft.builder_workflow)
    assert_idle(flow)
    if any(flow['artifacts'].get(step,{}).get('status') != 'approved' for step in STEPS):
        raise ConflictError('Approve every step, including the tutorial, before building')
    validate_artifact('images', flow['artifacts']['images']['value'])
    validate_artifact('tutorial', flow['artifacts']['tutorial']['value'])
    validate_artifact('tests', flow['artifacts']['tests']['value'])
    validate_test_rosters(flow, flow['artifacts']['tests']['value'])
    previous = flow.get('job') or {}
    verified = previous.get('verified_code_digest')
    reusable = verified and verified == digest([draft.code,draft.server_code]) and previous.get('spec_digest') == spec_digest(flow)
    flow['final_approval'] = None
    flow['job'] = {'id':str(uuid.uuid4()),'status':'queued','stage':'Queued','started_at':time.time(),
                   'deadline':time.time()+600, 'spec_digest':spec_digest(flow), 'log':[], 'error':None}
    if reusable:
        for key in ('verified_code_digest','checks','server_reviews'):
            flow['job'][key] = previous[key]
    if previous.get('failure_summary') and previous.get('spec_digest') == spec_digest(flow):
        # The last build's findings warn the next build of the same spec
        # from its first generation (see _summarize_failures).
        flow['job']['failure_summary'] = previous['failure_summary']
    if previous.get('server_checkpoint') and previous.get('spec_digest') == spec_digest(flow):
        # A server that passed every check and review in an earlier build
        # stays verified for the same approved specification, even when
        # its client never verified: the new build restores the server
        # and writes a fresh client instead of starting from nothing.
        flow['job']['server_checkpoint'] = previous['server_checkpoint']
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
    from game_platform.game_text import extract_strings
    from game_platform.builder_tutorial import vocabulary, validate_translations
    source = extract_strings(draft.code)
    if source is None: raise ConflictError('Game is missing its translation string table')
    from game_platform.game_text import lint
    problems = lint(draft.code, draft.server_code)
    if problems: raise ConflictError("The game's texts cannot be translated: " + '; '.join(problems[:5]))
    tutorial = {s:s for s in vocabulary(flow['artifacts']['tutorial']['value']['html'])}
    for locale in LANGUAGES:
        try:
            validate_translations(source, flow['translations'][locale].get('client_strings'))
            validate_translations(tutorial, flow['translations'][locale].get('tutorial_strings'))
        except ValueError as exc:
            raise ConflictError('Translations are incomplete for ' + locale + ': ' + str(exc)) from exc
