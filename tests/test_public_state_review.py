"""Reviewed catalog flags cover every fixture and publish only guarded metadata."""
import hashlib
import json
from pathlib import Path

import pytest

from game_platform.tools import publish_public_state_flags as publisher

ROOT = Path(__file__).resolve().parents[1]
HIDDEN_FIXTURES = {"battleship", "catan", "crazy_eights", "go_fish", "guess_who",
                   "hearts", "memory", "spades", "thirty_one", "pedro",
                   "big_two", "last_floe", "court_piece",
                   "blokus", "dos", "catch_the_ten", "mille_bornes",
                   "sergeant_major", "mau_mau", "conquian", "snap", "slapjack",
                   "whist", "scopa", "cartographers",
                   "lanterntrails"}


def test_every_declarative_fixture_explicitly_classifies_its_gameplay_state():
    packages = {path.stem: json.loads(path.read_text())
                for path in (ROOT / "games/declarative").glob("*.json")
                if path.stem != "backgammon.schema"}
    assert {"backgammon", "chess", "nim", "tictactoe"} <= packages.keys()
    assert HIDDEN_FIXTURES <= packages.keys()
    for kind, package in packages.items():
        assert package["all_state_public"] is (kind not in HIDDEN_FIXTURES), kind
    bundled = json.loads((ROOT / "frontends/portal/src/core/bundled-tictactoe.json").read_text())
    native = json.loads((ROOT / "tests/fixtures/declarative/connect4-native-package.json").read_text())
    assert bundled["all_state_public"] is True
    assert native["game"]["all_state_public"] is True


def row_and_current(public=True):
    digest = hashlib.sha256(b"reviewed rules").hexdigest()
    row = {"id": "existing", "version": 7, "name": "Existing game",
           "server_code_sha256": digest, "all_state_public": public,
           "reason": "Shared board."}
    game = {"id": "existing", "version": 7, "renderer_type": "declarative",
            "server_code": "reviewed rules", "all_state_public": False}
    return row, game


def test_manifest_covers_the_reviewed_catalog_and_both_visibility_classes():
    rows = publisher.reviewed_games(publisher.MANIFEST)
    assert len(rows) == 149
    assert {row["all_state_public"] for row in rows} == {False, True}
    by_name = {row["name"]: row for row in rows}
    for name in ("Backgammon", "Chess (Declarative)", "Yacht", "Yut Nori"):
        assert by_name[name]["all_state_public"] is True
    for name in ("Poker", "Memory pairs", "Perudo", "Codenames", "Zendo"):
        assert by_name[name]["all_state_public"] is False


def test_publisher_only_patches_the_boolean_and_secret_then_accepts_reruns(monkeypatch):
    row, game = row_and_current()
    writes = []

    def request(base, path, body=None):
        assert path == "/games/existing"
        if body is not None:
            writes.append(body)
            game.update(all_state_public=body["all_state_public"], version=8)
        return dict(game)

    monkeypatch.setattr(publisher, "request", request)
    result = publisher.publish("https://example.test", [row], secret="private")
    assert writes == [{"all_state_public": True,
                       "game_addition_request_id_and_secret": "private"}]
    assert result[0]["action"] == "updated"
    assert publisher.publish("https://example.test", [row], secret="private")[0]["action"] == "already_current"
    assert len(writes) == 1


@pytest.mark.parametrize("changed", [{"version": 8}, {"server_code": "edited rules"},
                                     {"renderer_type": "html"}])
def test_whole_plan_is_guarded_before_any_writes(monkeypatch, changed):
    row, current = row_and_current()
    other = {**row, "id": "changed"}
    writes = []

    def request(base, path, body=None):
        if body is not None:
            writes.append(body)
        return {**current, **({"id": "changed", **changed} if path.endswith("changed") else {})}

    monkeypatch.setattr(publisher, "request", request)
    with pytest.raises(ValueError, match="changed since review"):
        publisher.publish("https://example.test", [row, other], secret="private")
    assert writes == []


def test_publisher_refuses_applying_against_an_undeployed_api(monkeypatch):
    row, current = row_and_current()
    current.pop("all_state_public")
    monkeypatch.setattr(publisher, "request", lambda *args: current)
    with pytest.raises(ValueError, match="Deploy"):
        publisher.publish("https://example.test", [row], secret="private")
