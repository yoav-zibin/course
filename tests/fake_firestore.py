"""A tiny in-memory stand-in for the parts of the Firestore client that translation
bundles use, with counters, so tests can prove how many reads a request made."""

from __future__ import annotations

import copy
from typing import Any

from google.cloud import firestore
from google.api_core.exceptions import NotFound


class Snapshot:
    def __init__(self, ref: "Document", data: dict[str, Any] | None) -> None:
        self.reference, self._data = ref, data
        self.exists = data is not None
        self.id = ref.id

    def to_dict(self) -> dict[str, Any] | None:
        return copy.deepcopy(self._data)


def _merge(target: dict[str, Any], patch: dict[str, Any]) -> None:
    for key, value in patch.items():
        if value is firestore.DELETE_FIELD:
            target.pop(key, None)
        elif isinstance(value, dict) and isinstance(target.get(key), dict):
            _merge(target[key], value)
        elif isinstance(value, dict):
            target[key] = {}
            _merge(target[key], value)
        else:
            target[key] = copy.deepcopy(value)


class Document:
    def __init__(self, client: "FakeClient", path: str) -> None:
        self.client, self.path = client, path
        self.id = path.rsplit("/", 1)[-1]

    def collection(self, name: str) -> "Collection":
        return Collection(self.client, f"{self.path}/{name}")

    def get(self, transaction: Any = None) -> Snapshot:
        self.client.reads += 1
        self.client.read_paths.append(self.path)
        return Snapshot(self, copy.deepcopy(self.client.docs.get(self.path)))

    def set(self, data: dict[str, Any], merge: bool = False) -> None:
        self.client.writes += 1
        if merge:
            _merge(self.client.docs.setdefault(self.path, {}), data)
        else:
            self.client.docs[self.path] = copy.deepcopy(data)

    def update(self, fields: dict[str, Any]) -> None:
        self.client.writes += 1
        if self.path not in self.client.docs:
            raise NotFound(self.path)
        document = self.client.docs[self.path]
        for dotted, value in fields.items():
            *parents, last = dotted.split(".")
            node = document
            for part in parents:
                node = node.setdefault(part, {})
            if value is firestore.DELETE_FIELD:
                node.pop(last, None)
            else:
                node[last] = copy.deepcopy(value)

    def delete(self) -> None:
        self.client.writes += 1
        self.client.docs.pop(self.path, None)


def _matches(data: dict[str, Any], field_filter: Any) -> bool:
    value = data.get(field_filter.field_path)
    target = field_filter.value
    op = field_filter.op_string
    try:
        if op == "==":
            return value == target
        if op == "!=":
            return value != target
        if op == "<":
            return value is not None and value < target
        if op == "<=":
            return value is not None and value <= target
        if op == ">":
            return value is not None and value > target
        if op == ">=":
            return value is not None and value >= target
        if op == "array_contains":
            return isinstance(value, list) and target in value
        if op == "array_contains_any":
            return isinstance(value, list) and any(t in value for t in target)
        if op == "in":
            return value in target
        if op == "not_in":
            return value not in target
    except TypeError:
        return False
    raise ValueError(f"unsupported filter operator {op!r}")


class Query:
    """The chainable query builder the store uses: where/order_by/limit/
    start_after, evaluated over the fake's documents in document-name order."""

    def __init__(
        self,
        collection: "Collection",
        filters: tuple = (),
        limit_count: int | None = None,
        after_id: str | None = None,
        ordering: tuple[tuple[str, str], ...] = (),
    ) -> None:
        self.collection = collection
        self.filters = filters
        self.limit_count = limit_count
        self.after_id = after_id
        self.ordering = ordering

    def where(self, *, filter: Any) -> "Query":
        return Query(
            self.collection, self.filters + (filter,), self.limit_count, self.after_id,
            self.ordering,
        )

    def order_by(self, field: str, direction: str = "ASCENDING") -> "Query":
        return Query(self.collection, self.filters, self.limit_count, self.after_id,
                     self.ordering + ((field, direction),))

    def limit(self, count: int) -> "Query":
        return Query(self.collection, self.filters, count, self.after_id, self.ordering)

    def start_after(self, snapshot: dict) -> "Query":
        return Query(
            self.collection, self.filters, self.limit_count, snapshot["__name__"].id,
            self.ordering,
        )

    def stream(self, transaction: Any = None) -> list[Snapshot]:
        client = self.collection.client
        client.queries += 1
        prefix = self.collection.path + "/"
        rows = [
            (path, data)
            for path, data in sorted(client.docs.items())
            if path.startswith(prefix) and "/" not in path[len(prefix) :]
            and all(_matches(data, f) for f in self.filters)
        ]
        for field, direction in reversed(self.ordering):
            if field != "__name__":
                rows = [row for row in rows if field in row[1]]
                rows.sort(key=lambda row: row[1][field], reverse=direction == "DESCENDING")
        if self.after_id is not None:
            rows = [row for row in rows if row[0].rsplit("/", 1)[-1] > self.after_id]
        if self.limit_count is not None:
            rows = rows[: self.limit_count]
        client.reads += len(rows)
        return [
            Snapshot(Document(client, path), copy.deepcopy(data)) for path, data in rows
        ]


class Collection:
    def __init__(self, client: "FakeClient", path: str) -> None:
        self.client, self.path = client, path
        self.id = path.rsplit("/", 1)[-1]

    def document(self, name: str) -> Document:
        return Document(self.client, f"{self.path}/{name}")

    def where(self, *, filter: Any) -> Query:
        return Query(self).where(filter=filter)

    def order_by(self, field: str, direction: str = "ASCENDING") -> Query:
        return Query(self).order_by(field, direction=direction)

    def limit(self, count: int) -> Query:
        return Query(self, limit_count=count)

    def start_after(self, snapshot: dict) -> Query:
        return Query(self).start_after(snapshot)

    def stream(self, transaction: Any = None) -> list[Snapshot]:
        self.client.queries += 1
        found = [
            Snapshot(Document(self.client, path), copy.deepcopy(data))
            for path, data in sorted(self.client.docs.items())
            if path.startswith(self.path + "/") and "/" not in path[len(self.path) + 1 :]
        ]
        self.client.reads += len(found)
        return found


class Batch:
    def __init__(self, client: "FakeClient") -> None:
        self.client, self.operations = client, []

    def set(self, ref: Document, data: dict[str, Any]) -> None:
        self.operations.append(lambda: ref.set(data))

    def delete(self, ref: Document) -> None:
        self.operations.append(ref.delete)

    def commit(self) -> None:
        for operation in self.operations:
            operation()
        self.operations = []


class Transaction:
    """Stages set/delete calls and applies them on commit, like the real
    client's transaction object the store drives directly."""

    def __init__(self, client: "FakeClient") -> None:
        self.client = client
        self.id = "fake-transaction"
        self.in_progress = False
        self._staged: dict[str, dict[str, Any] | None] = {}

    def _begin(self, retry_id: Any = None) -> None:
        self.in_progress = True

    def set(self, ref: Document, data: dict[str, Any]) -> None:
        self._staged[ref.path] = copy.deepcopy(data)

    def delete(self, ref: Document) -> None:
        self._staged[ref.path] = None

    def _commit(self) -> None:
        for path, data in self._staged.items():
            self.client.writes += 1
            if data is None:
                self.client.docs.pop(path, None)
            else:
                self.client.docs[path] = copy.deepcopy(data)
        self._staged = {}
        self.in_progress = False

    def _rollback(self) -> None:
        self._staged = {}
        self.in_progress = False

    def _clean_up(self) -> None:
        pass


class FakeClient:
    project = "fake"

    def __init__(self) -> None:
        self.docs: dict[str, dict[str, Any]] = {}
        self.reads = 0  # documents read, by get() or by a query
        self.queries = 0
        self.writes = 0
        self.read_paths: list[str] = []

    def collection(self, name: str) -> Collection:
        return Collection(self, name)

    def batch(self) -> Batch:
        return Batch(self)

    def transaction(self) -> Transaction:
        return Transaction(self)

    def get_all(self, refs: list[Document], transaction: Any = None) -> list[Snapshot]:
        return [ref.get(transaction=transaction) for ref in refs]


def query_store(namespace: str = "test", client: FakeClient | None = None):
    from game_platform.query_store import QueryStore

    client = client or FakeClient()
    client.docs.setdefault(f"{namespace}_meta/schema", {"version": 1})
    return QueryStore(client, namespace=namespace)
