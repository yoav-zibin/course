"""Enable only the three metadata indexes required by recorded game authoring.

Reads the existing server configuration; never changes it or any game/user data.
The default database requires an explicit production acknowledgement.
"""
import argparse
from pathlib import Path
from google.cloud import firestore_admin_v1 as admin
from google.api_core.exceptions import NotFound
from google.protobuf.field_mask_pb2 import FieldMask
from game_platform.config import load_config

FIELDS = ('kind', 'secret_hash', 'submission_id')


def repair(storage, *, allow_production=False, client=None):
    if not storage.enabled or not storage.project_id or not storage.namespace:
        raise ValueError('An existing configured Firestore namespace is required')
    if storage.database == '(default)' and not allow_production:
        raise ValueError('Default database requires explicit production acknowledgement')
    client = client or admin.FirestoreAdminClient()
    prefix = f'projects/{storage.project_id}/databases/{storage.database}/collectionGroups/{storage.namespace}_game_test_traces/fields/'
    pending = []
    for name in FIELDS:
        resource = prefix+name
        try:
            existing = client.get_field(request={'name': resource})
        except NotFound:
            existing = None
        if existing and not existing.index_config.uses_ancestor_config:
            ready = [index for index in existing.index_config.indexes
                     if index.query_scope == admin.Index.QueryScope.COLLECTION
                     and index.state == admin.Index.State.READY
                     and any(field.field_path == name and field.order == admin.Index.IndexField.Order.ASCENDING
                             for field in index.fields)]
            if ready:
                continue
        field = admin.Field(name=resource, index_config=admin.Field.IndexConfig(indexes=[
            admin.Index(query_scope='COLLECTION', fields=[admin.Index.IndexField(field_path=name, order='ASCENDING')])
        ]))
        pending.append(client.update_field(request={'field': field, 'update_mask': FieldMask(paths=['index_config'])}))
    for operation in pending:
        operation.result(timeout=900)
    return {'ready': True, 'collection': storage.namespace+'_game_test_traces', 'indexed_fields': list(FIELDS)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--allow-production', action='store_true')
    args = parser.parse_args()
    print(repair(load_config(args.config).firestore, allow_production=args.allow_production))
