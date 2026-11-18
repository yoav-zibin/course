"""Authoring traces retain exact inputs without persisting authorizing secrets."""

import json

import pytest

from game_platform import game_traces
from game_platform.tests.fake_firestore import query_store
from game_platform.tests.helpers import Api


@pytest.mark.parametrize("secret", ["synthetic-game-secret-0123456789", "synthetic-admin", "管理凭据"])
def test_trace_storage_omits_credentials_and_authenticated_read_reconstructs_inputs(secret):
    store = query_store("private_trace_credentials")
    body = {"name": "Example", "game_addition_request_id_and_secret": secret,
            "server_code": "const game = {};"}
    try:
        row = game_traces.record_submission(store, secret=secret, game_name=body["name"], body_dict=body)
        assert secret not in json.dumps(store.client.docs, ensure_ascii=False, default=str)
        loaded = game_traces.load_submission_body(store, row, secret=secret)
        assert loaded == body
        assert game_traces.inputs_hash(loaded) == row["inputs_hash"]
        with pytest.raises(ValueError, match="credential"):
            game_traces.load_submission_body(store, row)
        with pytest.raises(ValueError, match="credential"):
            game_traces.load_submission_body(store, row, secret="incorrect")
    finally:
        store.close()


def test_existing_unredacted_trace_remains_readable_without_rewriting_storage():
    store = query_store("legacy_trace_credentials")
    body = {"name": "Legacy", "game_addition_request_id_and_secret": "legacy-game-secret"}
    try:
        row = game_traces.record_submission(store, secret="legacy-game-secret", game_name=body["name"], body_dict=body)
        ref = store.ref(game_traces.TRACE_KIND, row["id"])
        legacy = {key: value for key, value in row.items() if key not in {"id", "credential_redacted"}}
        store.raw_put(ref, legacy)
        store.raw_put(ref.collection("chunks").document("000000"), {"text": game_traces.canonical_json(body)})
        before = json.dumps(store.client.docs, sort_keys=True, ensure_ascii=False, default=str)
        assert game_traces.load_submission_body(store, {"id": row["id"], **legacy}) == body
        assert json.dumps(store.client.docs, sort_keys=True, ensure_ascii=False, default=str) == before
    finally:
        store.close()


@pytest.mark.parametrize("stored", [False, True])
def test_invalid_authoring_payload_never_echoes_master_credential(stored):
    secret = "M4st3r!"
    store = query_store("trace_invalid_credential")
    api = Api(store=store, master_password=secret)
    body = {"game_addition_request_id_and_secret": secret}
    try:
        if stored:
            row = game_traces.record_submission(store, secret=secret, game_name="Invalid", body_dict=body)
            response = api.client.post("/game-test/server-check",
                json={"secret": secret, "submission_id": row["id"]})
        else:
            response = api.client.post("/game-test/submissions",
                json={"secret": secret, "game_name": "Invalid", "body": body})
        assert response.status_code == 422
        assert secret not in response.text
    finally:
        api.client.close()
        store.close()
