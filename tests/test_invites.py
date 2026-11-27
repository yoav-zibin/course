"""Referral tracking and the private tree behind /admin/referrals."""

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

import game_platform.api as api_module
from game_platform.api import create_app
from game_platform.config import AuthConfig, EmailAuthConfig, GoogleAuthConfig
from game_platform.service import GamePlatform
from game_platform.store import InMemoryStore
from game_platform.tests.helpers import Api, FakeClock, login_google_admin


class RecordingSender:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    def send_login_code(self, destination: str, code: str) -> None:
        self.sent.append((destination, code))


def owner_match(api: Api, owner: str) -> str:
    return api.new_match(owner=owner, game_id=api.new_game(owner=owner))


def invited(api: Api, name: str, *, by: str | None) -> str:
    """A guest recruited by opening a multiplayer match belonging to [by]."""
    match_id = owner_match(api, by) if by in api.passwords_by_user_id else "missing-match"
    user = api.ok(
        "POST", "/users", json={"display_name": name, "invite_match_id": match_id}
    )
    api.passwords_by_user_id[user["id"]] = user["password"]
    return user["id"]


def rows_by_name(api: Api) -> dict[str, dict]:
    return {row["display_name"]: row for row in api.ok("GET", "/admin/invites")["users"]}


def counts(api: Api) -> dict[str, tuple[str, int, int, int]]:
    """name -> (inviter's name, direct invites, total invites, depth)."""
    return {
        name: (
            row["invited_by_name"],
            row["direct_invites"],
            row["total_invites"],
            row["depth"],
        )
        for name, row in rows_by_name(api).items()
    }


# Recording the inviter


def test_a_guest_who_signs_up_through_an_invite_link_records_the_inviter(
    api: Api,
) -> None:
    ann = api.new_user("ann")
    bob = invited(api, "bob", by=ann)
    assert rows_by_name(api)["bob"]["invited_by_user_id"] == ann
    # Users without an invite link have no inviter.
    assert rows_by_name(api)["ann"]["invited_by_user_id"] is None
    assert bob != ann


def test_an_unknown_inviter_is_ignored_and_never_blocks_signing_up(api: Api) -> None:
    invited(api, "bob", by="no-such-user")
    invited(api, "cy", by="")
    assert counts(api) == {"bob": ("", 0, 0, 0), "cy": ("", 0, 0, 0)}


def test_an_invite_from_a_merged_away_account_credits_the_survivor(api: Api) -> None:
    ann, ann_old = api.new_user("ann"), api.new_user("ann (old)")
    api.ok("POST", f"/users/{ann_old}/merge", json={"into_user_id": ann, "into_password": api.passwords_by_user_id[ann]}, as_user=ann_old)
    invited(api, "bob", by=ann_old)
    assert rows_by_name(api)["bob"]["invited_by_user_id"] == ann


def test_google_login_records_the_inviter_only_for_a_new_account(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = Api(auth_config=AuthConfig(google=GoogleAuthConfig(client_id="g-client")))
    monkeypatch.setattr(
        api_module,
        "verify_google_id_token",
        lambda token, client_id: ("sub-" + token, "Gina " + token, "", ""),
    )
    ann = api.new_user("ann")
    cy = api.new_user("cy")
    body = {"id_token": "1", "invite_match_id": owner_match(api, ann)}
    gina = api.ok("POST", "/auth/google", json=body)["user_id"]
    # Logging in again through someone else's link doesn't change the inviter.
    again = api.ok(
        "POST", "/auth/google", json={"id_token": "1", "invite_match_id": owner_match(api, cy)}
    )
    assert again["user_id"] == gina
    assert rows_by_name(api)["Gina 1"]["invited_by_user_id"] == ann


def test_a_code_login_records_the_inviter() -> None:
    sender = RecordingSender()
    api = Api(
        auth_config=AuthConfig(email=EmailAuthConfig(provider="smtp")),
        email_sender=sender,
    )
    ann = api.new_user("ann")
    started = api.ok("POST", "/auth/email/start", json={"email": "eve@example.com"})
    _, code = sender.sent[0]
    api.ok(
        "POST",
        "/auth/email/verify",
        json={
            "verification_id": started["verification_id"],
            "code": code,
            "invite_match_id": owner_match(api, ann),
        },
    )
    assert rows_by_name(api)["eve"]["invited_by_user_id"] == ann


# The invite tree


def test_total_invites_count_everyone_brought_in_transitively(api: Api) -> None:
    #        ann
    #       /   \
    #     bob    cy
    #    /   \
    #  dee   eli
    #   |
    #  fay
    ann = api.new_user("ann")
    bob = invited(api, "bob", by=ann)
    invited(api, "cy", by=ann)
    dee = invited(api, "dee", by=bob)
    invited(api, "eli", by=bob)
    invited(api, "fay", by=dee)
    api.new_user("gus")  # came on his own

    assert counts(api) == {
        "ann": ("", 2, 5, 0),
        "bob": ("ann", 2, 3, 1),
        "cy": ("ann", 0, 0, 1),
        "dee": ("bob", 1, 1, 2),
        "eli": ("bob", 0, 0, 2),
        "fay": ("dee", 0, 0, 3),
        "gus": ("", 0, 0, 0),
    }
    stats = api.ok("GET", "/admin/invites")
    # The leaderboard order: most total invites first.
    assert [row["display_name"] for row in stats["users"]][:3] == ["ann", "bob", "dee"]
    assert stats["summary"] == {
        "users": 7,
        "invited_users": 5,
        "inviters": 3,
        "biggest_tree": 6,
        "longest_chain": 3,
    }


def test_the_invite_tree_of_an_empty_platform(api: Api) -> None:
    assert api.ok("GET", "/admin/invites")["summary"] == {
        "users": 0,
        "invited_users": 0,
        "inviters": 0,
        "biggest_tree": 0,
        "longest_chain": 0,
    }


def test_merging_keeps_the_invite_credit(api: Api) -> None:
    ann = api.new_user("ann")
    bob_guest = invited(api, "bob (guest)", by=ann)
    bob = api.new_user("bob")
    invited(api, "cy", by=bob_guest)
    # Bob merges his old guest account into his main one.
    api.ok(
        "POST", f"/users/{bob_guest}/merge", json={"into_user_id": bob, "into_password": api.passwords_by_user_id[bob]}, as_user=bob_guest
    )
    # The merged-away account is gone from the tree; the survivor inherits its
    # inviter and the people it invited.
    assert counts(api) == {
        "ann": ("", 1, 2, 0),
        "bob": ("ann", 1, 1, 1),
        "cy": ("bob", 0, 0, 2),
    }


def test_a_merge_never_makes_someone_their_own_inviter(api: Api) -> None:
    # Ann's guest account invited Bob, and Bob invited Ann's main account. Merging
    # Ann's guest account into her main one must not make Ann invite herself
    # (through Bob).
    ann_guest = api.new_user("ann (guest)")
    bob = invited(api, "bob", by=ann_guest)
    ann = invited(api, "ann", by=bob)
    api.ok(
        "POST", f"/users/{ann_guest}/merge", json={"into_user_id": ann, "into_password": api.passwords_by_user_id[ann]}, as_user=ann_guest
    )
    result = counts(api)
    assert set(result) == {"ann", "bob"}
    # Every chain ends, and nobody counts themselves.
    assert result["ann"][2] + result["bob"][2] == 1


def test_the_tree_survives_inviter_loops_in_the_data() -> None:
    # A loop can't be made through the API, but the stats must still end if the
    # data ever holds one.
    store = InMemoryStore()
    platform = GamePlatform(store=store, clock=FakeClock())
    ann = platform.create_user(display_name="ann")
    bob = platform.create_user(display_name="bob")
    store.put_user(replace(bob, invited_by_user_id=ann.id, invited_via_match_id="historic-match"))
    store.put_user(replace(ann, invited_by_user_id=bob.id))
    rows = {row["display_name"]: row for row in platform.invite_stats()["users"]}
    assert {name: row["total_invites"] for name, row in rows.items()} == {
        "ann": 1,
        "bob": 0,
    }


def test_deleting_a_user_preserves_their_original_historical_inviter_chain(api: Api) -> None:
    ann = api.new_user("ann")
    bob = invited(api, "bob", by=ann)
    cy = invited(api, "cy", by=bob)
    api.ok("DELETE", f"/admin/users/{bob}")
    assert api.platform._store.get_user(cy).invited_by_user_id == bob
    assert api.ok("GET", "/users/me/recruitment", as_user=cy)["inviter_chain"] == [bob, ann]



def test_the_referrals_page_and_data_need_the_master_password() -> None:
    client = TestClient(create_app(master_password="s3cret"))
    name = "Private referral test user"
    assert client.post("/users", json={"display_name": name}).status_code == 201
    html = client.get("/admin/referrals", follow_redirects=False)
    assert html.status_code == 303
    assert "www-authenticate" not in html.headers
    for path in ("/admin/invites",):
        for credentials in (None, ("admin", "wrong-password")):
            response = client.get(path, auth=credentials)
            assert response.status_code == 401
            assert response.headers["www-authenticate"] == (
                'Basic realm="Game platform debug tools"'
            )
            assert name not in response.text

    page = client.get("/admin/referrals", follow_redirects=False)
    assert page.status_code == 303
    assert page.headers["location"] == "/admin/login?next=%2Fadmin%2Freferrals"
    data = client.get("/admin/invites", auth=("", "s3cret"))
    assert data.status_code == 200
    assert [user["display_name"] for user in data.json()["users"]] == [name]
    login_google_admin(client)
    page = client.get("/admin/referrals", follow_redirects=False)
    assert page.status_code == 200
    assert page.headers["content-type"].startswith("text/html")
    # The old dashboard path is retired; match invite capabilities use
    # /invites/{token}, rather than exposing referral data at /invites.
    assert client.get("/invites").status_code == 404
    assert client.get("/invites", auth=("", "s3cret")).status_code == 404


def test_the_inviter_is_saved_in_the_data_file(tmp_path) -> None:
    from game_platform.json_file_store import JsonFileStore

    path = tmp_path / "data.json"
    store = JsonFileStore(path, min_write_interval_seconds=0)
    platform = GamePlatform(store=store)
    ann = platform.create_user(display_name="ann")
    bob = platform.create_user(display_name="bob")
    store.put_user(replace(bob, invited_by_user_id=ann.id, invited_via_match_id="historic-match"))
    store.close()
    reloaded = JsonFileStore(path)
    assert reloaded.get_user(bob.id).invited_by_user_id == ann.id
    reloaded.close()


def test_equal_totals_sort_by_name_on_the_leaderboard(api: Api) -> None:
    ann, bob = api.new_user("ann"), api.new_user("bob")
    invited(api, "cy", by=bob)
    invited(api, "dee", by=ann)
    names = [row["display_name"] for row in api.ok("GET", "/admin/invites")["users"]]
    assert names[:2] == ["ann", "bob"]
