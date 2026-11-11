"""Game proposals: the public Portal submission endpoint and the
master-password-gated list/delete endpoints, over a fake-Firestore
QueryStore."""

import pytest

from game_platform import game_proposals as gp
from game_platform.scaling_service import ScalablePlatform
from game_platform.tests.fake_firestore import FakeClient, query_store
from game_platform.tests.helpers import Api

MASTER = "test-master-password"
AUTH = ("anyone", MASTER)


@pytest.fixture
def api():
    store = query_store("propns", FakeClient())
    api = Api(store=store, master_password=MASTER)
    api.client.app.state.platform = ScalablePlatform(
        store=store, computer_move_delay_seconds=0
    )
    return api


def propose(api, **overrides):
    payload = {
        "game_name": "Azul",
        "description": "Tile drafting, beautiful and quick.",
        "rules_url": "https://example.com/azul-rules",
        "proposer_name": "Sam",
        **overrides,
    }
    return api.client.post("/game-proposals", json=payload)


def test_submit_then_list_with_master_password(api):
    response = propose(api)
    assert response.status_code == 201, response.text
    created = response.json()
    assert created["game_name"] == "Azul"
    assert created["description"] == "Tile drafting, beautiful and quick."
    assert created["rules_url"] == "https://example.com/azul-rules"
    assert created["proposer_name"] == "Sam"
    assert created["created_at"]

    response = propose(api, game_name="Wingspan", description="", rules_url="")
    assert response.status_code == 201, response.text

    response = api.client.get("/game-proposals", auth=AUTH)
    assert response.status_code == 200, response.text
    proposals = response.json()["proposals"]
    assert [p["game_name"] for p in proposals] == ["Azul", "Wingspan"]
    assert proposals[0]["id"] == created["id"]


def test_list_and_delete_require_the_master_password(api):
    propose(api)
    assert api.client.get("/game-proposals").status_code == 401
    assert api.client.get("/game-proposals", auth=("anyone", "wrong")).status_code == 401
    proposal_id = api.client.get("/game-proposals", auth=AUTH).json()["proposals"][0][
        "id"
    ]
    assert api.client.delete(f"/game-proposals/{proposal_id}").status_code == 401
    assert (
        api.client.delete(
            f"/game-proposals/{proposal_id}", auth=("anyone", "wrong")
        ).status_code
        == 401
    )
    # Still there after the unauthorized attempts.
    assert len(api.client.get("/game-proposals", auth=AUTH).json()["proposals"]) == 1


def test_delete_removes_the_proposal(api):
    propose(api)
    propose(api, game_name="Wingspan")
    proposals = api.client.get("/game-proposals", auth=AUTH).json()["proposals"]
    response = api.client.delete(f"/game-proposals/{proposals[0]['id']}", auth=AUTH)
    assert response.status_code == 204, response.text
    remaining = api.client.get("/game-proposals", auth=AUTH).json()["proposals"]
    assert [p["game_name"] for p in remaining] == ["Wingspan"]
    # Deleting it again is a 404.
    response = api.client.delete(f"/game-proposals/{proposals[0]['id']}", auth=AUTH)
    assert response.status_code == 404


def test_submission_validation(api):
    assert propose(api, game_name="").status_code == 422
    assert propose(api, game_name="   ").status_code == 422
    assert propose(api, game_name="x" * 121).status_code == 422
    assert propose(api, description="x" * 2001).status_code == 422
    assert propose(api, rules_url="ftp://example.com/rules").status_code == 422
    assert propose(api, rules_url="example.com/rules").status_code == 422
    # A minimal proposal (name only) is fine.
    response = api.client.post("/game-proposals", json={"game_name": "Azul"})
    assert response.status_code == 201, response.text
    assert response.json()["description"] == ""
    assert response.json()["rules_url"] == ""


def test_store_round_trip_without_http():
    store = query_store("propns2", FakeClient())
    assert gp.proposals_supported(store)
    row = gp.create_proposal(
        store,
        game_name="Azul",
        description="",
        rules_url="",
        proposer_name="",
    )
    assert [r["id"] for r in gp.list_proposals(store)] == [row["id"]]
    assert gp.delete_proposal(store, row["id"]) is True
    assert gp.list_proposals(store) == []
    assert gp.delete_proposal(store, row["id"]) is False
