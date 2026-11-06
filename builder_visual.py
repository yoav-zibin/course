"""Compare approved before/after views to browser renders of the generated client."""
import base64

from game_platform import builder_render

_REVIEW_PROMPT = (
    'Review each approved mockup and corresponding actual render. Check the move, state, privacy and UI rules. '
    'Return JSON {passed:boolean, issues:[{issue:string, severity:"blocking"|"cosmetic"}]} with at most 6 issues, blocking issues first. '
    'Severity "blocking": the render misstates the game — a piece, wall, score, turn indicator or difficulty that does not match the case\'s state or expected view; '
    'the effect of the move not shown; required content missing or cut off; or a control enabled or disabled in a way that misleads whose turn it is or what is legal. '
    'Severity "cosmetic": only fidelity to the UI artwork or wording, misstating nothing — icon style, ornament details, exact indicator artwork, phrasing polish. '
    'Rules: ')


def _split_issues(verdict):
    """Split one verdict's issues into (blocking texts, cosmetic texts).

    A reply in the old shape — issues as bare strings — and any issue
    whose severity is missing or unknown count as blocking: a severity
    the review never stated can never silently downgrade a finding.
    Each list is capped at 6, the most the review is asked to return,
    so an unbounded reply cannot bloat the repair feedback."""
    blocking, cosmetic = [], []
    for item in verdict.get('issues') or []:
        if isinstance(item, dict):
            text = item.get('issue')
            severity = item.get('severity')
        else:
            text, severity = item, None
        if not isinstance(text, str) or not text:
            continue
        (cosmetic if severity == 'cosmetic' else blocking).append(text)
    return blocking[:6], cosmetic[:6]


# The (width, height, direction) combinations the AI review sees, per
# view: the portrait phone and the desktop at the direction each was
# already reviewed in, plus the landscape phone — the tightest fit —
# in both text directions. The renderer's deterministic analysis
# (overflow, clipped text, tiny targets, blank views) and the browser
# move verification still run on the full matrix render_game returns;
# only the model's payload is sampled, so a review call stays small
# enough to answer within its budget. The tutorial is not reviewed.
_REVIEW_SHOTS = ((390, 844, 'ltr'), (844, 390, 'ltr'), (844, 390, 'rtl'), (1366, 768, 'rtl'))


def review_views(ask, job_id, cases, screenshots, rules):
    """Visual-review every case; return (failures, notes).

    failures keeps the established shape — {'visual_review': case name,
    'issues': [blocking issue texts]} — and drives client repairs
    exactly as before. notes are the cosmetic findings as
    {'case': name, 'issue': text} dicts: they never fail anything and
    ride along to the human's final review of the finished game."""
    failures, notes = [], []
    views = ('view_of_mover','view_of_other','expected_view_of_mover','expected_view_of_other')
    for case in cases:
        content = [{'type':'text', 'text':_REVIEW_PROMPT + rules}]
        for view in views:
            for width, height, direction in _REVIEW_SHOTS:
                shot = next((s for s in screenshots if s['test']==case['name'] and s['width']==width and s['height']==height and s['direction']==direction and s['view']==view), None)
                if shot is None: raise RuntimeError('Renderer returned incomplete evidence for ' + case['name'] + ': ' + view)
                content.append({'type':'text', 'text':f'{view}, {width}x{height}px {direction}. Approved then actual:'})
                for name in (shot['approvedFile'],shot['file']):
                    data = base64.b64encode((builder_render.ARTIFACT_ROOT/job_id/name).read_bytes()).decode()
                    content.append({'type':'image_url','image_url':{'url':'data:image/png;base64,'+data}})
        verdict = ask([{'role':'user','content':content}],2000)
        blocking, cosmetic = _split_issues(verdict)
        notes.extend({'case':case['name'],'issue':text} for text in cosmetic)
        if verdict.get('passed') is not True and (blocking or not cosmetic):
            failures.append({'visual_review':case['name'],'issues':blocking})
    return failures, notes
