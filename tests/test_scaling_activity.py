"""Historical generation follows the same typed multiplayer contract as users."""

from game_platform.scaling_activity import generate
from game_platform.tests.fake_firestore import query_store


def test_historical_multiplayer_generation_runs_rules_and_resumes_without_duplicates():
    store = query_store("historical_multiplayer")
    settings = dict(run_id="played", users=8, games=2, matches=20, max_writes=20_000)
    assert generate(store, **settings)["complete"]
    counts = store.counts()
    assert counts["matches_total"] == 20
    assert counts["moves_total"] > 0
    assert counts["matches_over"] > 0
    matches = store.page("matches", limit=100).items
    assert all(match.match_kind == "multiplayer" for match in matches)
    assert all(len(match.seats) >= 2 for match in matches)
    assert all(seat.kind == "human" and seat.user_id for match in matches for seat in match.seats)
    for match in matches:
        assert match.created_at.month == 9
        if match.moves:
            assert all(move.move is not None for move in match.moves)
            assert match.moves[-1].new_state == match.state
    assert generate(store, **settings)["complete"]
    assert store.counts() == counts
