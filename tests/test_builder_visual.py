import pytest
from game_platform import builder_render, builder_visual

VIEWS = ('view_of_mover', 'view_of_other', 'expected_view_of_mover', 'expected_view_of_other')
SIZES = [(360, 640), (390, 844), (844, 390), (820, 1180), (1366, 768), (1920, 1080)]


def matrix_screenshots(name):
    """One case's full render matrix, as builder-render.cjs reports it."""
    shots = []
    for width, height in SIZES:
        for direction in ('ltr', 'rtl'):
            for view in VIEWS:
                shots.append({'test': name, 'view': view, 'width': width, 'height': height,
                              'direction': direction,
                              'file': f'{view}-{width}-{height}-{direction}.png',
                              'approvedFile': f'approved-{view}.png'})
    return shots


def prepare(tmp_path, monkeypatch, names=('Case A',)):
    monkeypatch.setattr(builder_render, 'ARTIFACT_ROOT', tmp_path)
    shots = []
    for name in names:
        shots += matrix_screenshots(name)
    folder = tmp_path / 'job'
    folder.mkdir()
    for shot in shots:
        (folder / shot['file']).write_bytes(b'png')
        (folder / shot['approvedFile']).write_bytes(b'png')
    return shots


def ask_returning(verdicts, payloads=None):
    queue = list(verdicts)

    def ask(messages, tokens):
        if payloads is not None:
            payloads.append(messages[0]['content'])
        return queue.pop(0)

    return ask


def test_blocking_and_cosmetic_issues_are_split(tmp_path, monkeypatch):
    shots = prepare(tmp_path, monkeypatch)
    verdict = {'passed': False, 'issues': [
        {'issue': 'The placed wall is not rendered', 'severity': 'blocking'},
        {'issue': 'The counter icon is a square, not a fence', 'severity': 'cosmetic'}]}
    failures, notes = builder_visual.review_views(
        ask_returning([verdict]), 'job', [{'name': 'Case A'}], shots, 'rules')
    assert failures == [{'visual_review': 'Case A', 'issues': ['The placed wall is not rendered']}]
    assert notes == [{'case': 'Case A', 'issue': 'The counter icon is a square, not a fence'}]


def test_cosmetic_only_findings_do_not_fail(tmp_path, monkeypatch):
    shots = prepare(tmp_path, monkeypatch)
    verdict = {'passed': False, 'issues': [
        {'issue': 'Walls counter could use an icon', 'severity': 'cosmetic'}]}
    failures, notes = builder_visual.review_views(
        ask_returning([verdict]), 'job', [{'name': 'Case A'}], shots, 'rules')
    assert failures == []
    assert notes == [{'case': 'Case A', 'issue': 'Walls counter could use an icon'}]


def test_old_shape_string_issues_are_all_blocking(tmp_path, monkeypatch):
    shots = prepare(tmp_path, monkeypatch)
    verdict = {'passed': False, 'issues': ['Missing counter']}
    failures, notes = builder_visual.review_views(
        ask_returning([verdict]), 'job', [{'name': 'Case A'}], shots, 'rules')
    assert failures == [{'visual_review': 'Case A', 'issues': ['Missing counter']}]
    assert notes == []


def test_issue_without_a_recognized_severity_is_blocking(tmp_path, monkeypatch):
    shots = prepare(tmp_path, monkeypatch)
    verdict = {'passed': False, 'issues': [
        {'issue': 'Turn pill is on the wrong card'},
        {'issue': 'Difficulty display is stale', 'severity': 'major'}]}
    failures, notes = builder_visual.review_views(
        ask_returning([verdict]), 'job', [{'name': 'Case A'}], shots, 'rules')
    assert failures == [{'visual_review': 'Case A', 'issues': [
        'Turn pill is on the wrong card', 'Difficulty display is stale']}]
    assert notes == []


def test_passing_verdict_still_collects_cosmetic_notes(tmp_path, monkeypatch):
    shots = prepare(tmp_path, monkeypatch)
    verdict = {'passed': True, 'issues': [
        {'issue': 'Button wording could be shorter', 'severity': 'cosmetic'}]}
    failures, notes = builder_visual.review_views(
        ask_returning([verdict]), 'job', [{'name': 'Case A'}], shots, 'rules')
    assert failures == []
    assert notes == [{'case': 'Case A', 'issue': 'Button wording could be shorter'}]


def test_cosmetic_notes_carry_their_case_names(tmp_path, monkeypatch):
    shots = prepare(tmp_path, monkeypatch, names=('Case A', 'Case B'))
    verdicts = [
        {'passed': False, 'issues': [{'issue': 'Icon style differs', 'severity': 'cosmetic'}]},
        {'passed': False, 'issues': [{'issue': 'Phrasing could be polished', 'severity': 'cosmetic'}]}]
    failures, notes = builder_visual.review_views(
        ask_returning(verdicts), 'job', [{'name': 'Case A'}, {'name': 'Case B'}], shots, 'rules')
    assert failures == []
    assert notes == [{'case': 'Case A', 'issue': 'Icon style differs'},
                     {'case': 'Case B', 'issue': 'Phrasing could be polished'}]


def test_missing_evidence_still_raises(tmp_path, monkeypatch):
    shots = prepare(tmp_path, monkeypatch)
    shots = [s for s in shots if not (s['view'] == 'view_of_mover' and s['width'] == 390
                                      and s['direction'] == 'ltr')]
    with pytest.raises(RuntimeError, match='incomplete evidence'):
        builder_visual.review_views(
            ask_returning([{'passed': True, 'issues': []}]), 'job',
            [{'name': 'Case A'}], shots, 'rules')


def test_review_payload_is_sampled_from_the_full_matrix(tmp_path, monkeypatch):
    shots = prepare(tmp_path, monkeypatch)
    before = [dict(s) for s in shots]
    payloads = []
    builder_visual.review_views(
        ask_returning([{'passed': True, 'issues': []}], payloads), 'job',
        [{'name': 'Case A'}], shots, 'rules')
    content = payloads[0]
    labels = set()
    for item in content:
        if item['type'] == 'text' and 'Approved then actual' in item['text']:
            view, rest = item['text'].split('. Approved')[0].split(', ')
            size, direction = rest.split(' ')
            width, height = size[:-2].split('x')
            labels.add((view, int(width), int(height), direction))
    expected = {(view, width, height, direction) for view in VIEWS
                for (width, height, direction) in
                [(390, 844, 'ltr'), (844, 390, 'ltr'), (844, 390, 'rtl'), (1366, 768, 'rtl')]}
    assert labels == expected
    # Every sampled shot sends its approved mockup and its actual render.
    assert sum(item['type'] == 'image_url' for item in content) == 32
    # The full matrix the deterministic stages consume is left untouched:
    # nothing is dropped from the caller's list (1920x1080 and 820x1180
    # included), only from what the model is shown.
    assert shots == before and len(shots) == 48
