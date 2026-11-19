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
