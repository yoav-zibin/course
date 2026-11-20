"""Index deployment preserves ready fields and waits for changed fields."""

from unittest.mock import Mock, patch
import pytest

from game_platform.scaling_index_deploy import deploy
from game_platform.scaling_indexes import index_config
from google.api_core.exceptions import NotFound
from google.cloud import firestore_admin_v1 as admin


@pytest.mark.parametrize('operation', ['latest', 'rows', 'checks', 'open_session'])
def test_game_test_queries_have_indexes_with_payload_indexing_disabled(operation):
    from game_platform import game_traces

    store = Mock()
    store._query.return_value = []
    if operation == 'latest':
        game_traces.latest_submission(store, 'test-digest')
    elif operation == 'rows':
        game_traces.rows_for_submission(store, 'test-submission')
    elif operation == 'checks':
        game_traces.rows_for_submission(store, 'test-submission', kind='server_check')
    else:
        game_traces.open_session(store, 'test-submission')
    kind, filters = store._query.call_args.args
    assert kind == game_traces.TRACE_KIND
    assert all(operator == '==' for _, operator, _ in filters)
    fields = {field for field, _, _ in filters}
    config = index_config('test_traces')
    group = 'test_traces_' + kind
    overrides = {item['fieldPath']: item for item in config['fieldOverrides']
                 if item['collectionGroup'] == group}
    assert overrides['*']['indexes'] == []
    if len(fields) == 1:
        assert overrides[next(iter(fields))]['indexes'] == [
            {'queryScope': 'COLLECTION', 'order': 'ASCENDING'},
        ]
    else:
        assert any(
            index['collectionGroup'] == group
            and index['queryScope'] == 'COLLECTION'
            and index['fields'] == [
                {'fieldPath': field, 'order': 'ASCENDING'} for field in sorted(fields)
            ]
            for index in config['indexes']
        ), f'Missing production index for {operation}: {fields}'
    assert set(overrides) == {'*', 'submission_id'}


def test_native_receipt_worker_due_time_remains_indexed_when_defaults_are_disabled():
    overrides = index_config("test_notifications")["fieldOverrides"]
    fields = {item["fieldPath"]: item for item in overrides
              if item["collectionGroup"] == "test_notifications_push_receipts"}
    assert fields["*"]["indexes"] == []
    assert fields["due_at"]["indexes"] == [
        {"queryScope": "COLLECTION", "order": "ASCENDING"},
    ]
    assert set(fields) == {"*", "due_at", "user_id"}  # Endpoints/credentials remain unindexed.
    assert fields["user_id"]["indexes"] == [{"queryScope": "COLLECTION", "order": "ASCENDING"}]


def test_default_database_indexes_require_deliberate_opt_in():
    with pytest.raises(ValueError, match="opt-in"):
        deploy(project="production", database="(default)", namespace="production_v1")
    with (
        patch(
            "game_platform.scaling_index_deploy.index_config",
            return_value={"indexes": [], "fieldOverrides": []},
        ),
        patch("game_platform.scaling_index_deploy.admin.FirestoreAdminClient"),
    ):
        assert deploy(
            project="production",
            database="(default)",
            namespace="production_v1",
            allow_production=True,
        )["ready"]


def test_ready_override_is_not_reapplied():
    client = Mock()
    client.get_field.return_value = admin.Field(
        index_config=admin.Field.IndexConfig(
            indexes=[
                admin.Index(
                    query_scope="COLLECTION",
                    state="READY",
                    fields=[
                        admin.Index.IndexField(field_path="owner", order="ASCENDING"),
                        admin.Index.IndexField(
                            field_path="__name__", order="ASCENDING"
                        ),
                    ],
                )
            ]
        ),
        ttl_config=admin.Field.TtlConfig(state="ACTIVE"),
    )
    config = {
        "indexes": [],
        "fieldOverrides": [
            {
                "collectionGroup": "test_users",
                "fieldPath": "owner",
                "ttl": True,
                "indexes": [{"queryScope": "COLLECTION", "order": "ASCENDING"}],
            }
        ],
    }
    with (
        patch(
            "game_platform.scaling_index_deploy.admin.FirestoreAdminClient",
            return_value=client,
        ),
        patch("game_platform.scaling_index_deploy.index_config", return_value=config),
    ):
        assert deploy(project="test", database="test", namespace="test")["ready"]
    client.update_field.assert_not_called()


def test_missing_override_is_deployed_and_awaited():
    client = Mock()
    client.get_field.side_effect = NotFound("missing")
    config = {
        "indexes": [],
        "fieldOverrides": [
            {
                "collectionGroup": "test_users",
                "fieldPath": "payload",
                "indexes": [],
            }
        ],
    }
    with (
        patch(
            "game_platform.scaling_index_deploy.admin.FirestoreAdminClient",
            return_value=client,
        ),
        patch("game_platform.scaling_index_deploy.index_config", return_value=config),
    ):
        assert deploy(project="test", database="test", namespace="test")["ready"]
    client.update_field.assert_called_once()
    client.update_field.return_value.result.assert_called_once_with(timeout=900)
