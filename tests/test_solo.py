from copy import deepcopy

from game_platform.tests.helpers import Api, error


def single_player(owner, game, *, computers=0, identity="local-solo-save"):
    count = 1 + computers
    return {
        "id": identity, "game_id": game, "game_version": 1,
        "owner_user_id": owner, "match_kind": "computer" if computers else "pass_and_play",
        "players": [{"id": f"local-player-{i}", "player_index": i,
                     "kind": "human" if i == 0 else "computer",
                     "user_id": owner if i == 0 else None, "active": True}
                    for i in range(count)],
        "state": {"score": 0}, "logicState": {"score": 0},
        "initialState": {"score": 0}, "initialTurn": [0], "practiceSeed": 123,
        "status": "ongoing", "turn_of_player_indices": [0], "move_count": 0, "moves": [],
        "created_at": "2026-11-20T00:00:00Z", "awaitingHandoff": False,
    }


def advance(saved, *, score, turn, player=0):
    saved = deepcopy(saved)
    state = {"score": score}
    saved["moves"].append({"move_number": len(saved["moves"]) + 1, "player_index": player,
                           "new_state": state, "next_turn_player_indices": turn,
                           "move": {"state": state, "turn_indices": turn}})
    saved.update(state=state, logicState=state, move_count=len(saved["moves"]),
                 turn_of_player_indices=turn, status="over" if turn is None else "ongoing")
    return saved


def save(api, owner, snapshot, revision=0):
    return api.ok("POST", "/matches/single-player-sync", as_user=owner,
                  json={"match": snapshot, "expected_revision": revision})


def test_solo_game_can_start_continue_and_finish_with_one_human(api: Api):
    alice = api.new_user('solo player')
    game = api.new_game(owner=alice, allowed_player_counts=[1])
    snapshot = single_player(alice, game)
    started = save(api, alice, snapshot)
    assert api.summary(started)['players'] == ['solo player']
    assert started['turn_of_player_indices'] == [0] and started['match_kind'] == 'pass_and_play'
    snapshot = advance(snapshot, score=1, turn=[0])
    continued = save(api, alice, snapshot, started['cloud_revision'])
    assert continued['turn_of_player_indices'] == [0] and continued['state'] == {'score': 1}
    snapshot = advance(snapshot, score=2, turn=None)
    finished = save(api, alice, snapshot, continued['cloud_revision'])
    restored = api.ok('GET', f"/matches/{snapshot['id']}", as_user=alice)
    assert restored['status'] == finished['status'] == 'over'
    assert restored['state'] == {'score': 2} and restored['move_count'] == 2
    assert restored['single_player_state']['moves'] == snapshot['moves']
    assert api.request('GET', f"/matches/{snapshot['id']}").status_code == 404

    # Pre-cloud one-seat records still support their authenticated server flow.
    legacy = api.new_match(owner=alice, game_id=game, start=True)
    assert api.match_summary(legacy, as_user=alice)['players'] == ['solo player']
    assert api.match_summary(legacy, as_user=alice)['turn'] == [0]
    assert api.move(legacy, as_user=alice, next_turn=0, state={'score': 1}).status_code == 201
    assert api.match_summary(legacy, as_user=alice)['turn'] == [0]
    assert api.move(legacy, as_user=alice, next_turn=None, state={'score': 2}).status_code == 201
    assert api.match_summary(legacy, as_user=alice)['status'] == 'over'
    assert api.request('GET', f'/matches/{legacy}').status_code == 404


def test_solo_only_game_cannot_add_a_second_seat(api: Api):
    alice, bob = api.new_user('alice'), api.new_user('bob')
    game = api.new_game(owner=alice, allowed_player_counts=[1])
    snapshot = single_player(alice, game)
    match = save(api, alice, snapshot)['id']
    assert error(api.request('POST', f'/matches/{match}/join', as_user=bob)) == (
        403, 'single-player matches cannot be joined or shared')
    assert len(api.ok('GET', f'/matches/{match}', as_user=alice)['players']) == 1
    assert api.request('GET', f'/matches/{match}', as_user=bob).status_code == 404
    assert api.request('POST', '/matches', as_user=alice, json={'game_id': game, 'num_computer_opponents': 1}).status_code == 422
    legacy = api.new_match(owner=alice, game_id=game)
    assert error(api.request('POST', f'/matches/{legacy}/join', as_user=bob)) == (
        403, 'single-player matches cannot be joined or shared')
    assert len(api.ok('GET', f'/matches/{legacy}', as_user=alice)['players']) == 1


def test_same_game_can_offer_solo_and_multiplayer(api: Api):
    alice, bob = api.new_user('alice'), api.new_user('bob')
    game = api.new_game(owner=alice, allowed_player_counts=[1, 2])
    solo = save(api, alice, single_player(alice, game))
    humans = api.new_match(owner=alice, game_id=game, joiners=[bob], start=True)
    snapshot = single_player(alice, game, computers=1, identity="local-computer-save")
    computer = save(api, alice, snapshot)
    assert api.summary(solo)['players'] == ['alice']
    assert api.match_summary(humans)['players'] == ['alice', 'bob']
    assert api.ok('GET', f'/matches/{humans}')['match_kind'] == 'multiplayer'
    snapshot = advance(snapshot, score=1, turn=[1])
    computer = save(api, alice, snapshot, computer['cloud_revision'])
    assert computer['turn_of_player_indices'] == [1]
    snapshot = advance(snapshot, score=2, turn=[0], player=1)
    computer = save(api, alice, snapshot, computer['cloud_revision'])
    assert computer['turn_of_player_indices'] == [0] and computer['move_count'] == 2
    assert computer['match_kind'] == 'computer'
    for private in (solo, computer):
        for caller in (None, bob):
            assert api.request('GET', f"/matches/{private['id']}", as_user=caller).status_code == 404

    # The same version also retains playable legacy server-computer records.
    legacy = api.new_match(owner=alice, game_id=game, num_computer_opponents=1, start=True)
    assert api.ok('GET', f'/matches/{legacy}', as_user=alice)['match_kind'] == 'computer'
    assert api.move(legacy, as_user=alice, next_turn=1).status_code == 201
    assert api.move(legacy, as_user=alice, next_turn=0).status_code == 201
