"""The audit report must reject wrong boards and missing platform evidence."""
import importlib.util
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
