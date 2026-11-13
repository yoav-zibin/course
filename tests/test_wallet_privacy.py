"""A user's token wallet is private (bug 17: GET /users/{id} needs no login, and
showed anyone's token_balance)."""

from game_platform.tests.helpers import Api


def test_only_the_owner_sees_their_token_balance() -> None:
    api = Api()
    alice, bob = api.new_user("alice"), api.new_user("bob")
    own = api.ok("GET", f"/users/{alice}", as_user=alice)
    assert isinstance(own["token_balance"], int)
    assert "last_token_grant_day" in own
    for viewer in (None, bob):
        seen = api.ok("GET", f"/users/{alice}", as_user=viewer)
        assert (seen["token_balance"], seen["last_token_grant_day"]) == (None, None), viewer
        assert seen["display_name"] == "alice"


def test_a_wrong_password_does_not_count_as_the_owner() -> None:
    api = Api()
    alice = api.new_user("alice")
    response = api.request("GET", f"/users/{alice}", as_user=alice, password="not-her-password")
    assert response.status_code == 200
    assert response.json()["token_balance"] is None


def test_the_batch_lookup_hides_other_users_balances() -> None:
    api = Api()
    alice, bob = api.new_user("alice"), api.new_user("bob")
    rows = {row["id"]: row for row in api.ok("GET", "/users", as_user=alice, params={"ids": f"{alice},{bob}"})}
    assert isinstance(rows[alice]["token_balance"], int)
    assert rows[bob]["token_balance"] is None
