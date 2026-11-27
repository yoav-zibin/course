import csv
import datetime as dt
import io
import json
from dataclasses import replace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from game_platform.api import create_app
from game_platform.models import LinkedAccount, Match, Seat, User
from game_platform.recruitment_history import mark_deleted, mark_merged, record_attribution, record_node
from game_platform.service import GamePlatform
from game_platform.store import InMemoryStore
from game_platform.student_dashboard import CoursePerson, DashboardCache, build_dashboard, parse_roster
from game_platform.tests.fake_firestore import query_store
from game_platform.tests.helpers import login_google_admin


NOW = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
PERSON = CoursePerson("aa1", "Alice Example", "student", "aa1@columbia.edu",
                      "alice@example.test", ("aa1@columbia.edu", "alice@example.test"))


def user(user_id, name="Someone Else", **kwargs):
    return User(id=user_id, display_name=name, password="do-not-expose-account-secret",
                created_at=NOW, updated_at=NOW, **kwargs)


def match(match_id, owner, other=(), *, kind="multiplayer", status="over"):
    seats = (Seat(player_index=0, kind="human", user_id=owner),)
    seats += tuple(Seat(player_index=index + 1, kind="human", user_id=user_id)
                   for index, user_id in enumerate(other))
    if kind == "computer":
        seats += (Seat(player_index=len(seats), kind="computer", user_id=None),)
    return Match(id=match_id, game_id="fixture", game_version=1, owner_user_id=owner,
                 status=status, match_kind=kind, seats=seats, state=None,
                 turn_of_player_indices=None, end_reason=None, moves=(),
                 hidden_for_user_ids=frozenset(), created_at=NOW, updated_at=NOW)


def report(report_id, reporter, score, **kwargs):
    return {"id": report_id, "reporter_user_id": reporter, "text": "Useful fixture report",
            "score": score, "score_rationale": "Reviewed fixture", "status": "handled",
            "resolution": "Fixed", "created_at": NOW.isoformat(), "updated_at": NOW.isoformat(),
            "screenshot": "private-screenshot", "diagnostics": {"secret": "private-evidence"}, **kwargs}


@pytest.mark.parametrize("query", [False, True])
def test_account_aliases_matches_referrals_and_scores_are_deduplicated(query):
    store = query_store() if query else InMemoryStore()
    for account in (
        user("alice", "Unrelated display", email="aa1@columbia.edu", linked_accounts=(
            LinkedAccount(kind="google", identifier="opaque-subject", linked_at=NOW),)),
        user("old-alice", "ALICE old", replaced_by_user_id="alice"),
        user("another", "no name", linked_accounts=(
            LinkedAccount(kind="email", identifier="alice@example.test", linked_at=NOW),)),
        user("not-alice", "Malice Exampleton"),
        user("friend", invited_by_user_id="old-alice"),
        user("friend-alias", replaced_by_user_id="friend"),
        user("grandchild", invited_by_user_id="friend-alias"),
        user("opponent"),
    ):
        store.put_user(account)
    for game in (
        match("computer", "alice", kind="computer"),
        match("pass", "another", kind="pass_and_play"),
        match("shared-own-accounts", "alice", ["another", "friend", "opponent"]),
        match("friend-vs-grandchild", "friend", ["grandchild"]),
        match("same-opponent-alias", "old-alice", ["friend-alias"]),
        match("waiting", "alice", ["opponent"], status="waiting_for_players"),
    ):
        store.put_match(game)
    for row in [report("0", "old-alice", 0), report("1", "alice", 10),
                report("2", "another", None), report("3", "not-alice", 9)]:
        store.create_bug_report(row, rate_keys=[])
    if query:
        store.client.read_paths.clear()
    payload = build_dashboard(store, [PERSON], roster_fetched_at=NOW.isoformat())
    student = payload["students"][0]
    assert {account["id"] for account in student["accounts"]} == {"alice", "old-alice", "another"}
    assert student["canonical_account_count"] == 2
    assert student["matches"] == {"computer": 1, "pass_and_play": 1, "multiplayer": 2,
                                   "total": 4, "waiting": 1,
                                   "by_status": {"waiting_for_players": 1, "ongoing": 0, "over": 4}}
    assert student["other_players"] == 2
    assert (student["direct_recruits"], student["transitive_recruits"]) == (1, 2)
    assert student["recruits_matches"]["total"] == 3
    assert student["reports"]["total"] == 3
    assert student["reports"]["assessed"] == 2
    assert student["reports"]["unassessed"] == 1
    assert student["reports"]["total_score"] == 10
    assert student["reports"]["average_score"] == 5
    assert student["reports"]["top"][0]["score"] == 10
    assert student["reports"]["lowest"][0]["score"] == 0
    encoded = json.dumps(payload)
    for private in ("password", "do-not-expose", "opaque-subject", "private-evidence", "private-screenshot"):
        assert private not in encoded
    if query:
        assert not any("/moves/" in path or "/body/" in path for path in store.client.read_paths)


def test_pagination_reads_all_users_matches_reports_and_never_decompresses_saves():
    store = query_store()
    for index in range(105):
        store.put_user(user(f"u{index:03}", "Alice" if index == 104 else "Else"))
    for index in range(105):
        store.put_match(match(f"m{index:03}", "u104", kind="pass_and_play"))
        store.create_bug_report(report(f"r{index:03}", "u104", 8), rate_keys=[])
    # The metadata reader must not hydrate even a malformed portable save.
    ref = store.ref("matches", "m000")
    raw = store.client.docs[ref.path]
    record = json.loads(raw["json"])
    record["single_player_state_compressed"] = "not-a-valid-compressed-save"
    raw["json"] = json.dumps(record)
    with patch.object(store, "list_users", side_effect=AssertionError("legacy 100-record cap")), \
            patch.object(store, "get_game_version", side_effect=AssertionError("game code hydration")):
        student = build_dashboard(store, [PERSON], roster_fetched_at="now")["students"][0]
    assert student["account_count"] == 1
    assert student["matches"]["pass_and_play"] == 105
    assert student["reports"]["total"] == 105
    assert student["reports"]["total_score"] == 840
    assert student["reports"]["average_score"] == 8
    assert len(student["reports"]["top"]) == 3


@pytest.mark.parametrize("query", [False, True])
@pytest.mark.parametrize("scores,total_score,assessed,average", [
    ([1, 1, 2], 4, 3, 1.33),
    ([0, 10, None, True, False, -1, 11, 1.5, "2"], 10, 2, 5),
    ([None], 0, 0, None),
    ([], 0, 0, None),
])
def test_report_score_sum_is_exact_and_counts_only_valid_assessments(query, scores, total_score,
                                                                  assessed, average):
    store = query_store() if query else InMemoryStore()
    store.put_user(user("alice", "Alice"))
    for index, score in enumerate(scores):
        store.create_bug_report(report(f"r{index}", "alice", score, automatic=index % 2 == 1),
                                rate_keys=[])
    reports = build_dashboard(store, [PERSON], roster_fetched_at="now")["students"][0]["reports"]
    assert reports["total_score"] == total_score
    assert type(reports["total_score"]) is int
    assert reports["total"] == len(scores)
    assert reports["assessed"] == assessed
    assert reports["unassessed"] == len(scores) - assessed
    assert reports["average_score"] == average
    assert reports["automatic"] == len(scores) // 2
    assert reports["manual"] == (len(scores) + 1) // 2


def test_referral_cycles_and_multiple_owned_roots_do_not_count_own_accounts():
    store = InMemoryStore()
    for account in (user("a", "Alice", invited_by_user_id="b"),
                    user("b", "Example", invited_by_user_id="a"),
                    user("c", invited_by_user_id="a"),
                    user("d", invited_by_user_id="c")):
        store.put_user(account)
    student = build_dashboard(store, [PERSON], roster_fetched_at="now")["students"][0]
    assert (student["direct_recruits"], student["transitive_recruits"]) == (1, 2)


@pytest.mark.parametrize("query", [False, True])
def test_historical_recruits_survive_deleted_intermediate_accounts_and_live_reparenting(query):
    store = query_store() if query else InMemoryStore()
    for account in (user("alice", "Alice"), user("friend"), user("grandchild")):
        store.put_user(account)
        record_node(store, account.id, NOW)
    record_attribution(store, "friend", "alice", via_match_id="match-a", at=NOW)
    record_attribution(store, "grandchild", "friend", via_match_id="match-b", at=NOW)
    store.put_match(match("retained", "grandchild", kind="computer"))
    store.put_match(match("removed", "friend", kind="computer"))
    mark_deleted(store, "friend", NOW)
    store.delete_user("friend")
    store.delete_match("removed")
    # Account cleanup nulls or reparents live fields; the original graph remains.
    store.put_user(replace(store.get_user("grandchild"), invited_by_user_id="alice"))
    student = build_dashboard(store, [PERSON], roster_fetched_at="now")["students"][0]
    assert (student["direct_recruits"], student["transitive_recruits"]) == (1, 2)
    assert student["recruits_matches"]["total"] == 1
    assert student["recruits_matches"]["computer"] == 1


@pytest.mark.parametrize("query", [False, True])
def test_historical_merged_inviter_aliases_count_recruits_once_and_exclude_owned_accounts(query):
    store = query_store() if query else InMemoryStore()
    store.put_user(user("alice", "Alice"))
    store.put_user(user("friend"))
    record_node(store, "old-alice", NOW)
    record_attribution(store, "friend", "old-alice", via_match_id="match-a", at=NOW)
    mark_merged(store, "old-alice", "alice", NOW)
    record_node(store, "old-friend", NOW)
    record_attribution(store, "old-friend", "alice", via_match_id="match-b", at=NOW)
    mark_merged(store, "old-friend", "friend", NOW)
    # The student may own another root recorded as recruited before name matching.
    store.put_user(user("own-other", "Example"))
    record_attribution(store, "own-other", "alice", via_match_id="match-c", at=NOW)
    student = build_dashboard(store, [PERSON], roster_fetched_at="now")["students"][0]
    assert (student["direct_recruits"], student["transitive_recruits"]) == (1, 1)


def test_participant_batches_deduplicate_shared_matches_and_keep_private_ownership():
    store = query_store()
    for index in range(31):
        store.put_user(user(f"u{index:03}", "Alice"))
    store.put_user(user("outsider"))
    store.put_match(match("shared", "u000", ["u030", "outsider"]))
    # A computer roster's foreign seat must not confer private ownership, even
    # if a malformed legacy header still calls this a multiplayer match.
    private = match("private", "outsider", ["u000"], kind="computer")
    store.put_match(replace(private, match_kind="multiplayer"))
    student = build_dashboard(store, [PERSON], roster_fetched_at="now")["students"][0]
    assert student["account_count"] == 31
    assert student["matches"]["total"] == 1
    assert student["matches"]["computer"] == 0
    assert student["other_players"] == 1


def test_roster_uses_only_roster_cells_and_preserves_missing_emails():
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Email", "Apple account email", "Full name", "Unrelated column"])
    writer.writerow(["yoav.zibin@example.test", "", "", "private unrelated secret"])
    for index in range(12):
        domain = "barnard.edu" if index == 1 else "columbia.edu"
        writer.writerow([f"student{index}@{domain}", "", f"Surname{index}, First{index}", "private unrelated secret"])
    people = parse_roster(output.getvalue())
    assert len(people) == 13
    assert people[1].name == "First0 Surname0"
    assert people[2].institutional_email == "student1@barnard.edu"
    assert people[1].personal_email is None
    assert "private unrelated secret" not in str(people)
    with pytest.raises(ValueError):
        parse_roster("Email,Full name\nx@y.test,Example\n")


def test_routes_require_master_password_are_private_and_cache_the_snapshot():
    platform = GamePlatform()
    client = TestClient(create_app(platform=platform, master_password="fixture-master"))
    with patch("game_platform.student_dashboard.fetch_roster", return_value=[PERSON]) as fetch:
        assert client.get("/admin/students", follow_redirects=False).status_code == 303
        assert client.get("/admin/students/data").status_code == 401
        fetch.assert_not_called()
        response = client.get("/admin/students/data", auth=("admin", "fixture-master"))
        assert response.status_code == 200
        assert "no-store" in response.headers["cache-control"]
        second = client.get("/admin/students/data", auth=("admin", "fixture-master"))
        assert second.json()["generated_at"] == response.json()["generated_at"]
        fetch.assert_called_once()
        page = client.get("/admin/students", auth=("admin", "fixture-master"), follow_redirects=False)
        assert page.status_code == 303
        assert page.headers["location"] == "/admin/login?next=%2Fadmin%2Fstudents"
        login_google_admin(client)
        assert client.get("/admin/students", follow_redirects=False).status_code == 200
    assert TestClient(create_app()).get("/admin/students/data").status_code == 503
    disabled = TestClient(create_app(debug_tools=False, master_password="fixture-master"))
    assert disabled.get("/admin/students", auth=("admin", "fixture-master")).status_code == 404
    assert disabled.get("/admin/students/data", auth=("admin", "fixture-master")).status_code == 404


def test_roster_failure_returns_explicit_error_without_partial_totals():
    client = TestClient(create_app(master_password="fixture-master"))
    with patch("game_platform.student_dashboard.fetch_roster", side_effect=OSError("private response body")):
        response = client.get("/admin/students/data", auth=("", "fixture-master"))
    assert response.status_code == 503
    assert "students" not in response.json()
    assert "private response body" not in response.text


def test_activity_cache_expires_before_roster_cache_and_retries_failed_roster_refresh():
    from fastapi import HTTPException

    store = InMemoryStore()
    cache = DashboardCache()
    with patch("game_platform.student_dashboard.time.monotonic", return_value=10) as clock, \
            patch("game_platform.student_dashboard.fetch_roster", return_value=[PERSON]) as fetch:
        assert cache.get(store)["students"][0]["account_count"] == 0
        store.put_user(user("new", "Alice"))
        clock.return_value = 30
        assert cache.get(store)["students"][0]["account_count"] == 0
        clock.return_value = 71
        assert cache.get(store)["students"][0]["account_count"] == 1
        fetch.assert_called_once()
        clock.return_value = 3700
        fetch.side_effect = OSError("private failed response")
        with pytest.raises(HTTPException) as failure:
            cache.get(store)
        assert failure.value.status_code == 503
        # A failed refresh does not mark the old roster fresh or conceal the
        # failure behind a success response. The next request retries it.
        fetch.side_effect = None
        assert cache.get(store)["students"][0]["account_count"] == 1
        assert fetch.call_count == 3


def test_ambiguous_name_accounts_are_visible_and_explained():
    store = InMemoryStore()
    store.put_user(user("shared", "Alice Jones"))
    other = replace(PERSON, id="other", name="Alice Jones", emails=())
    payload = build_dashboard(store, [PERSON, other], roster_fetched_at="now")
    assert [student["account_count"] for student in payload["students"]] == [1, 1]
    assert len(payload["notes"]) == 1
