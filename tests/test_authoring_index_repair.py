from unittest.mock import Mock
import pytest
from google.cloud import firestore_admin_v1 as admin
from game_platform.config import FirestoreConfig
from game_platform.scaling_indexes import index_config
from game_platform.tools.repair_authoring_indexes import repair, FIELDS


def test_authoring_queries_have_metadata_indexes_without_indexing_payloads():
    fields = {row['fieldPath']: row['indexes'] for row in index_config('test_authoring')['fieldOverrides']
              if row['collectionGroup'] == 'test_authoring_game_test_traces'}
    assert fields.pop('*') == []
    assert set(fields) == set(FIELDS)
    assert all(value == [{'queryScope': 'COLLECTION', 'order': 'ASCENDING'}] for value in fields.values())


def test_repair_is_scoped_to_three_fields_and_preserves_default_database_guard():
    storage = FirestoreConfig(enabled=True, project_id='test-project', namespace='test_authoring')
    client = Mock()
    with pytest.raises(ValueError, match='production acknowledgement'):
        repair(storage, client=client)
    client.get_field.assert_not_called()
    client.get_field.return_value = admin.Field(index_config=admin.Field.IndexConfig(indexes=[]))
    assert repair(storage, allow_production=True, client=client)['ready']
    requests = [call.kwargs['request'] for call in client.update_field.call_args_list]
    assert len(requests) == 3
    assert {row['field'].name.rsplit('/', 1)[1] for row in requests} == set(FIELDS)
    assert all('/test_authoring_game_test_traces/fields/' in row['field'].name for row in requests)
    assert all(list(row['update_mask'].paths) == ['index_config'] for row in requests)
    assert client.update_field.return_value.result.call_count == 3


def test_ready_authoring_indexes_are_not_rebuilt_on_later_deployments():
    storage = FirestoreConfig(enabled=True, project_id='test-project', namespace='test_authoring', database='test')
    client = Mock()
    client.get_field.side_effect = [admin.Field(index_config=admin.Field.IndexConfig(indexes=[
        admin.Index(query_scope='COLLECTION', state='READY', fields=[
            admin.Index.IndexField(field_path=name, order='ASCENDING'),
            admin.Index.IndexField(field_path='__name__', order='ASCENDING'),
        ])
    ])) for name in FIELDS]
    assert repair(storage, client=client)['ready']
    client.update_field.assert_not_called()
