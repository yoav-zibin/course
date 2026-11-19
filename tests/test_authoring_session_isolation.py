"""An authoring capability cannot replace another author's recorded session."""

import os
import uuid

import pytest

from game_platform import game_traces
from game_platform.read_cache import ReadCache
from game_platform.tests.fake_firestore import FakeClient, query_store


@pytest.mark.parametrize("backend", ["fake", "emulator"])
def test_stale_missing_session_cannot_overwrite_another_author(backend):
    if backend == "fake":
        client = FakeClient()
        attacker = query_store("session_isolation", client)
        victim = query_store("session_isolation", client)
    else:
        endpoint = os.environ.get("FIRESTORE_EMULATOR_HOST", "")
        if not endpoint:
            pytest.skip("requires disposable Firestore emulator")
        assert endpoint.startswith(("127.0.0.1:", "localhost:"))
        from google.cloud import firestore
        from game_platform.query_store import QueryStore
        client = firestore.Client(project="demo-game-platform")
        namespace = "session_isolation_" + uuid.uuid4().hex
        attacker = QueryStore.initialize(client, namespace=namespace)
        victim = QueryStore(client, namespace=namespace)
    attacker._cache.close()
    attacker._cache = ReadCache(clock=lambda: 0.0, submit=lambda job: None)
    common = dict(session_id="shared-session-id", mode="multiplayer",
        config={"num_players": 1, "resolution": "desktop", "orientation": "landscape", "human_player_index": 0},
        players=[{"id": "player", "kind": "human"}], pot=0, match_seed=17, initial_turn=["player"])
    try:
        ref = attacker.ref(game_traces.TRACE_KIND, common["session_id"])
        assert attacker.raw_get(ref) is None
        original = game_traces.create_session(victim,
            secret="victim-secret-0123456789", submission_id="victim-submission",
            initial_state={"private": "victim-only"}, **common)
        # Another process committed the session, while this process still has a
        # valid cached miss. A transactional create must check it again.
        assert attacker.raw_get(ref) is None
        with pytest.raises(ValueError, match="already exists"):
            game_traces.create_session(attacker,
                secret="attacker-secret-0123456789", submission_id="attacker-submission",
                initial_state={"private": "attacker"}, **common)
        victim.clear_cache()
        saved = game_traces.get_session(victim, common["session_id"])
        assert saved == original
        assert game_traces.session_payload(victim, saved)["states"] == [{"private": "victim-only"}]
    finally:
        attacker.close()
        victim.close()
