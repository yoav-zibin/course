"""Feedback: users' bugs, suggestions and reports of problems, about users, games,
matches or the platform."""

import datetime as dt
import json

import pytest
from fastapi.testclient import TestClient

from game_platform.api import create_app
from game_platform.json_file_store import JsonFileStore, read_snapshot
from game_platform.models import GameRules
from game_platform.service import GamePlatform, TooManyRequestsError
from game_platform.tests.helpers import Api, error

START = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)


class ManualClock:
    def __init__(self) -> None:
        self.now = START

    def __call__(self) -> dt.datetime:
        return self.now

    def advance(self, **delta) -> None:
        self.now += dt.timedelta(**delta)


def send(api: Api, as_user: str, target_type: str, target_id: str = "", text: str = "This is offensive",
         kind: str = "problem", **extra):
    return api.request("POST", "/feedback", as_user=as_user,
                       json={"kind": kind, "target_type": target_type, "target_id": target_id, "text": text, **extra})


def world(clock=None, store=None):
    platform = GamePlatform(clock=clock or ManualClock(), store=store)
    ann = platform.create_user(display_name="ann").id
    bob = platform.create_user(display_name="bob").id
    game = platform.create_game(
        caller_id=bob, name="Duel", description="",
        rules=GameRules(allowed_player_counts=(2,), allows_leave_mid_match=False, allows_join_mid_match=False),
        code="<div>duel</div>",
    ).id
    return platform, ann, bob, game


def feedback(platform, caller, target_type, target_id="", text="spam account", kind="problem"):
    return platform.send_feedback(caller_id=caller, kind=kind, target_type=target_type, target_id=target_id, text=text)


# Sending feedback


def test_feedback_on_a_user_a_game_a_match_and_the_platform(api: Api) -> None:
    ann, bob = api.new_user("ann"), api.new_user("bob")
    game = api.new_game(owner=bob)
    match = api.new_match(owner=bob, game_id=game, joiners=[ann], start=True)
    api.move(match, as_user=bob, next_turn=1, state={"pot": 1})
    sent = (("problem", "user", bob), ("bug", "game", game), ("suggestion", "match", match), ("bug", "platform", ""))
    for kind, target_type, target in sent:
        response = send(api, ann, target_type, target, kind=kind, text="  The board is cut off  ",
                        page="/static/portal.html#match=x")
        assert response.status_code == 201, response.text
        body = response.json()
        assert (body["kind"], body["target_type"], body["target_id"], body["text"], body["status"]) == (
            kind, target_type, target, "The board is cut off", "open")
        assert "reporter_user_id" not in body
    rows = {r["target_type"]: r for r in api.ok("GET", "/admin/feedback")["feedback"]}
    assert rows["game"]["context"] == {"game_version": 1, "page": "/static/portal.html#match=x"}
    assert rows["match"]["context"] == {"game_id": game, "game_version": 1, "move_count": 1, "page": "/static/portal.html#match=x"}
    assert (rows["user"]["target_name"], rows["game"]["target_name"], rows["platform"]["target_name"]) == ("bob", "Poker", "Platform")
    assert rows["match"]["target_name"] == ""  # the admin page looks up the match's game
    assert {r["reporter_name"] for r in rows.values()} == {"ann"}
    # The platform needs no target id.
    assert api.request("POST", "/feedback", as_user=bob,
                       json={"kind": "suggestion", "target_type": "platform", "text": "A dark mode please"}).status_code == 201


def test_what_cant_be_sent(api: Api) -> None:
    ann, bob = api.new_user("ann"), api.new_user("bob")
    game = api.new_game(owner=ann)
    for target_type in ("user", "game", "match"):
        assert error(send(api, ann, target_type, "nope")) == (400, "there is no such user, game or match")
    assert error(send(api, ann, "user", bob, text="   ")) == (
        400, "the feedback is too short: write at least 5 characters")
    assert error(send(api, ann, "user", bob, text=" abcd ")) == (
        400, "the feedback is too short: write at least 5 characters")
    assert send(api, ann, "user", bob, text="x" * 1000).status_code == 201
    assert error(send(api, bob, "user", ann, text="x" * 1001)) == (400, "the feedback is too long: use at most 1000 characters")
    assert error(send(api, ann, "user", ann)) == (400, "you can't send feedback about yourself")
    for kind in ("bug", "suggestion", "problem"):
        assert error(send(api, ann, "game", game, kind=kind)) == (400, "you can't send feedback about your own game")
    assert send(api, ann, "planet", bob).status_code == 422
    assert send(api, ann, "platform", kind="praise").status_code == 422
    assert api.request("POST", "/feedback", as_user=ann,
                       json={"target_type": "platform", "text": "no kind given"}).status_code == 422
    # Guests can send feedback too; logged-out visitors can't.
    assert api.request("POST", "/feedback", json={"kind": "bug", "target_type": "platform", "text": "hello there"}).status_code == 401


def test_the_service_checks_kinds_and_targets_too() -> None:
    platform, ann, bob, game = world()
    with pytest.raises(Exception, match="kind must be bug, suggestion or problem"):
        feedback(platform, ann, "platform", kind="praise")
    with pytest.raises(Exception, match="target_type must be user, game, match or platform"):
        feedback(platform, ann, "planet", "x")


def test_a_merged_away_account_is_still_yourself(api: Api) -> None:
    ann, ann_old, bob = api.new_user("ann"), api.new_user("ann (old)"), api.new_user("bob")
    api.ok("POST", f"/users/{ann_old}/merge", json={"into_user_id": ann, "into_password": api.passwords_by_user_id[ann]}, as_user=ann_old)
    assert error(send(api, ann, "user", ann_old)) == (400, "you can't send feedback about yourself")
    # Feedback on someone's old account counts against the survivor.
    assert send(api, bob, "user", ann_old).json()["target_id"] == ann


def test_a_private_match_you_cant_see_cant_get_feedback(api: Api) -> None:
    ann, bob, cy = api.new_user("ann"), api.new_user("bob"), api.new_user("cy")
    game = api.new_game(owner=bob)
    private = api.ok("POST", "/matches", as_user=bob, json={"game_id": game, "private": True})["id"]
    assert error(send(api, cy, "match", private)) == (400, "there is no such user, game or match")
    assert send(api, bob, "match", private).status_code == 201


# Limits


def test_at_most_20_messages_in_a_rolling_24_hours() -> None:
    clock = ManualClock()
    platform, ann, bob, game = world(clock)
    targets = [platform.create_user(display_name=f"user {n}").id for n in range(21)]
    for target in targets[:20]:
        feedback(platform, ann, "user", target)
        clock.advance(minutes=30)
    with pytest.raises(TooManyRequestsError, match="at most 20 feedback messages a day"):
        feedback(platform, ann, "user", targets[20])
    with pytest.raises(TooManyRequestsError):
        feedback(platform, ann, "platform", kind="bug", text="every kind counts")
    # A repeat of an earlier message within 24 hours is an update, so it still works.
    updated, created = feedback(platform, ann, "user", targets[19], text="still spam")
    assert not created and updated.text == "still spam"
    # 24 hours after the first message, there's room again.
    clock.advance(hours=14, minutes=31)
    assert feedback(platform, ann, "user", targets[20])[1]


def test_the_limit_is_a_429_with_a_clear_message() -> None:
    clock = ManualClock()
    platform, ann, bob, game = world(clock)
    client = TestClient(create_app(platform))
    headers = {"X-User-Id": ann, "X-User-Password": platform._store.get_user(ann).password}
    for n in range(20):
        target = platform.create_user(display_name=f"u{n}").id
        body = {"kind": "problem", "target_type": "user", "target_id": target, "text": "spam!"}
        assert client.post("/feedback", headers=headers, json=body).status_code == 201
    response = client.post("/feedback", headers=headers, json={"kind": "bug", "target_type": "game", "target_id": game, "text": "spam!"})
    assert response.status_code == 429
    assert response.json()["detail"] == "you can send at most 20 feedback messages a day; try again tomorrow"
    assert response.json()["code"] == "feedback_daily_limit"


def test_a_repeat_of_the_same_kind_within_24_hours_updates_it() -> None:
    clock = ManualClock()
    platform, ann, bob, game = world(clock)
    first, created = feedback(platform, ann, "game", game, text="rude words")
    clock.advance(hours=23)
    again, created_again = feedback(platform, ann, "game", game, text="rude words in the title")
    assert created and not created_again
    assert again.id == first.id and again.text == "rude words in the title"
    assert (again.created_at, again.updated_at) == (START, START + dt.timedelta(hours=23))
    # Another kind on the same game is separate feedback.
    bug, created_bug = feedback(platform, ann, "game", game, kind="bug", text="the board flickers")
    assert created_bug and bug.id != first.id
    assert len(platform._store.list_feedback()) == 2
    clock.advance(hours=2)  # 25 hours after the first one: a new message
    third, created_third = feedback(platform, ann, "game", game, text="still rude")
    assert created_third and third.id != first.id
    # Someone else's feedback on the same game is separate too.
    assert feedback(platform, platform.create_user(display_name="cy").id, "game", game, text="rude!")[1]


# The admin listing


def test_the_admin_listing_needs_the_master_password() -> None:
    client = TestClient(create_app(master_password="s3cret"))
    assert client.get("/admin/feedback").status_code == 401
    assert client.get("/admin/feedback", auth=("", "wrong")).status_code == 401
    assert client.get("/admin/feedback", auth=("", "s3cret")).status_code == 200
    assert "/admin/feedback" not in client.get("/openapi.json").json()["paths"]


def test_nobody_else_can_list_feedback() -> None:
    platform, ann, bob, game = world()
    client = TestClient(create_app(platform, master_password="s3cret"))
    headers = {"X-User-Id": ann, "X-User-Password": platform._store.get_user(ann).password}
    feedback(platform, ann, "user", bob, text="bad name")
    # A logged-in user (even the sender) gets neither the admin page nor its data.
    assert client.get("/feedback", headers=headers).status_code == 401
    assert client.get("/admin/feedback", headers=headers).status_code == 401
    # And there's no public way to list feedback.
    body = {"kind": "problem", "target_type": "user", "target_id": bob, "text": "bad name again"}
    assert client.post("/feedback", headers=headers, json=body).json().get("reporter_user_id") is None


def test_the_admin_listing_newest_first_with_filters_and_most_reported() -> None:
    clock = ManualClock()
    platform, ann, bob, game = world(clock)
    cy = platform.create_user(display_name="cy").id
    feedback(platform, ann, "user", bob, text="bad name")
    clock.advance(minutes=1)
    feedback(platform, cy, "user", bob, text="really bad name")
    clock.advance(minutes=1)
    feedback(platform, ann, "game", game, text="offensive game")
    clock.advance(minutes=1)
    feedback(platform, cy, "game", game, kind="bug", text="the board flickers")
    clock.advance(minutes=1)
    feedback(platform, cy, "platform", kind="suggestion", text="a dark mode")
    listing = platform.admin_feedback()
    assert (listing["count"], listing["more"]) == (5, False)
    assert [(r["kind"], r["target_type"], r["reporter_name"]) for r in listing["feedback"]] == [
        ("suggestion", "platform", "cy"), ("bug", "game", "cy"), ("problem", "game", "ann"),
        ("problem", "user", "cy"), ("problem", "user", "ann")]
    # Most reported counts only problems.
    assert [(m["target_type"], m["target_name"], m["reports"]) for m in listing["most_reported"]] == [
        ("user", "bob", 2), ("game", "Duel", 1)]
    assert [r["kind"] for r in platform.admin_feedback(kind="bug")["feedback"]] == ["bug"]
    assert [r["target_type"] for r in platform.admin_feedback(target_type="game")["feedback"]] == ["game", "game"]
    assert platform.admin_feedback(target_type="user", target_id=bob)["count"] == 2
    assert platform.admin_feedback(status="open")["count"] == 5
    assert platform.admin_feedback(status="dismissed")["count"] == 0
    # An updated message moves to the top.
    clock.advance(minutes=1)
    feedback(platform, ann, "user", bob, text="bad name, still")
    assert platform.admin_feedback()["feedback"][0]["text"] == "bad name, still"


def test_the_admin_listing_over_http(api: Api) -> None:
    ann, bob = api.new_user("ann"), api.new_user("bob")
    send(api, ann, "user", bob)
    send(api, ann, "platform", kind="bug", text="the menu doesn't open")
    assert api.ok("GET", "/admin/feedback", params={"target_type": "user", "status": "open"})["count"] == 1
    assert api.ok("GET", "/admin/feedback", params={"kind": "bug"})["feedback"][0]["text"] == "the menu doesn't open"
    assert api.ok("GET", "/admin/feedback", params={"target_type": "match"})["count"] == 0


# The data file


def test_feedback_survives_saving_and_reloading(tmp_path) -> None:
    path = tmp_path / "data.json"
    store = JsonFileStore(path, min_write_interval_seconds=0)
    platform, ann, bob, game = world(store=store)
    made, _ = platform.send_feedback(caller_id=ann, kind="bug", target_type="game", target_id=game,
                                     text="rude title", page="/portal")
    store.close()
    reloaded = read_snapshot(path)
    assert reloaded.feedback == (made,)
    restarted = JsonFileStore(path)
    assert GamePlatform(store=restarted).admin_feedback()["count"] == 1
    restarted.close()


def test_feedback_without_a_kind_is_a_problem(tmp_path) -> None:
    path = tmp_path / "data.json"
    store = JsonFileStore(path, min_write_interval_seconds=0)
    platform, ann, bob, game = world(store=store)
    feedback(platform, ann, "user", bob, text="bad name")
    store.close()
    file = json.loads(path.read_text())
    for row in file["data"]["feedback"]:
        del row["kind"]
    path.write_text(json.dumps(file))
    assert [f.kind for f in read_snapshot(path).feedback] == ["problem"]
