"""The audit report must reject wrong boards and missing platform evidence."""
import importlib.util
import base64
import json
from pathlib import Path

import pytest


SCRIPT=Path(__file__).resolve().parents[1] / "scripts/portal-parity-report.py"
spec=importlib.util.spec_from_file_location("portal_parity_report",SCRIPT)
report=importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


@pytest.mark.parametrize("field,value",[
    ("state",{"board":[1,0]}),("logicState",{"board":[1,0]}),
    ("turn_of_player_indices",[1]),("move_count",2),("moves",[{"move_number":2}]),
    ("game_version",9),("practiceSeed",421),
])
def test_saved_position_comparison_rejects_different_gameplay(field,value):
    expected={"state":{"board":[0,1]},"logicState":{"board":[0,1]},"turn_of_player_indices":[0],
              "move_count":1,"moves":[{"move_number":1}],"game_version":1,"practiceSeed":420}
    assert report.compare_match(dict(expected,**{field:value}),expected)==[field]


def test_report_does_not_trust_a_platform_pass_flag_without_files(tmp_path):
    fixture=tmp_path / "fixture.json"
    fixture.write_text(json.dumps({"sourceSha":"a"*40,"viewport":{"width":402,"height":874},"games":[]}))
    evidence=tmp_path / "evidence"
    for platform in report.PLATFORMS:
        folder=evidence / platform;folder.mkdir(parents=True)
        (folder / "evidence.json").write_text('{"passed":true}')
    summary,_=report.build_report(fixture,evidence,tmp_path / "output")
    assert summary["passed"] is False
    assert len(summary["missing"])==15


@pytest.mark.parametrize("crops", ["none", "complete", "partial"])
def test_driver_screenshots_and_saved_positions_work_without_optional_manual_crops(tmp_path, crops):
    initial={"move_count":0,"state":{"board":[None]}}
    final={"move_count":1,"state":{"board":[0]}}
    fixture=tmp_path/"fixture.json"
    fixture.write_text(json.dumps({"sourceSha":"a"*40,"viewport":{"width":402,"height":874},
        "games":[{"slug":"demo","name":"Demo","initial":initial,
                  "steps":[{"number":1,"expectedMatch":final}]}]}))
    png=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")
    evidence=tmp_path/"evidence"
    for platform in report.PLATFORMS:
        directory=evidence/platform;directory.mkdir(parents=True)
        for page in report.PAGES:(directory/f"page-{page}.png").write_bytes(png)
        for stage,match in [("demo-initial",initial),("demo-step1",final),("demo-restart",final)]:
            (directory/f"{stage}.png").write_bytes(png)
            (directory/f"{stage}-match.json").write_text(json.dumps(match))
        if crops=="complete" or crops=="partial" and platform=="web":
            (directory/"board-demo.png").write_bytes(png)
    output=tmp_path/"report"
    summary,_=report.build_report(fixture,evidence,output)
    assert summary["passed"] is (crops!="partial")
    assert len(summary["checks"])==9
    assert ("board-demo" in (output/"index.html").read_text()) is (crops!="none")


def test_fixture_contains_real_computer_games_and_ui_actions():
    fixture=json.loads((SCRIPT.parents[1] / "tests/fixtures/portal-parity/common.json").read_text())
    assert json.loads(fixture["storage"]["buildplay.shared.v1.visitor"])==fixture["accountData"]
    assert fixture["accountData"]["selectedId"] is None
    assert {game["slug"] for game in fixture["games"]}=={"tictactoe","connect4","checkers"}
    for game in fixture["games"]:
        assert game["initial"]["localMode"]=="computer"
        assert [player["kind"] for player in game["initial"]["players"]]==["human","computer"]
        assert len(game["steps"])==3
        for step in game["steps"]:
            assert step["uiActions"] and all(action["label"] for action in step["uiActions"])
            assert step["expectedMatch"]["moves"]


def complete_page_evidence(tmp_path):
    fixture=tmp_path/"fixture.json"
    fixture.write_text(json.dumps({"sourceSha":"a"*40,"viewport":{"width":402,"height":874},"games":[]}))
    evidence=tmp_path/"evidence"
    png=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")
    for platform in report.PLATFORMS:
        directory=evidence/platform;directory.mkdir(parents=True)
        for page in report.PAGES:(directory/f"page-{page}.png").write_bytes(png)
    return fixture,evidence,png


@pytest.mark.parametrize("name,payload",[
    ("summary.json",{"sourceSha":"b"*40}),
    ("manifest.json",{"sourceSha":"b"*40}),
    ("audit-metadata.json",{"sourceSha":"b"*40}),
    ("page-refresh.json",{"sourceSha":"b"*40}),
    ("provenance.json",{"run":{"head_sha":"b"*40}}),
    ("provenance.json",{"artifact":{"workflow_run":{"head_sha":"b"*40}}}),
])
def test_report_guard_rejects_conflicting_available_source_metadata(tmp_path,name,payload):
    fixture,evidence,_=complete_page_evidence(tmp_path)
    (evidence/"android"/name).write_text(json.dumps(payload))
    output=tmp_path/"report"
    summary,_=report.build_report(fixture,evidence,output)
    assert summary["passed"] is False and summary["metadataErrors"]
    assert summary["stateComparisonsPassed"] is True
    assert (output/"proof"/"android"/name).is_file()
    assert "conflicting source metadata" in (output/"index.html").read_text()


def test_report_guard_preserves_nested_provenance_and_page_refresh_on_all_platforms(tmp_path):
    fixture,evidence,png=complete_page_evidence(tmp_path)
    for platform in (*report.PLATFORMS,"web-desktop"):
        directory=evidence/platform
        directory.mkdir(exist_ok=True)
        if platform=="web-desktop":
            for page in report.PAGES:(directory/f"page-{page}.png").write_bytes(png)
        nested=directory/"download"/"results";nested.mkdir(parents=True)
        for name in ("manifest.json","audit-metadata.json","page-refresh.json"):
            (nested/name).write_text(json.dumps({"sourceSha":"a"*40,"evidence":"retained"}))
        (directory/"provenance.json").write_text(json.dumps({"run":{"head_sha":"a"*40},"artifact":{"workflow_run":{"head_sha":"a"*40}}}))
    output=tmp_path/"report"
    summary,_=report.build_report(fixture,evidence,output)
    assert summary["passed"] is True and summary["metadataErrors"]==[]
    for platform in (*report.PLATFORMS,"web-desktop"):
        for name in ("manifest.json","audit-metadata.json","provenance.json","page-refresh.json"):
            assert (output/"proof"/platform/name).is_file()


def test_report_guard_allows_older_evidence_without_new_optional_metadata(tmp_path):
    fixture,evidence,_=complete_page_evidence(tmp_path)
    summary,_=report.build_report(fixture,evidence,tmp_path/"report")
    assert summary["passed"] is True
    assert summary["sourceMetadataChecks"]==[] and summary["metadataErrors"]==[]


def test_report_guard_partial_desktop_is_reported_without_aborting(tmp_path):
    fixture,evidence,png=complete_page_evidence(tmp_path)
    desktop=evidence/"web-desktop";desktop.mkdir()
    (desktop/"page-catalog.png").write_bytes(png)
    output=tmp_path/"report"
    summary,_=report.build_report(fixture,evidence,output)
    assert summary["passed"] is False and len(summary["missing"])==4
    assert summary["desktop"]["screenshots"]==1
    assert (output/"comparison.json").is_file()
    assert "Screenshot missing" in (output/"index.html").read_text()


@pytest.mark.parametrize("review_complete",[False,True])
def test_report_guard_visual_review_status_is_separate_from_saved_state_checks(tmp_path,review_complete):
    fixture,evidence,_=complete_page_evidence(tmp_path)
    (evidence/"findings.json").write_text(json.dumps({"visualReviewComplete":review_complete,"findings":[{"title":"Recorded finding","description":"Still visible in captures."}]}))
    output=tmp_path/"report"
    summary,_=report.build_report(fixture,evidence,output)
    assert summary["passed"] is True and summary["stateComparisonsPassed"] is True
    assert summary["visualReviewComplete"] is review_complete
    document=(output/"index.html").read_text()
    assert ("Visual review: Complete" if review_complete else "Visual review: Pending final three-platform review") in document
    assert "Saved-state equality does not establish visual equivalence" in document
