import datetime as dt

from game_platform.deploy.seed_scaling_data import make_dataset


def test_synthetic_dataset_has_monthly_mix_and_consistent_references() -> None:
    end_at = dt.datetime(2026, 10, 30, tzinfo=dt.timezone.utc)
    users, games, matches = make_dataset(
        users_count=100,
        matches_count=100,
        games_count=10,
        end_at=end_at,
        seed=7,
        run_id="test-month",
    )
    users_by_id = {user.id: user for user in users}
    games_by_id = {game.id: game for game in games}
    assert len(users) == 100
    assert len(games) == 10
    assert len(matches) == 100
    assert all(user.email.endswith("@example.invalid") for user in users)
    assert all("Synthetic" in game.code for game in games)
    assert {match.status for match in matches} == {
        "over",
        "ongoing",
        "waiting_for_players",
    }

    for match in matches:
        assert match.created_at <= match.updated_at <= end_at
        assert match.created_at >= end_at - dt.timedelta(days=30)
        assert match.game_id in games_by_id
        assert games_by_id[match.game_id].created_at <= match.created_at
        assert all(
            users_by_id[seat.user_id].created_at <= match.created_at
            for seat in match.seats
            if seat.user_id is not None
        )
        if match.status == "waiting_for_players":
            assert len(match.seats) == 1
            assert not match.moves
        elif match.status == "over":
            assert match.end_reason == "finished"
            assert match.moves[-1].next_turn_player_indices is None
        else:
            assert match.turn_of_player_indices is not None
