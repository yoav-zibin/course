"""Real Firestore emulator tests; never connect to a production database."""

import os
import uuid
from dataclasses import replace
from unittest.mock import patch

import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("FIRESTORE_EMULATOR_HOST"), reason="requires Firestore emulator"
)

from google.cloud import firestore
from game_platform.query_store import QueryStore
from game_platform.service import ConflictError
from game_platform.tests.helpers import Api
from game_platform.scaling_service import ScalablePlatform


def api_for(store):
    api = Api(store=store)
    api.client.app.state.platform = ScalablePlatform(
        store=store, computer_move_delay_seconds=0
    )
    return api


def test_legacy_catalog_and_popularity_use_metadata_without_transactions_or_code_reads(store):
    api = api_for(store)
    owner = api.new_user('catalog reader')
    game_id = api.new_game(owner=owner)
    store.clear_cache()
    with patch.object(store.client, 'transaction', side_effect=AssertionError('read opened transaction')):
        with patch.object(store, '_read_doc', wraps=store._read_doc) as reads:
            rows = api.ok('GET', '/games')
            assert [row['id'] for row in rows] == [game_id]
            assert 'code' not in rows[0] and 'server_code' not in rows[0]
            assert api.ok('GET', f'/games/{game_id}/popularity')['score'] == 0
            assert all('/body/' not in call.args[0].path for call in reads.call_args_list)


def test_admin_match_browse_primes_code_in_batches_and_keeps_spectator_projection(store):
    api = api_for(store)
    alice, bob = api.new_user('alice'), api.new_user('bob')
    game_id = api.new_game(owner=alice)
    match_id = api.new_match(owner=alice, game_id=game_id, joiners=[bob], start=True)
    store.clear_cache()
    with patch.object(store, 'prefetch_game_versions', wraps=store.prefetch_game_versions) as prefetch:
        platform = api.client.app.state.platform
        with patch.object(platform, 'view_state', wraps=platform.view_state) as view:
            page = api.ok('GET', '/v2/admin/matches')
    assert [row['id'] for row in page['items']] == [match_id]
    prefetch.assert_called_once()
    assert view.call_count == 1
    assert view.call_args.args[1] is None  # Admin rows retain the ordinary spectator view.


@pytest.fixture
def store():
    assert os.environ["FIRESTORE_EMULATOR_HOST"].startswith(
        ("127.0.0.1:", "localhost:")
    )
    return QueryStore.initialize(
        firestore.Client(project="demo-game-platform"),
        namespace="query_" + uuid.uuid4().hex,
    )


def test_cover_reads_only_metadata_and_warm_reads_use_cache(store):
    from game_platform.tests.test_game_covers import create_cover

    api = api_for(store)
    _, game_id, url = create_cover(api)
    store.clear_cache()
    with patch.object(store, "_read_doc", wraps=store._read_doc) as read:
        with patch.object(store.client, "transaction", side_effect=AssertionError("cover opened a transaction")):
            first = api.request("GET", url)
            assert first.status_code == 200
            assert first.headers["cache-control"] == "public, max-age=3600"
            assert [call.args[0].path for call in read.call_args_list] == [
                store.ref("game_versions", f"{game_id}@1").path, store.ref("games", game_id).path]
            read.reset_mock()
            assert api.request("GET", url).status_code == 200
            assert read.call_count == 0


@pytest.mark.parametrize("with_handler", [True, False])
def test_leave_payout_contract_is_atomic_and_survives_restart(store, with_handler):
    from game_platform.tests.test_leave_result_contract import test_leave_uses_game_distribution_and_pays_exactly_once
    api = api_for(store)
    if with_handler:
        test_leave_uses_game_distribution_and_pays_exactly_once(api)
    else:
        from game_platform.tests.test_server_leaving import test_maybe_leave_previews_the_equal_split_without_player_left
        test_maybe_leave_previews_the_equal_split_without_player_left(api)
    second = QueryStore(store.client, namespace=store.namespace)
    records = list(store._query("matches", [], limit=10))
    assert len(records) == 1
    match = store._decode("matches", records[0].to_dict(), records[0].reference)
    saved = second.get_match(match.id)
    assert saved.status == "over" and saved.token_pot == 0
    assert saved.seats[1].active is False
    assert sum(saved.token_payouts.values()) == 20
    assert saved.moves[-1].move == {"type": "player_left"}


def test_query_multiplayer_rejects_computers(store):
    from game_platform.tests.test_leave_result_contract import test_bots_cannot_be_added_to_multiplayer_or_joined_via_invite
    test_bots_cannot_be_added_to_multiplayer_or_joined_via_invite(api_for(store))


def test_query_legacy_roster_refund_is_idempotent(store):
    from game_platform.tests.test_leave_result_contract import test_legacy_mixed_match_ends_and_refunds_once
    test_legacy_mixed_match_ends_and_refunds_once(api_for(store))


def test_restart_and_second_instance_read_committed_move_without_loading_history(store):
    from game_platform.schemas import MatchOut

    api = api_for(store)
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game = api.new_game(owner=alice)
    match = api.new_match(owner=alice, game_id=game, joiners=[bob], start=True)
    assert (
        api.move(
            match, as_user=alice, next_turn=1, state={"board": [[1, 2], [3, 4]]}
        ).status_code
        == 201
    )
    second = QueryStore(store.client, namespace=store.namespace)
    with patch.object(
        second, "_read_moves", side_effect=AssertionError("must not read history")
    ):
        record = second.get_match(match)
        assert len(record.moves) == 1
        assert record.state == {"board": [[1, 2], [3, 4]]}
        assert MatchOut.of(record).last_move_player_index == 0
    assert second.get_match(match).moves[0].new_state == record.state


def test_recent_experiment_variant_deletion_is_atomic_when_legacy_limit_is_exceeded(
    store,
):
    import datetime as dt
    from game_platform.models import ExperimentAssignment

    api = api_for(store)
    platform = api.client.app.state.platform
    platform.list_experiments()
    before = store._get("experiments", "ui-skins")
    variant = before.variants[0]
    for index in range(101):
        store.put_experiment_assignment(
            ExperimentAssignment(
                user_id=f"variant-limit-{index}",
                experiment_id=before.id,
                variant_id=variant.id,
                assigned_at=dt.datetime.now(dt.timezone.utc),
            )
        )
    response = api.request(
        "DELETE", f"/admin/experiments/{before.id}/variants/{variant.id}"
    )
    assert response.status_code == 409
    assert store._get("experiments", before.id) == before
    assert store.get_experiment_assignment(
        user_id="variant-limit-0", experiment_id=before.id
    )


def test_history_page_uses_one_batch_and_preserves_move_order(store):
    from game_platform.scaling_tools import seed

    seed(
        store,
        run_id="batch-history",
        users=1,
        games=1,
        matches=1,
        moves_per_match=5,
        max_writes=1000,
    )
    # Measure with a cold store (empty read cache): seeding wrote the moves
    # through the seeding store's own cache, which would serve them itself.
    cold = QueryStore(store.client, namespace=store.namespace)
    match = cold.get_match("synthetic-batch-history-match-0")
    with patch.object(store.client, "get_all", wraps=store.client.get_all) as batch:
        assert [move.move_number for move in match.moves[:5]] == [1, 2, 3, 4, 5]
        assert batch.call_count == 1
        # A repeat read is served by the read cache: still one batch total.
        assert [move.move_number for move in match.moves[:5]] == [1, 2, 3, 4, 5]
        assert batch.call_count == 1


def test_operation_rolls_back_all_writes(store):
    api = api_for(store)
    alice = api.new_user("alice")
    original = store.get_user(alice)
    with pytest.raises(RuntimeError):
        with store.atomic():
            store.put_user(replace(original, token_balance=123))
            store.raw_put(store.ref("jobs", "test"), {"due": True})
            raise RuntimeError("failed move")
    assert store.get_user(alice) == original
    assert store.raw_get(store.ref("jobs", "test")) is None


def test_cursor_pages_are_complete_and_bound_to_query(store):
    api = api_for(store)
    ids = {api.new_user(str(i)) for i in range(7)}
    first = store.page("users", limit=3, scope="admin")
    second = store.page("users", limit=3, cursor=first.next_cursor, scope="admin")
    third = store.page("users", limit=3, cursor=second.next_cursor, scope="admin")
    assert {u.id for u in first.items + second.items + third.items} == ids
    assert third.next_cursor is None
    with pytest.raises(ValueError):
        store.page("users", cursor=first.next_cursor, scope="someone-else")


def test_referred_users_paginate_and_bind_cursor_to_caller(store):
    api = api_for(store)
    owner = api.new_user("owner")
    other = api.new_user("other")
    invited = [api.new_user(f"invited {i}") for i in range(3)]
    for uid in invited:
        store.put_user(replace(store.get_user(uid), invited_by_user_id=owner))
    path = "/v2/users/me/referred-users?limit=2"
    first = api.ok("GET", path, as_user=owner)
    second = api.ok("GET", path, as_user=owner, params={"cursor": first["next_cursor"]})
    assert {u["id"] for u in first["items"] + second["items"]} == set(invited)
    assert second["next_cursor"] is None
    assert (
        api.request(
            "GET", path, as_user=other, params={"cursor": first["next_cursor"]}
        ).status_code
        == 400
    )
    assert all("password" not in user for user in first["items"])


def test_invite_pages_are_scoped_to_creator(store):
    import datetime as dt
    from game_platform.models import Invite

    api = api_for(store)
    owner, other = api.new_user("owner"), api.new_user("other")
    now = dt.datetime.now(dt.timezone.utc)
    for i in range(3):
        store.put_invite(
            Invite(
                token=f"owner-invite-{i}",
                match_id="match",
                created_by_user_id=owner,
                created_at=now,
            )
        )
    store.put_invite(
        Invite(
            token="other-invite",
            match_id="match",
            created_by_user_id=other,
            created_at=now,
        )
    )
    path = "/v2/users/me/invites?limit=2"
    first = api.ok("GET", path, as_user=owner)
    second = api.ok("GET", path, as_user=owner, params={"cursor": first["next_cursor"]})
    assert {x["token"] for x in first["items"] + second["items"]} == {
        f"owner-invite-{i}" for i in range(3)
    }
    assert (
        api.request(
            "GET", path, as_user=other, params={"cursor": first["next_cursor"]}
        ).status_code
        == 400
    )


def test_referrals_and_linked_identity_survive_restart(store):
    api = api_for(store)
    alice = api.new_user("alice")
    user = store.get_user(alice)
    assert len(user.referral_code) == 16
    second = QueryStore(store.client, namespace=store.namespace)
    assert second.user_for_referral(user.referral_code) == alice


def test_list_matches_for_game_returns_only_that_games_matches(store):
    api = api_for(store)
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice)
    first = api.new_match(owner=alice, game_id=game_id)
    second_match = api.new_match(owner=alice, game_id=game_id, joiners=[bob], start=True)
    other_game = api.new_game(owner=bob)
    api.new_match(owner=bob, game_id=other_game)

    assert [m.id for m in store.list_matches_for_game(game_id)] == [
        first,
        second_match,
    ]
    assert store.list_matches_for_game("no-such-game") == []


def test_idempotent_move_does_not_append_or_pay_twice(store):
    api = api_for(store)
    alice, bob = api.new_user("alice"), api.new_user("bob")
    match = api.new_match(
        owner=alice, game_id=api.new_game(owner=alice), joiners=[bob], start=True
    )
    platform = api.client.app.state.platform
    args = dict(
        caller_id=alice,
        match_id=match,
        move={"state": {"n": 1}, "turn_indices": [1]},
        expected_move_count=0,
        request_id="first",
    )
    first = platform.make_move(**args)
    again = platform.make_move(**args)
    assert len(first.moves) == len(again.moves) == 1
    with pytest.raises(ConflictError):
        platform.make_move(**{**args, "move": {"state": {"n": 2}, "turn_indices": [1]}})
    assert store.counts()["moves_total"] == 1


def test_paginated_http_api_does_not_return_source_or_other_users_matches(store):
    api = api_for(store)
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game = api.new_game(owner=alice)
    api.new_match(owner=alice, game_id=game)
    result = api.ok("GET", "/v2/games")
    assert len(result["items"]) == 1
    assert "code" not in result["items"][0]
    assert api.ok("GET", "/v2/matches", as_user=bob)["items"] == []
    assert len(api.ok("GET", "/v2/matches", as_user=alice)["items"]) == 1


def test_verification_attempts_persist_and_second_instance_can_finish_login(store):
    first = ScalablePlatform(store=store)
    identity, code, _ = first.start_verification(
        kind="email", identifier="test@example.com"
    )
    from game_platform.service import InvalidRequestError

    with pytest.raises(InvalidRequestError):
        first.verify_code(verification_id=identity, code="wrong")
    assert store.raw_get(store.ref("verifications", identity))["attempts"] == 1
    second = ScalablePlatform(store=QueryStore(store.client, namespace=store.namespace))
    api = api_for(second._store)
    response = api.client.post("/auth/email/verify", json={"verification_id": identity, "code": code},
                               headers={"X-Campaign-Code": "students-a"})
    assert response.status_code == 200, response.text
    user = second._store.get_user(response.json()["user_id"])
    assert user.linked_accounts[0].identifier == "test@example.com"
    # The second instance deleted the record; this store's read cache may
    # serve its copy for up to a refresh window (~1s), then it converges.
    import time

    deadline = time.monotonic() + 5
    while store.raw_get(store.ref("verifications", identity)) is not None:
        assert time.monotonic() < deadline
        time.sleep(0.05)


@pytest.mark.parametrize("provider", ["email", "google"])
def test_http_signup_preserves_match_invites_in_firestore(store, provider, monkeypatch):
    from game_platform.tests.test_auth_match_invites import signup_api, assert_invited_signup

    api, sender = signup_api(store)
    assert_invited_signup(api, sender, provider, monkeypatch)


def test_external_phone_http_verification_uses_firestore_challenges(store):
    from game_platform.tests.test_auth_match_invites import assert_external_phone_signup

    assert_external_phone_signup(store)


def test_two_instances_can_claim_a_game_proposal_only_once(store):
    from concurrent.futures import ThreadPoolExecutor
    import threading

    from game_platform import game_proposals as gp

    proposal = gp.create_proposal(
        store, game_name="Azul", description="", rules_url="", proposer_name=""
    )
    barrier = threading.Barrier(2)

    def claim(_):
        other = QueryStore(store.client, namespace=store.namespace)
        try:
            # Both processes have already observed the shared queue entry.
            assert other.raw_get(other.ref(gp.PROPOSAL_KIND, proposal["id"]))
            barrier.wait(timeout=5)
            try:
                return "claimed" if gp.delete_proposal(other, proposal["id"]) else "unavailable"
            except ConflictError:
                return "conflict"
        finally:
            other.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(claim, range(2)))
    assert results.count("claimed") <= 1, results
    assert all(result in ("claimed", "unavailable", "conflict") for result in results)
    if "claimed" not in results:
        # Firestore may abort both contending read-then-delete transactions.
        # The claim API permits 409s: neither agent owns the proposal until
        # a retry commits. An unclaimed proposal must remain available.
        assert results == ["conflict", "conflict"], results
        assert gp.delete_proposal(store, proposal["id"]) is True
    # The creator still has its cached copy; even that retry must lose.
    assert gp.delete_proposal(store, proposal["id"]) is False


def test_two_instances_racing_a_move_commit_only_once(store):
    from concurrent.futures import ThreadPoolExecutor
    import threading

    api = api_for(store)
    alice, bob = api.new_user("alice"), api.new_user("bob")
    match = api.new_match(
        owner=alice, game_id=api.new_game(owner=alice), joiners=[bob], start=True
    )
    barrier = threading.Barrier(2)
    conflicts = []

    def attempt(n):
        other = QueryStore(store.client, namespace=store.namespace)
        platform = ScalablePlatform(store=other)
        barrier.wait(timeout=5)
        try:
            platform.make_move(
                caller_id=alice,
                match_id=match,
                move={"state": {"winner": n}, "turn_indices": [1]},
                expected_move_count=0,
                request_id=str(n),
            )
            return "committed"
        except ConflictError as error:
            conflicts.append((str(error), repr(error.__cause__)))
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, [1, 2]))
    assert sorted(results) == ["committed", "conflict"], conflicts
    # The winning instance committed the move; this store's cached copy of
    # the match converges within a refresh window (~1s).
    import time

    deadline = time.monotonic() + 5
    while len(store.get_match(match).moves) != 1:
        assert time.monotonic() < deadline
        time.sleep(0.05)
    assert store.counts()["moves_total"] == 1


def test_quickjs_computer_turn_survives_restart_and_duplicate_job(store):
    from pathlib import Path
    import datetime as dt

    api = api_for(store)
    owner = api.new_user("owner")
    source = (Path(__file__).parent.parent / "games" / "tictactoe.server.js").read_text(
        encoding="utf-8"
    )
    game = api.create_game(
        {
            "name": "Tic tac toe",
            "code": "<div></div>",
            "server_code": source,
            "allowed_player_counts": [2],
        },
        owner,
    )
    match = api.ok(
        "POST",
        "/matches",
        as_user=owner,
        json={"game_id": game["id"], "num_computer_opponents": 1},
    )
    api.ok("POST", f"/matches/{match['id']}/start", as_user=owner, json={})
    api.ok(
        "POST",
        f"/matches/{match['id']}/moves",
        as_user=owner,
        json={"move": {"cell": 0}, "expected_move_count": 0},
    )
    ref = store.ref("jobs", match["id"])
    row = store.raw_get(ref)
    assert row is not None
    # Make the scheduled turn due without a timing-dependent sleep.
    store.raw_put(
        ref,
        {**row, "due_at": dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1)},
    )
    restarted = ScalablePlatform(
        store=QueryStore(store.client, namespace=store.namespace)
    )
    restarted.run_due_jobs()
    # The restarted instance committed the computer's move; this store's
    # cached copy of the match converges within a refresh window (~1s).
    import time

    deadline = time.monotonic() + 5
    after = store.get_match(match["id"])
    while len(after.moves) != 2:
        assert time.monotonic() < deadline
        time.sleep(0.05)
        after = store.get_match(match["id"])
    assert after.state["board"][0] == "X"
    restarted.run_due_jobs()
    assert len(store.get_match(match["id"]).moves) == 2


@pytest.mark.parametrize("finish_at", [5, 10])
def test_one_durable_job_advances_consecutive_computers_and_stops_at_a_human_or_game_over(store, finish_at):
    import datetime as dt

    from game_platform.tests.test_server_matches import COUNTER_GAME

    api = api_for(store)
    owner = api.new_user("local chain owner")
    game = api.create_game({
        "name": "Local computer chain", "code": "<div>counter</div>",
        "server_code": COUNTER_GAME.replace("count >= 10", f"count >= {finish_at}")
            .replace("{[playerId]: ctx.pot}", "{[ctx.players[0].id]: ctx.pot}"),
        "allowed_player_counts": [4],
    }, owner)
    match = api.ok("POST", "/matches", as_user=owner,
                   json={"game_id": game["id"], "num_computer_opponents": 3})
    api.ok("POST", f"/matches/{match['id']}/start", as_user=owner, json={})
    api.ok("POST", f"/matches/{match['id']}/moves", as_user=owner,
           json={"move": {"add": 3}, "expected_move_count": 0})
    job_ref = store.ref("jobs", match["id"])
    job = store.raw_get(job_ref)
    store.raw_put(job_ref, {**job, "due_at": dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1)})
    platform = api.client.app.state.platform
    with patch.object(platform, "_run_computer_moves", wraps=platform._run_computer_moves) as run:
        platform.run_due_jobs()
    run.assert_called_once_with(match["id"])
    fresh = QueryStore(store.client, namespace=store.namespace)
    saved = fresh.get_match(match["id"])
    terminal = finish_at == 5
    assert saved.state["count"] == (5 if terminal else 6)
    assert len(saved.moves) == (3 if terminal else 4)
    assert saved.status == ("over" if terminal else "ongoing")
    assert saved.turn_of_player_indices == (None if terminal else frozenset({0}))
    assert fresh.raw_get(job_ref) is None
    platform.run_due_jobs()
    assert len(fresh.get_match(match["id"]).moves) == len(saved.moves)


def test_speed_match_deadline_job_ends_the_match_without_a_read(store):
    """A speed match's turn deadline is a durable job: when it comes due, the
    worker ends the match on its own — no read or move has to happen — and
    the pot goes to the player who was left waiting."""
    import datetime as dt

    class ManualClock:
        def __init__(self) -> None:
            self.now = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)

        def __call__(self) -> dt.datetime:
            return self.now

    clock = ManualClock()
    api = Api(store=store)
    api.client.app.state.platform = ScalablePlatform(
        store=store, computer_move_delay_seconds=0, clock=clock
    )
    alice = api.new_user("alice")
    bob = api.new_user("bob")
    game_id = api.new_game(owner=alice, allowed_player_counts=(2,))
    match = api.ok(
        "POST",
        "/matches",
        as_user=alice,
        json={"game_id": game_id, "bet_per_player": 2, "turn_seconds": 60},
    )
    api.ok("POST", f"/matches/{match['id']}/join", as_user=bob)
    api.ok("POST", f"/matches/{match['id']}/start", as_user=alice, json={})

    # Starting the match armed one durable job, due at the turn deadline.
    ref = store.ref("jobs", match["id"])
    job = store.raw_get(ref)
    assert job is not None
    started = store.get_match(match["id"])
    assert started.turn_deadline is not None
    assert job["due_at"] == started.turn_deadline

    # The deadline passes with nobody reading or moving in the match; a
    # fresh platform instance (a restarted server) runs the due jobs.
    clock.now += dt.timedelta(seconds=61)
    restarted = ScalablePlatform(
        store=QueryStore(store.client, namespace=store.namespace),
        computer_move_delay_seconds=0,
        clock=clock,
    )
    restarted.run_due_jobs()

    # Another process wrote the result. Read a fresh transaction rather than
    # this store's intentionally stale-while-revalidate non-transactional cache.
    with store.atomic():
        saved = store.get_match(match["id"])
        pending_job = store.raw_get(ref)
    assert (saved.status, saved.end_reason) == ("over", "timed_out")
    assert [t.user_id for t in saved.timeouts] == [alice]
    # Alice held the turn, so the whole 4-token pot went to Bob.
    assert saved.token_pot == 0
    assert sorted(saved.token_payouts.values()) == [4]
    assert pending_job is None


def test_seed_resume_is_idempotent_and_budget_is_checked_before_writes(store):
    from game_platform.scaling_tools import seed

    with pytest.raises(ValueError):
        seed(
            store,
            run_id="budget",
            users=2,
            games=1,
            matches=5,
            moves_per_match=3,
            max_writes=1,
        )
    assert store.counts() == {}
    args = dict(
        run_id="tiny", users=2, games=1, matches=5, moves_per_match=3, max_writes=1000
    )
    seed(store, **args)
    counts = store.counts()
    assert counts["matches_total"] == 5 and counts["moves_total"] == 15
    seed(store, **args)
    assert store.counts() == counts


def test_seed_resume_does_not_reset_existing_user(store):
    from game_platform.scaling_tools import seed

    args = dict(
        run_id="resume-user",
        users=2,
        games=1,
        matches=0,
        moves_per_match=0,
        max_writes=1000,
    )
    seed(store, **args)
    user = store.get_user("synthetic-resume-user-user-1")
    store.put_user(replace(user, token_balance=17))
    # Simulate an older checkpoint left behind after this user was written.
    manifest = store.ref("seed_runs", "resume-user")
    saved = store.raw_get(manifest)
    store.raw_put(manifest, {**saved, "users_done": 1, "complete": False})
    seed(store, **args)
    assert store.get_user(user.id).token_balance == 17


def test_quick_match_uses_bounded_queries_and_reserves_same_player_slot(store):
    api = api_for(store)
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game = api.new_game(owner=alice)
    platform = api.client.app.state.platform
    with patch.object(
        store, "list_all_matches", side_effect=AssertionError("global scan")
    ):
        first = platform.quick_match(caller_id=alice, game_id=game)
        assert platform.quick_match(caller_id=alice, game_id=game).id == first.id
        joined = platform.quick_match(caller_id=bob, game_id=game)
        assert joined.id == first.id and joined.status == "ongoing"


def test_payout_ledger_and_lost_response_retry_are_atomic(store):
    from game_platform.tests.test_server_matches import _create_game, _start, _move

    api = api_for(store)
    alice, bob = api.new_user("alice"), api.new_user("bob")
    match = _start(api, alice, _create_game(api, alice), joiner=bob, max_loss=10)
    for user, add in [(alice, 3), (bob, 3), (alice, 1), (bob, 1)]:
        assert _move(api, match, as_user=user, add=add).status_code == 201
    platform = api.client.app.state.platform
    args = dict(
        caller_id=alice,
        match_id=match,
        move={"add": 2},
        expected_move_count=4,
        request_id="winning-move",
    )
    platform.make_move(**args)
    platform.make_move(**args)
    assert store.get_user(alice).token_balance == 20
    assert store.get_user(bob).token_balance == 0
    ledger = [doc.to_dict() for doc in store.collection("token_ledger").stream()]
    assert sum(row["amount"] for row in ledger if row["user_id"] == alice) == 20
    assert len(store.get_match(match).moves) == 5


def test_private_history_is_view_filtered_and_v1_routes_serve_the_same_match(store):
    from game_platform.tests.test_server_matches import _create_game, _start, _move

    api = api_for(store)
    alice, bob = api.new_user("alice"), api.new_user("bob")
    match = _start(api, alice, _create_game(api, alice), joiner=bob)
    assert _move(api, match, as_user=alice, add=1).status_code == 201
    history = api.ok("GET", f"/v2/matches/{match}/history?limit=1", as_user=bob)
    assert history["items"][0]["new_state"] == {
        "count": 1,
        "your_secret": "secret-of-" + bob,
    }
    assert "secrets" not in history["initial_state"]
    # The plain routes serve the same one-match history (moves are read
    # in bounded chunks behind the lazy history), view-filtered the same
    # way: Bob's new_state below is his view, never the full state.
    moves = api.ok("GET", f"/matches/{match}/moves", as_user=bob)
    assert [move["new_state"]["count"] for move in moves] == [1]
    full = api.ok("GET", f"/matches/{match}/history", as_user=bob)
    assert [move["new_state"]["count"] for move in full["moves"]] == [1]


def test_export_resume_validation_and_cleanup_are_bounded(store, tmp_path):
    from game_platform.scaling_tools import seed
    from game_platform.scaling_maintenance import (
        export_namespace,
        validate_matches,
        cleanup,
    )

    seed(
        store,
        run_id="maintenance",
        users=2,
        games=1,
        matches=3,
        moves_per_match=2,
        max_writes=1000,
    )
    result = validate_matches(store, limit=2)
    assert result["matches"] == 2 and result["moves"] == 4 and result["next_cursor"]
    assert (
        validate_matches(store, limit=2, cursor=result["next_cursor"])["matches"] == 1
    )
    exported = export_namespace(store, tmp_path)
    assert exported == export_namespace(store, tmp_path)
    match = store.page("matches", limit=1).items[0]
    store.delete_match(match.id)
    assert store.get_match(match.id) is None
    cleanup(store, limit=1)
    cleanup(store, limit=1)
    assert list(store.ref("matches", match.id).collection("moves").stream()) == []
    assert store.counts()["matches_total"] == 2


def test_outbox_rollback_does_not_deliver_notifications(store):
    from game_platform.scaling_service import OutboxNotifier
    from game_platform.push import PushMessage
    from game_platform.models import WebPushSubscription
    import datetime as dt
    from unittest.mock import Mock

    target = Mock()
    notifier = OutboxNotifier(store, target)
    now = dt.datetime.now(dt.timezone.utc)
    subscription = WebPushSubscription(
        id="sub",
        user_id="user",
        endpoint="https://example.invalid/push",
        p256dh="public",
        auth="auth",
        created_at=now,
        updated_at=now,
    )
    message = PushMessage(
        subscription=subscription,
        title="Your turn",
        body="Play",
        url="/portal",
        tag="match",
    )
    # The store buffers outbox records exactly like the state change.
    with pytest.raises(RuntimeError):
        with store.atomic():
            notifier.enqueue([message])
            raise RuntimeError("failed game update")
    assert list(store.collection("outbox").stream()) == []
    target.enqueue.assert_not_called()
    platform = ScalablePlatform(store=store, push_notifier=target)
    notifier.enqueue([message])
    platform.run_outbox()
    platform.run_outbox()
    target.deliver.assert_called_once_with(message)
    assert list(store.collection("outbox").stream()) == []


def test_export_does_not_include_an_overlapping_namespace(store, tmp_path):
    from game_platform.scaling_maintenance import export_namespace

    other = QueryStore.initialize(store.client, namespace=store.namespace + "_team")
    other.raw_put(other.ref("users", "private"), {"secret": "must-not-export"})
    export_namespace(store, tmp_path)
    assert not any(
        "must-not-export" in path.read_text(encoding="utf-8")
        for path in tmp_path.glob("*.jsonl")
    )


def test_completed_export_detects_same_size_corruption(store, tmp_path):
    from game_platform.scaling_maintenance import export_namespace

    api_for(store).new_user("export user")
    export_namespace(store, tmp_path)
    path = tmp_path / (store.namespace + "_users.jsonl")
    data = path.read_bytes()
    assert data
    path.write_bytes(bytes([data[0] ^ 1]) + data[1:])
    with pytest.raises(ValueError, match="checksum"):
        export_namespace(store, tmp_path)


def test_dashboard_rebuild_resumes_and_publishes_only_complete_report(store):
    from game_platform.scaling_dashboard import rebuild, current
    from game_platform.scaling_tools import seed

    seed(
        store,
        run_id="dashboard",
        users=2,
        games=1,
        matches=3,
        moves_per_match=2,
        max_writes=1000,
    )
    with patch.object(store, "_read_moves", side_effect=AssertionError("history scan")):
        result = rebuild(store, run_id="first", max_records=2)
        assert not result["complete"] and current(store) is None
        for _ in range(10):
            result = rebuild(store, run_id="first", max_records=2)
            assert result["processed"] <= 2
            if result["complete"]:
                break
        assert result["complete"]
        snapshot = current(store)
        assert snapshot["counts"]["users"] == 2
        assert snapshot["counts"]["matches"] == 3
        assert snapshot["counts"]["moves"] == 6
        assert rebuild(store, run_id="first", max_records=2)["processed"] == 0
        rebuild(store, run_id="second", max_records=1)
        assert current(store) == snapshot


def test_historical_activity_runs_quickjs_and_resumes_without_duplicates(store):
    from game_platform.scaling_activity import generate

    args = dict(run_id="played", users=8, games=2, matches=20, max_writes=20000)
    result = generate(store, **args)
    assert result["complete"]
    counts = store.counts()
    assert counts["matches_total"] == 20 and counts["moves_total"] > 0
    assert counts["matches_over"] > 0
    generate(store, **args)
    assert store.counts() == counts
    page = store.page("matches", limit=100)
    assert all(match.created_at.month == 9 for match in page.items)
    for match in page.items:
        if match.moves:
            assert all(move.move is not None for move in match.moves)
            assert match.moves[-1].new_state == match.state


def test_dashboard_historical_window_keeps_anchor_on_resume(store):
    import datetime as dt
    from game_platform.scaling_dashboard import rebuild, current

    api = api_for(store)
    uid = api.new_user("historical")
    store.put_user(
        replace(
            store.get_user(uid),
            created_at=dt.datetime(2026, 9, 15, tzinfo=dt.timezone.utc),
        )
    )
    assert not rebuild(store, run_id="september", max_records=1, as_of="2026-09-30")[
        "complete"
    ]
    with pytest.raises(ValueError, match="date changed"):
        rebuild(store, run_id="september", as_of="2026-10-01")
    assert rebuild(store, run_id="september", as_of="2026-09-30")["complete"]
    assert current(store)["anchor"] == "2026-09-30"
    assert current(store)["days"]["2026-09-15"]["users"] == 1


def _run_until_complete(fn, **kwargs):
    result = None
    for _ in range(1000):
        result = fn(**kwargs)
        if result.get("complete") or result.get("failed"):
            return result
    raise AssertionError(f"job did not finish: {result}")


def test_merge_job_resumes_and_rewrites_everything(store):
    import datetime as dt

    from game_platform.models import LinkedAccount
    from game_platform.scaling_accounts import merge_users

    api = api_for(store)
    alice, bob, carol = (
        api.new_user("alice"),
        api.new_user("bob"),
        api.new_user("carol"),
    )
    game = api.new_game(owner=alice)
    match = api.new_match(owner=alice, game_id=game, joiners=[carol], start=True)
    assert (
        api.move(match, as_user=alice, next_turn=1, state={"pot": 1}).status_code == 201
    )
    source = store.get_user(alice)
    store.put_user(replace(store.get_user(bob), token_balance=11))
    store.put_user(
        replace(
            source,
            token_balance=17,
            invited_by_user_id=carol,
            linked_accounts=(
                LinkedAccount(
                    kind="email",
                    identifier="alice@example.com",
                    linked_at=dt.datetime.now(dt.timezone.utc),
                ),
            ),
        )
    )
    calls = 0
    result = None
    for _ in range(1000):
        calls += 1
        result = merge_users(
            store, run_id="merge-1", source_id=alice, into_id=bob, max_records=1
        )
        if result["complete"]:
            break
    assert result and result["complete"] and calls > 1  # resumable, not one shot
    assert store.get_game(game).owner_user_id == bob
    merged = store.get_match(match)
    seat = merged.seat_of(bob)
    assert seat is not None and seat.logic_player_id == alice
    assert merged.seat_of(alice) is None and merged.owner_user_id == bob
    assert [move.made_by_user_id for move in merged.moves] == [bob]
    assert store.get_user(alice).replaced_by_user_id == bob
    assert store.get_user(alice).linked_accounts == ()
    survivor = store.get_user(bob)
    assert survivor.token_balance == 28
    assert store.get_user(alice).token_balance == 0
    assert [a.identifier for a in survivor.linked_accounts] == ["alice@example.com"]
    assert survivor.invited_by_user_id == carol
    assert store.find_linked_account("email", "alice@example.com").id == bob
    # A completed job is a no-op when re-run.
    assert merge_users(store, run_id="merge-1", max_records=1)["processed"] == 0


def test_online_merge_preserves_signin_balances_library_and_logic_ids_without_global_scans(
    store,
):
    import datetime as dt
    from game_platform.models import LinkedAccount

    api = api_for(store)
    alice, bob, carol = (api.new_user(x) for x in ("alice", "bob", "carol"))
    game = api.new_game(owner=alice)
    match = api.new_match(owner=alice, game_id=game, joiners=[carol], start=True)
    assert (
        api.move(match, as_user=alice, next_turn=1, state={"turn": 1}).status_code
        == 201
    )
    now = dt.datetime.now(dt.timezone.utc)
    store.put_user(
        replace(
            store.get_user(alice),
            token_balance=17,
            linked_accounts=(
                LinkedAccount(
                    kind="email", identifier="alice@example.com", linked_at=now
                ),
            ),
        )
    )
    store.put_user(
        replace(
            store.get_user(bob),
            token_balance=11,
            linked_accounts=(
                LinkedAccount(kind="google", identifier="google-bob", linked_at=now),
            ),
        )
    )
    api.request("PUT", f"/v2/users/me/saved-games/{game}", as_user=alice)
    with (
        patch.object(
            store,
            "list_all_game_versions",
            side_effect=AssertionError("global versions"),
        ),
        patch.object(
            store, "list_all_matches", side_effect=AssertionError("global matches")
        ),
        patch.object(store, "list_users", side_effect=AssertionError("global users")),
    ):
        merged = api.ok(
            "POST", f"/users/{alice}/merge", json={"into_user_id": bob, "into_password": api.passwords_by_user_id[bob]}, as_user=alice
        )
    assert merged["id"] == bob
    assert store.get_user(bob).token_balance == 28
    assert store.get_user(alice).token_balance == 0
    assert store.find_linked_account("email", "alice@example.com").id == bob
    assert store.get_game(game).owner_user_id == bob
    result = store.get_match(match)
    assert result.seat_of(bob).logic_player_id == alice
    assert result.moves[0].made_by_user_id == bob
    assert api.ok("GET", "/auth/me", as_user=alice)["user_id"] == bob
    assert (
        api.ok("GET", "/v2/users/me/saved-games", as_user=bob)["items"][0]["id"] == game
    )


def test_online_merge_waits_for_shared_live_match_before_any_changes(store):
    api = api_for(store)
    alice, bob = (api.new_user(x) for x in ("alice", "bob"))
    game = api.new_game(owner=alice)
    api.new_match(owner=alice, game_id=game, joiners=[bob], start=True)
    response = api.request(
        "POST", f"/users/{alice}/merge", json={"into_user_id": bob, "into_password": api.passwords_by_user_id[bob]}, as_user=alice
    )
    assert response.status_code == 409
    assert "wait until shared matches end" in response.json()["detail"]
    assert store.get_user(alice).replaced_by_user_id is None
    assert store.get_game(game).owner_user_id == alice


def test_merge_job_waits_for_shared_active_match_without_mutating(store):
    from game_platform.scaling_accounts import merge_users

    api = api_for(store)
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game = api.new_game(owner=alice)
    api.new_match(owner=alice, game_id=game, joiners=[bob], start=True)
    result = _run_until_complete(
        merge_users,
        store=store,
        run_id="merge-2",
        source_id=alice,
        into_id=bob,
        max_records=3,
    )
    assert result["failed"] == "shared_active_match"
    assert store.get_game(game).owner_user_id == alice
    assert store.get_user(alice).replaced_by_user_id is None


def test_delete_job_resumes_and_removes_the_user(store):
    from game_platform.scaling_accounts import delete_user

    api = api_for(store)
    carol, dave, erin = (
        api.new_user("carol"),
        api.new_user("dave"),
        api.new_user("erin"),
    )
    game = api.new_game(owner=carol)
    owned_match = api.new_match(owner=carol, game_id=game)
    other_game = api.new_game(owner=erin)
    shared_match = api.new_match(
        owner=erin, game_id=other_game, joiners=[carol], start=True
    )
    store.put_user(replace(store.get_user(dave), invited_by_user_id=carol))
    code = store.get_user(carol).referral_code
    platform = ScalablePlatform(store=store, computer_move_delay_seconds=0)
    result = _run_until_complete(
        delete_user,
        store=store,
        run_id="delete-1",
        user_id=carol,
        max_records=2,
        platform=platform,
    )
    assert result["complete"]
    assert store.get_user(carol) is None
    assert store.get_game(game).deleted
    assert store.get_match(owned_match) is None
    # Carol leaving Erin's live match ends it (the game forbids mid-match
    # leaves), exactly as the snapshot admin deletion does via leave_match.
    assert store.get_match(shared_match).status == "over"
    assert store.get_user(dave).invited_by_user_id is None
    if code:
        assert store.user_for_referral(code) is None
    assert delete_user(store, run_id="delete-1", max_records=1)["processed"] == 0
    assert not any(x.user_id == carol for x in store.list_experiment_assignments())
    assert not any(x.user_id == carol for x in store.list_experiment_events())


def test_experiment_hooks_do_not_scan_all_users_or_events(store):
    api = api_for(store)
    with (
        patch.object(
            store, "list_users", side_effect=AssertionError("global users scan")
        ),
        patch.object(
            store,
            "list_experiment_events",
            side_effect=AssertionError("global events scan"),
        ),
    ):
        owner = api.new_user("owner")
        other = api.new_user("other")
        api.new_match(
            owner=owner, game_id=api.new_game(owner=owner), joiners=[other], start=True
        )


def test_portal_catalog_copies_existing_sources_without_regeneration(store):
    import datetime as dt
    from pathlib import Path
    from game_platform.scaling_portal_server import copy_catalog, MonthClock

    clock = MonthClock("2026-09")
    with pytest.raises(ValueError):
        clock.set_day(dt.date(2026, 10, 1))
    catalog = copy_catalog(store, run_id="copies", copies=2, now=clock())
    assert len(catalog) == 4
    counts = store.counts()
    assert copy_catalog(store, run_id="copies", copies=2, now=clock()) == catalog
    assert store.counts() == counts
    base = Path(__file__).parents[1] / "games"
    for item in catalog:
        game = store.get_game(item["id"])
        assert game.code == (base / (item["kind"] + ".html")).read_text(
            encoding="utf-8"
        )
        assert game.server_code == (base / (item["kind"] + ".server.js")).read_text(
            encoding="utf-8"
        )


def test_campaign_signup_metadata_is_queryable_for_match_attribution(store):
    from game_platform.service import CAMPAIGN_EXPERIMENT_ID

    api = api_for(store)
    user = api.new_user("campaign user")
    platform = api.client.app.state.platform
    campaign = platform._active_experiment(CAMPAIGN_EXPERIMENT_ID)
    platform.record_new_user(user_id=user, campaign_code=campaign.variants[0].key)
    events = store.experiment_signups({user}, CAMPAIGN_EXPERIMENT_ID)
    assert len(events) == 1 and events[0].user_id == user


def test_large_library_pages_do_not_grow_the_user_record(store):
    api = api_for(store)
    owner, other = api.new_user("library owner"), api.new_user("other")
    game = store.get_game(api.new_game(owner=owner))
    ids = set()
    for i in range(105):
        gid = f"library-game-{i}"
        store.add_game_version(replace(game, id=gid))
        assert (
            api.request(
                "PUT", f"/v2/users/me/saved-games/{gid}", as_user=owner
            ).status_code
            == 204
        )
        ids.add(gid)
    assert store.get_user(owner).saved_game_ids == ()
    # The v1 list serves the whole library too: entries are read in bounded
    # pages behind it, however many games the user saved.
    saved = api.ok("GET", "/users/me/saved-games", as_user=owner)
    assert {game["id"] for game in saved} == ids
    found, cursor = set(), None
    while True:
        result = api.ok(
            "GET",
            "/v2/users/me/saved-games",
            as_user=owner,
            params={"cursor": cursor} if cursor else None,
        )
        assert len(result["items"]) <= 50
        assert all("code" not in game for game in result["items"])
        found.update(game["id"] for game in result["items"])
        cursor = result["next_cursor"]
        if not cursor:
            break
    assert found == ids
    assert api.ok("GET", "/v2/users/me/saved-games", as_user=other)["items"] == []
    api.request("DELETE", "/v2/users/me/saved-games/library-game-0", as_user=owner)
    assert store.counts()["libraries_total"] == 104


def test_library_normalization_and_account_jobs_preserve_saved_games(store):
    from game_platform.scaling_library import normalize
    from game_platform.scaling_accounts import merge_users, delete_user

    api = api_for(store)
    owner, target = api.new_user("owner"), api.new_user("target")
    game = api.new_game(owner=owner)
    store.put_user(replace(store.get_user(owner), saved_game_ids=(game,)))
    # The first read normalizes the legacy library lazily — no offline job
    # and no refusal — and the offline command afterwards is a no-op.
    assert (
        api.ok("GET", "/v2/users/me/saved-games", as_user=owner)["items"][0]["id"]
        == game
    )
    assert store.get_user(owner).saved_game_ids == ()
    _run_until_complete(normalize, store=store, run_id="normalize", max_records=1)
    assert (
        api.ok("GET", "/v2/users/me/saved-games", as_user=owner)["items"][0]["id"]
        == game
    )
    _run_until_complete(
        merge_users,
        store=store,
        run_id="library-merge",
        source_id=owner,
        into_id=target,
        max_records=2,
    )
    assert (
        api.ok("GET", "/v2/users/me/saved-games", as_user=target)["items"][0]["id"]
        == game
    )
    assert (
        api.ok("GET", "/v2/users/me/saved-games", as_user=owner)["items"][0]["id"]
        == game
    )
    _run_until_complete(
        delete_user, store=store, run_id="library-delete", user_id=target, max_records=2
    )
    assert store.counts()["libraries_total"] == 0


def test_offline_experiment_report_matches_legacy_metrics_and_resumes(store):
    from game_platform.scaling_experiment_report import rebuild, current
    from game_platform.service import GamePlatform, CAMPAIGN_EXPERIMENT_ID

    api = api_for(store)
    owner, other = api.new_user("owner"), api.new_user("other")
    platform = api.client.app.state.platform
    campaign = platform._active_experiment(CAMPAIGN_EXPERIMENT_ID)
    platform.record_campaign_click(campaign_code=campaign.variants[0].key)
    platform.record_campaign_click(campaign_code=campaign.variants[0].key)
    platform.record_new_user(user_id=owner, campaign_code=campaign.variants[0].key)
    api.new_match(
        owner=owner, game_id=api.new_game(owner=owner), joiners=[other], start=True
    )
    expected = GamePlatform(store=store).experiment_stats()
    assert current(store) is None
    assert rebuild(store, run_id="metrics", max_records=1)["complete"] is False
    assert current(store) is None
    _run_until_complete(rebuild, store=store, run_id="metrics", max_records=2)
    actual = current(store)
    for name in ("skin_experiment", "campaign_experiment"):
        assert actual[name] == expected[name]
    assert rebuild(store, run_id="metrics", max_records=1)["processed"] == 0
    with (
        patch.object(
            store, "list_users", side_effect=AssertionError("global users scan")
        ),
        patch.object(
            store,
            "list_experiment_events",
            side_effect=AssertionError("global events scan"),
        ),
    ):
        assert platform.experiment_stats() == actual


def test_referral_report_is_resumable_and_pages_children_and_search(store):
    from game_platform.scaling_referrals import rebuild, report, users

    api = api_for(store)
    root, child, grandchild = [
        api.new_user(name)
        for name in ("Root person", "Child person", "Grandchild person")
    ]
    store.put_user(replace(store.get_user(child), invited_by_user_id=root))
    store.put_user(replace(store.get_user(grandchild), invited_by_user_id=child))
    assert not rebuild(store, run_id="referrals", max_records=1)["complete"]
    with pytest.raises(ValueError):
        report(store)
    _run_until_complete(rebuild, store=store, run_id="referrals", max_records=1)
    _, job, _ = report(store)
    assert job["summary"] == {
        "users": 3,
        "invited_users": 2,
        "inviters": 2,
        "biggest_tree": 3,
        "longest_chain": 2,
        "cycles_broken": 0,
    }
    first = users(store, limit=1)
    assert first["items"][0]["id"] == root and first["items"][0]["total_invites"] == 2
    assert users(store, parent_id=root)["items"][0]["id"] == child
    assert users(store, q="grand")["items"][0]["id"] == grandchild
    assert (
        users(store, q=store.get_user(child).referral_code)["items"][0]["id"] == child
    )
    with pytest.raises(ValueError):
        users(store, parent_id=child, cursor=first["next_cursor"])
    assert api.ok("GET", "/v2/admin/referrals/summary")["summary"]["users"] == 3
    assert (
        api.ok("GET", "/v2/admin/referrals/users", params={"parent_id": root})["items"][
            0
        ]["id"]
        == child
    )


def test_referral_report_breaks_cycles_without_changing_source_users(store):
    from game_platform.scaling_referrals import rebuild, report, users

    api = api_for(store)
    a, b = api.new_user("a"), api.new_user("b")
    store.put_user(replace(store.get_user(a), invited_by_user_id=b))
    store.put_user(replace(store.get_user(b), invited_by_user_id=a))
    _run_until_complete(rebuild, store=store, run_id="cycle", max_records=1)
    _, job, _ = report(store)
    assert job["summary"]["cycles_broken"] == 1
    assert job["summary"]["biggest_tree"] == 2
    assert len(users(store, parent_id="")["items"]) == 1
    assert store.get_user(a).invited_by_user_id == b
    assert store.get_user(b).invited_by_user_id == a


def test_generic_worker_wakes_for_work_without_half_second_idle_polling(store):
    import threading, time

    platform = ScalablePlatform(store=store)
    ran = threading.Event()
    with (
        patch.object(platform, "run_due_jobs", side_effect=lambda: ran.set()) as jobs,
        patch.object(platform, "run_outbox"),
    ):
        platform.resume_computer_moves()
        try:
            assert ran.wait(3)
            time.sleep(0.8)
            assert jobs.call_count == 1
            ran.clear()
            platform._wake_after(0.1)
            assert ran.wait(3)
            assert jobs.call_count == 2
        finally:
            platform.close_workers()


def test_offline_metrics_use_live_experiment_configuration_after_admin_changes(store):
    from game_platform.scaling_experiment_report import rebuild, current

    api = api_for(store)
    api.new_user("existing")
    _run_until_complete(rebuild, store=store, run_id="live-config", max_records=20)
    old = store._get("experiments", "ui-skins")
    added = replace(
        old.variants[0], id="new-variant", key="new-variant", name="New variant"
    )
    store.put_experiment(
        replace(
            old, name="Updated name", active=False, variants=(*old.variants[1:], added)
        )
    )
    result = current(store)
    skin = result["skin_experiment"]
    assert skin["name"] == "Updated name"
    assert skin["active"] is False
    assert old.variants[0].id not in {v["variant_id"] for v in skin["variants"]}
    assert (
        next(v for v in skin["variants"] if v["variant_id"] == added.id)["assigned"]
        == 0
    )
    assert result["configuration_consistency"] == "live"


def test_translation_bundles_on_the_emulator_merge_entries_and_load_in_one_query(store):
    import datetime as dt
    from game_platform.models import Translation
    from game_platform.translation import text_hash

    def row(source, text="", locale="es"):
        return Translation(
            locale=locale,
            source_hash=text_hash(source),
            source=source,
            text=text or f"[{locale}] {source}",
            provider="google",
            created_at=dt.datetime.now(dt.timezone.utc),
        )

    other = QueryStore(store.client, namespace=store.namespace)
    store.put_translations([row("One"), row("Two")])
    other.put_translations([row("Three")])  # a merge: it must not erase One and Two
    store.delete_translation("es", text_hash("Two"))
    store.delete_translation("fr", text_hash("never there"))  # no document: no error
    fresh = QueryStore(store.client, namespace=store.namespace)
    with patch.object(fresh.client, "get_all", side_effect=AssertionError("no per-text reads")):
        found = fresh.list_translations("es")
    assert {item.source for item in found} == {"One", "Three"}
    document = store.client.collection(store.namespace + "_translation_bundles").document("es-000").get()
    assert set(document.to_dict()["entries"]) == {text_hash("One"), text_hash("Three")}


def _counting_firestore_reads():
    """Patches the Firestore client so every read round trip is counted: a document
    get, a query, or a batched get."""
    import contextlib

    from google.cloud.firestore_v1.client import Client
    from google.cloud.firestore_v1.document import DocumentReference
    from google.cloud.firestore_v1.query import Query

    reads = []

    @contextlib.contextmanager
    def counting():
        patches = []
        for cls, name in ((DocumentReference, "get"), (Query, "stream"), (Client, "get_all")):
            original = getattr(cls, name)

            def counted(self, *args, _original=original, _name=name, **kwargs):
                reads.append(_name)
                return _original(self, *args, **kwargs)

            patches.append(patch.object(cls, name, counted))
        with contextlib.ExitStack() as stack:
            for p in patches:
                stack.enter_context(p)
            yield

    return reads, counting


def test_every_feedback_call_reads_firestore_at_most_twice_and_is_fast(store):
    import time

    api = api_for(store)
    ann, bob = api.new_user("ann"), api.new_user("bob")
    game = api.new_game(owner=bob)
    match = api.new_match(owner=bob, game_id=game, joiners=[ann], start=True)
    reads, counting = _counting_firestore_reads()
    calls = [
        ("POST", "/feedback", {"kind": "problem", "target_type": "user", "target_id": bob, "text": "bad name"}),
        ("POST", "/feedback", {"kind": "bug", "target_type": "game", "target_id": game, "text": "it flickers"}),
        ("POST", "/feedback", {"kind": "suggestion", "target_type": "match", "target_id": match, "text": "an undo"}),
        ("POST", "/feedback", {"kind": "bug", "target_type": "platform", "text": "the menu is slow"}),
        # A repeat (an update) and a refusal cost the same.
        ("POST", "/feedback", {"kind": "bug", "target_type": "game", "target_id": game, "text": "it still flickers"}),
        ("POST", "/feedback", {"kind": "bug", "target_type": "user", "target_id": ann, "text": "me, myself"}),
        ("GET", "/admin/feedback", None),
        ("GET", "/admin/feedback", {"kind": "bug", "target_type": "game"}),
    ]
    for method, path, body in calls:
        reads.clear()
        with counting():
            started = time.perf_counter()
            if method == "POST":
                response = api.request(method, path, as_user=ann, json=body)
            else:
                response = api.request(method, path, params=body)
            took = time.perf_counter() - started
        assert response.status_code in (200, 201, 400), response.text
        # A POST is the login check plus one batch; the admin listing is two queries.
        assert len(reads) <= 2, (method, path, body, reads)
        assert took < 1, (method, path, took)
    assert api.ok("GET", "/admin/feedback")["count"] == 4


def test_the_daily_feedback_limit_spans_midnight_in_query_mode(store):
    import datetime as dt

    from game_platform.service import TooManyRequestsError

    now = [dt.datetime(2026, 1, 1, 23, 0, tzinfo=dt.timezone.utc)]
    platform = ScalablePlatform(store=store, clock=lambda: now[0], computer_move_delay_seconds=0)
    ann = platform.create_user(display_name="ann").id
    targets = [platform.create_user(display_name=f"user {n}").id for n in range(21)]

    def send(target, text="spam account"):
        return platform.send_feedback(
            caller_id=ann, kind="problem", target_type="user", target_id=target, text=text
        )

    for target in targets[:20]:
        send(target)
        now[0] += dt.timedelta(minutes=1)
    now[0] = dt.datetime(2026, 1, 2, 2, 0, tzinfo=dt.timezone.utc)  # the next day
    with pytest.raises(TooManyRequestsError):
        send(targets[20])
    updated, created = send(targets[0], "still spam")
    assert not created and updated.text == "still spam"
    now[0] = dt.datetime(2026, 1, 2, 23, 0, tzinfo=dt.timezone.utc)  # 24 hours after the first
    assert send(targets[20])[1]
    # The limit document keeps only the last 24 hours.
    entries = store.raw_get(store.ref("feedback_limits", ann))["entries"]
    assert len(entries) == 20


def test_agent_import_roundtrips_query_store(store):
    from game_platform.tests.test_agent_import import payload
    from game_platform.tests.test_game_test_api import run_full_flow
    api = api_for(store)
    owner = api.new_user('Agent import owner')
    body = payload()
    # POST /games is gated on the recorded /game-test flow for the secret.
    run_full_flow(api, body['game_addition_request_id_and_secret'], body)
    response = api.request('POST', '/games', as_user=owner, json=body)
    assert response.status_code == 201, response.text
    game = response.json()
    assert game['published'] is True
    restarted = QueryStore(store.client, namespace=store.namespace)
    saved = restarted.get_game(game['id'])
    assert saved is not None
    assert saved.owner_user_id == owner
    assert saved.code == body['client_code']
    assert saved.published is True
    assert saved.import_package is not None
    assert saved.import_package['translations']['es']['display_name'] == body['translations']['es']['display_name']


def test_history_move_privacy_on_query_backend(store):
    from game_platform.tests.test_security_audit import test_history_redacts_private_move_payloads
    test_history_redacts_private_move_payloads(api_for(store))


@pytest.mark.parametrize("phase", ["start", "join"])
def test_lifecycle_payout_settlement_on_query_backend(store, phase):
    from game_platform.tests.test_security_audit import test_game_lifecycle_payouts_are_applied_exactly_once
    test_game_lifecycle_payouts_are_applied_exactly_once(api_for(store), phase)
