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


class Collection:
    def __init__(self, client: "FakeClient", path: str) -> None:
        self.client, self.path = client, path
        self.id = path.rsplit("/", 1)[-1]

    def document(self, name: str) -> Document:
        return Document(self.client, f"{self.path}/{name}")

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


def query_store(namespace: str = "test", client: FakeClient | None = None):
    from game_platform.query_store import QueryStore

    client = client or FakeClient()
    client.docs.setdefault(f"{namespace}_meta/schema", {"version": 1})
    return QueryStore(client, namespace=namespace)
