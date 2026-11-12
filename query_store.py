"""On-demand Firestore storage, schema 1, in an explicitly isolated namespace.

No startup scans and no background snapshot writer. Service operations run in a
unit of work: reads acquire Firestore transaction versions, writes are buffered
until the operation succeeds, then committed atomically. A conflicting operation
returns a conflict; it is never replayed with uncontrolled external side effects.
Reads outside a unit of work are served by the stale-while-revalidate cache in
read_cache.py (background refresh at most once a second, LRU-evicted at half
the machine's RAM); transactional reads never touch it.
"""

import contextlib
import copy
import datetime as dt
import hashlib
import json
import threading
from dataclasses import replace

from google.api_core.exceptions import Aborted, AlreadyExists, FailedPrecondition
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import TypeAdapter

from game_platform.models import (
    Experiment,
    ExperimentAssignment,
    ExperimentEvent,
    Game,
    GameTestSeeds,
    GameVersionError,
    hash_package_secret,
    import_package_from_legacy_workflow,
    Invite,
    Match,
    Move,
    Feedback,
    User,
    WebPushSubscription,
    Translation,
)
from game_platform.move_history import MoveHistory
from game_platform.observability import timed_external
from game_platform.scaling_library import LibraryEntry
from game_platform.paging import Page, decode_cursor, encode_cursor, page_size
from game_platform.read_cache import ReadCache
from game_platform.translation_bundle import TranslationMemory

TYPES = {
    "translations": Translation,
    "libraries": LibraryEntry,
    "experiments": Experiment,
    "experiment_assignments": ExperimentAssignment,
    "experiment_events": ExperimentEvent,
    "users": User,
    "game_versions": Game,
    "games": Game,
    "matches": Match,
    "invites": Invite,
    "push_subscriptions": WebPushSubscription,
    "game_version_errors": GameVersionError,
    "game_test_seeds": GameTestSeeds,
    "feedback": Feedback,
}
INTERNAL_COLLECTIONS = frozenset(
    {
        "meta",
        "translation_bundles",
        "counters",
        "identities",
        "referrals",
        "endpoints",
        "requests",
        "verifications",
        "verification_limits",
        "jobs",
        "failed_jobs",
        "outbox",
        "cleanup",
        "matchmaking",
        "migration",
        "seed_runs",
        "token_ledger",
        "dashboard_runs",
        "game_popularity",
        "feedback_limits",
        "feedback_targets",
        "game_test_traces",
        "game_proposals",
    }
)
COLLECTIONS = frozenset(TYPES) | INTERNAL_COLLECTIONS
ADAPTERS = {k: TypeAdapter(v) for k, v in TYPES.items()}
MOVE_ADAPTER = TypeAdapter(Move)
SCHEMA = 1
LEGACY_LIMIT = 100


def key(value: str) -> str:
    # Always hash, so user-chosen IDs cannot escape collections or collide with
    # an encoding's reserved prefix. The original id remains in the record.
    return hashlib.sha256(value.encode()).hexdigest()


def conflict(message: str):
    from game_platform.service import ConflictError

    return ConflictError(message)


class _Operation:
    def __init__(self, store):
        self.store = store

    def __enter__(self):
        context = self.store.atomic()
        # A new object is needed for each nested enter, including other threads.
        stack = getattr(self.store._local, "contexts", [])
        entered = context.__enter__()
        stack.append(context)
        self.store._local.contexts = stack
        return entered

    def __exit__(self, *args):
        return self.store._local.contexts.pop().__exit__(*args)


class _CachedSnapshot:
    """A query result snapshot served from the read cache: the reference of
    the document plus its cached payload."""

    __slots__ = ("reference", "_data")

    def __init__(self, reference, data):
        self.reference = reference
        self._data = data

    @property
    def id(self):
        return self.reference.id

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return copy.deepcopy(self._data)


class _BundleBackend:
    """Saves translation bundles (see translation_bundle.py) in this store's namespace."""

    def __init__(self, store, *, ignore_migrated_marker=False):
        self._store = store
        # The migration command reads the old rows even after it has marked them folded.
        self._ignore_marker = ignore_migrated_marker

    @property
    def _bundles(self):
        return self._store.collection("translation_bundles")

    def read_bundles(self):
        # One query for every chunk of every language; never inside a transaction.
        return [doc.to_dict() for doc in self._bundles.stream()]

    def write_entries(self, locale, chunk, puts, deletes):
        from game_platform.translation_bundle import doc_id

        ref = self._bundles.document(doc_id(locale, chunk))
        # merge=True merges the entries map key by key: other entries are untouched, and
        # one write holds both the additions and the removals (DELETE_FIELD).
        entries = {**puts, **{h: firestore.DELETE_FIELD for h in deletes}}
        ref.set({"locale": locale, "chunk": chunk, "entries": entries}, merge=True)

    def read_legacy(self):
        marker = self._store.collection("meta").document("translations").get()
        if marker.exists and marker.to_dict().get("bundled") and not self._ignore_marker:
            return None
        rows = []
        for doc in self._store.collection("translations").stream():
            data = doc.to_dict()
            if data and not data.get("tombstone"):
                rows.append(ADAPTERS["translations"].validate_json(data["json"]))
        return rows

    def delete_legacy(self, locale, source_hash):
        # The old row is simply removed; nothing refers to it.
        self._store.ref("translations", json.dumps([locale, source_hash])).delete()


class QueryStore:
    scalable = True
    last_write_error = None

    def __init__(self, client, *, namespace: str):
        if not namespace or not namespace.replace("_", "").replace("-", "").isalnum():
            raise ValueError("query store requires an explicit alphanumeric namespace")
        self.client = client
        self.namespace = namespace
        self._local = threading.local()
        self.operation_lock = _Operation(self)
        # Non-transactional reads are served by this stale-while-revalidate
        # cache (see read_cache.py); transactional reads always go through
        # their Firestore transaction.
        self._cache = ReadCache()
        self.translation_memory = TranslationMemory(_BundleBackend(self))
        marker = self.collection("meta").document("schema").get()
        if not marker.exists or marker.to_dict().get("version") != SCHEMA:
            raise ValueError(
                "query store namespace is not initialized; run the migration/init command"
            )

    @classmethod
    def initialize(cls, client, *, namespace: str):
        if not namespace or not namespace.replace("_", "").replace("-", "").isalnum():
            raise ValueError("invalid namespace")
        marker = client.collection(namespace + "_meta").document("schema")
        try:
            marker.create({"version": SCHEMA})
            client.collection(namespace + "_meta").document("account_lookups").set(
                {"ready": True}
            )
        except AlreadyExists:
            if marker.get().to_dict().get("version") != SCHEMA:
                raise ValueError("incompatible schema")
        return cls(client, namespace=namespace)

    def collection(self, name):
        return self.client.collection(self.namespace + "_" + name)

    def ref(self, kind, identity):
        return self.collection(kind).document(key(identity))

    @contextlib.contextmanager
    def atomic(self, *, retry_id=None):
        if getattr(self._local, "uow", None) is not None:
            yield
            return
        tx = self.client.transaction()
        tx._begin(retry_id=retry_id)
        uow = {"tx": tx, "reads": {}, "writes": {}, "after": []}
        self._local.uow = uow
        try:
            yield
            if len(uow["writes"]) > 450:
                raise conflict(
                    "operation is too large; use a resumable administrative job"
                )
            for ref, data in uow["writes"].values():
                if data is None:
                    tx.delete(ref)
                else:
                    tx.set(ref, data)
            if uow["writes"]:
                tx._commit()
            else:
                tx._rollback()
        except (Aborted, AlreadyExists, FailedPrecondition) as exc:
            error = conflict("concurrent update; reload and retry")
            error.transaction_id = tx.id
            if isinstance(exc, Aborted):
                # Firestore already aborted this transaction. Preserve its ID
                # for an explicitly retried semantic operation's place in line,
                # matching the SDK transactional wrapper.
                tx._clean_up()
            raise error from exc
        finally:
            try:
                if tx.in_progress:
                    tx._rollback()
            finally:
                self._local.uow = None
        for callback in uow["after"]:
            callback()

    def raw_get(self, ref):
        uow = getattr(self._local, "uow", None)
        if uow:
            if ref.path in uow["writes"]:
                return uow["writes"][ref.path][1]
            if ref.path not in uow["reads"]:
                with timed_external("firestore"):
                    uow["reads"][ref.path] = ref.get(transaction=uow["tx"]).to_dict()
            return uow["reads"][ref.path]
        return self._cache.get_or_fetch(("doc", ref.path), lambda: self._read_doc(ref))

    def _read_doc(self, ref):
        with timed_external("firestore"):
            return ref.get().to_dict()

    def raw_put(self, ref, data):
        if getattr(self._local, "uow", None) is None:
            with self.atomic():
                self.raw_put(ref, data)
            return
        self.raw_get(ref)  # Includes absent documents in the transaction read set.
        self._local.uow["writes"][ref.path] = (ref, data)
        # Write through to the read cache only once the transaction commits
        # (the unit of work runs its after-callbacks solely on success), and
        # drop cached query results for the written document's kind: a cached
        # list cannot be patched precisely, so it is refetched on next use.
        self._local.uow["after"].append(
            lambda path=ref.path, data=data: self._cache_committed(path, data)
        )

    def clear_cache(self):
        """Drop every cached read; the next read of each record refetches
        from Firestore. Used by callers that invalidate cached state
        end-to-end (the live demo's epoch invalidation)."""
        self._cache.clear()

    def _cache_committed(self, path, data):
        self._cache.put(("doc", path), data)
        kind = self._kind_for_path(path)
        if kind is None:
            self._cache.drop_where(lambda k: k[0] == "query")
        else:
            self._cache.drop_where(lambda k: k[0] == "query" and k[1] == kind)

    def _kind_for_path(self, path):
        prefix = self.namespace + "_"
        for segment in path.split("/"):
            if segment.startswith(prefix) and segment[len(prefix) :] in COLLECTIONS:
                return segment[len(prefix) :]
        return None

    def close(self):
        self._cache.close()

    def put_experiment(self, experiment):
        self._put("experiments", experiment.id, experiment)

    # Translations are kept in memory, loaded from one document per language (see
    # translation_bundle.py): a lookup never reads the database, and none of these
    # methods uses a transaction.
    def get_translations(self, locale, source_hashes):
        return self.translation_memory.get(locale, source_hashes)

    def put_translations(self, translations):
        self.translation_memory.put(list(translations))

    def delete_translation(self, locale, source_hash):
        self.translation_memory.delete(locale, source_hash)

    def record_game_match_start(self, game_id, player_count):
        """Adds one started match's player count to its durable popularity score.

        Called inside the match-start unit of work, so a match transition and its
        score update commit together. One small aggregate document per game keeps
        the browse query bounded regardless of match history size.
        """
        if type(player_count) is not int or player_count < 1:
            raise ValueError("player_count must be a positive integer")
        ref = self.collection("game_popularity").document(key(game_id))
        current = self.raw_get(ref) or {
            "game_id": game_id,
            "matches_started": 0,
            "score": 0,
        }
        self.raw_put(
            ref,
            {
                "game_id": game_id,
                "matches_started": current.get("matches_started", 0) + 1,
                "score": current.get("score", 0) + player_count,
            },
        )

    def list_popular_game_ids(self, limit):
        def fetch():
            query = self.collection("game_popularity").order_by(
                "score", direction="DESCENDING"
            ).limit(limit)
            with timed_external("firestore"):
                rows = list(query.stream())
            return [
                (data["game_id"], data["score"])
                for row in rows
                if (data := row.to_dict()) and data.get("score", 0) > 0
            ]

        if getattr(self._local, "uow", None) is not None:
            return fetch()
        # Use the same bounded, background-refreshed cache as other queries.
        # Committed popularity writes invalidate this key immediately.
        return self._cache.get_or_fetch(("query", "game_popularity", "ranking", limit), fetch)

    def game_popularity_score(self, game_id):
        data = self.raw_get(self.collection("game_popularity").document(key(game_id)))
        return int(data.get("score", 0)) if data else 0

    def list_translations(self, locale=None):
        return sorted(
            self.translation_memory.list(locale),
            key=lambda row: (row.locale, row.source_hash),
        )

    def list_experiments(self):
        return self._list("experiments")

    def put_experiment_assignment(self, assignment):
        self._put(
            "experiment_assignments",
            json.dumps([assignment.user_id, assignment.experiment_id]),
            assignment,
        )

    def get_experiment_assignment(self, *, user_id, experiment_id):
        return self._get("experiment_assignments", json.dumps([user_id, experiment_id]))

    def list_experiment_assignments(self):
        return self._list("experiment_assignments")

    def delete_experiment_assignment(self, *, user_id, experiment_id):
        self._delete("experiment_assignments", json.dumps([user_id, experiment_id]))

    def put_experiment_event(self, event):
        self._put("experiment_events", event.id, event)

    def list_experiment_events(self):
        return self._list("experiment_events")

    def delete_experiment_event(self, event_id):
        self._delete("experiment_events", event_id)

    def experiment_signups(self, user_ids, experiment_id):
        return [
            event
            for uid in user_ids
            for event in self._list(
                "experiment_events",
                [
                    ("user_id", "==", uid),
                    ("experiment_id", "==", experiment_id),
                    ("kind", "==", "signup"),
                ],
            )
        ]

    # Feedback. Sending one reads the caller, their daily-limit document, the target and
    # the target's counters in one batch, then writes the feedback, the limit document
    # and the counters in one commit: no queries. A feedback document's name starts with
    # its inverted update time, so the admin listing is one query, newest first.

    @staticmethod
    def _feedback_doc(feedback):
        millis = int(feedback.updated_at.timestamp() * 1000)
        return f"{10**13 - millis:013d}_{key(feedback.id)[:24]}"

    def _feedback_target_ref(self, target_type, target_id):
        return self.ref("feedback_targets", json.dumps([target_type, target_id]))

    def _get_all(self, refs):
        """Reads every ref in [refs] in one batched round trip (inside atomic)."""
        uow = self._local.uow
        missing = {
            ref.path: ref
            for ref in refs
            if ref.path not in uow["writes"] and ref.path not in uow["reads"]
        }
        if missing:
            with timed_external("firestore"):
                for snapshot in self.client.get_all(
                    list(missing.values()), transaction=uow["tx"]
                ):
                    uow["reads"][snapshot.reference.path] = snapshot.to_dict()
            for path in missing:
                uow["reads"].setdefault(path, None)
        return [self.raw_get(ref) for ref in refs]

    def feedback_inputs(self, caller_id, target_type, target_id):
        """(caller, target record, the caller's feedback in their limit document, the
        target's counters), read in one batch. Call inside atomic."""
        collection = {"user": "users", "game": "games", "match": "matches"}.get(target_type)
        refs = [
            self.ref("users", caller_id),
            self.ref("feedback_limits", caller_id),
            self._feedback_target_ref(target_type, target_id),
        ]
        if collection and target_id:
            refs.append(self.ref(collection, target_id))
        caller, limits, stats, *target = self._get_all(refs)
        record = (
            self._decode(collection, target[0], refs[3], detail=False) if target else None
        )
        return (
            self._decode("users", caller, refs[0]),
            record,
            (limits or {}).get("entries", []),
            stats,
        )

    def save_feedback(self, feedback, *, entries, replaced_doc=None, new=True):
        """Writes [feedback], the caller's limit document with [entries] (the feedback
        they sent in the last 24 hours, this one included) and, when [new], the target's
        counters. [replaced_doc] is the document of the message it replaces."""
        uow = self._local.uow
        doc = self._feedback_doc(feedback)
        if replaced_doc and replaced_doc != doc:
            old = self.collection("feedback").document(replaced_doc)
            uow["writes"][old.path] = (old, None)
        ref = self.collection("feedback").document(doc)
        # A fresh, unique name: nothing to read first.
        uow["writes"][ref.path] = (ref, self._feedback_data(feedback))
        self.raw_put(
            self.ref("feedback_limits", feedback.reporter_user_id),
            {"entries": [{**entry, "doc": entry.get("doc") or doc} for entry in entries]},
        )
        if new:
            self._count_feedback(feedback)
        return doc

    def _feedback_data(self, feedback):
        return {
            "json": ADAPTERS["feedback"].dump_json(feedback).decode(),
            **{
                name: getattr(feedback, name)
                for name in ("id", "kind", "target_type", "target_id", "status", "reporter_user_id")
            },
        }

    def _count_feedback(self, feedback):
        ref = self._feedback_target_ref(feedback.target_type, feedback.target_id)
        stats = dict(self.raw_get(ref) or {"bug": 0, "suggestion": 0, "problem": 0})
        stats.update(
            target_type=feedback.target_type,
            target_id=feedback.target_id,
            target_name=feedback.target_name or stats.get("target_name", ""),
        )
        stats[feedback.kind] = stats.get(feedback.kind, 0) + 1
        if feedback.kind == "problem":
            stats["last_reported_at"] = feedback.created_at
        self.raw_put(ref, stats)

    def put_feedback(self, feedback):
        """Saves one feedback message and counts it (used when migrating data)."""
        with self.atomic():
            ref = self.collection("feedback").document(self._feedback_doc(feedback))
            self.raw_put(ref, self._feedback_data(feedback))
            self._count_feedback(feedback)

    def set_feedback_status(self, feedback_id, *, status, changed_by, at):
        """Changes one feedback's status (recording who and when) and returns it, or None
        if there's no such feedback: one query by id inside the transaction, one write."""
        with self.atomic():
            docs = self._query("feedback", [("id", "==", feedback_id)], limit=1)
            if not docs:
                return None
            doc = docs[0]
            data = doc.to_dict()
            # The query already read it: count it in the transaction's reads, so the
            # write doesn't read it again.
            self._local.uow["reads"].setdefault(doc.reference.path, data)
            feedback = self._decode("feedback", data, doc.reference)
            if feedback is None:
                return None
            feedback = replace(
                feedback, status=status, status_changed_by=changed_by, status_changed_at=at
            )
            self.raw_put(doc.reference, self._feedback_data(feedback))
        return feedback

    def list_feedback(self):
        """Legacy bounded listing; the admin listing uses [feedback_page]."""
        return self._list("feedback")

    def feedback_page(self, *, filters=(), limit):
        """The newest [limit] feedback messages matching [filters], in one query."""
        return [
            record
            for doc in self._query("feedback", filters, limit=limit)
            if (record := self._decode("feedback", doc.to_dict(), doc.reference)) is not None
        ]

    def most_reported(self, *, limit=20):
        """The [limit] targets with the most "problem" feedback, in one query."""
        query = (
            self.collection("feedback_targets")
            .order_by("problem", direction="DESCENDING")
            .limit(limit)
        )
        with timed_external("firestore"):
            return [doc.to_dict() for doc in query.stream()]

    def flush(self):
        pass  # Every successful operation has already committed.

    def _query(self, kind, filters=(), *, limit=101, after=None):
        uow = getattr(self._local, "uow", None)
        if uow is not None:
            return self._run_query(
                kind, filters, limit=limit, after=after, transaction=uow["tx"]
            )
        try:
            cache_key = ("query", kind, tuple(filters), limit, after)
            hash(cache_key)
        except TypeError:
            return self._run_query(
                kind, filters, limit=limit, after=after, transaction=None
            )
        rows = self._cache.get_or_fetch(
            cache_key,
            lambda: [
                (doc.id, doc.to_dict())
                for doc in self._run_query(
                    kind, filters, limit=limit, after=after, transaction=None
                )
            ],
        )
        collection = self.collection(kind)
        return [
            _CachedSnapshot(collection.document(doc_id), data)
            for doc_id, data in rows
        ]

    def _run_query(self, kind, filters, *, limit, after, transaction):
        query = self.collection(kind)
        for field, op, value in filters:
            query = query.where(filter=FieldFilter(field, op, value))
        query = query.order_by("__name__")
        if after:
            query = query.start_after(
                {"__name__": self.collection(kind).document(after)}
            )
        with timed_external("firestore"):
            return list(query.limit(limit).stream(transaction=transaction))

    def page(self, kind, *, filters=(), limit=50, cursor=None, scope=None):
        page_size(limit)
        scope = [self.namespace, kind, list(filters), scope]
        after = decode_cursor(scope, cursor)
        if kind == "translations":
            rows = [
                row
                for row in self.list_translations(
                    next((value for field, _, value in filters if field == "locale"), None)
                )
                if f"{row.locale}@{row.source_hash}" > (after or "")
            ]
            return Page(
                rows[:limit],
                encode_cursor(scope, f"{rows[limit - 1].locale}@{rows[limit - 1].source_hash}")
                if len(rows) > limit
                else None,
            )
        docs = self._query(kind, filters, limit=limit + 1, after=after)
        items = [
            self._decode(kind, doc.to_dict(), doc.reference, detail=False)
            for doc in docs[:limit]
        ]
        return Page(
            [x for x in items if x is not None],
            encode_cursor(scope, docs[limit - 1].id) if len(docs) > limit else None,
        )

    def _collect(self, kind, filters, docs, *, detail=True, seen=None):
        """Decoded records for [docs], with this unit of work's staged writes
        merged in. [seen], when given, holds the document paths already emitted
        (paged reads) or staged (their committed version must not reappear)."""
        rows = {}
        for doc in docs:
            if seen is not None:
                if doc.reference.path in seen:
                    continue
                seen.add(doc.reference.path)
            rows[doc.reference.path] = (doc.reference, doc.to_dict())
        uow = getattr(self._local, "uow", None)
        if uow:
            prefix = self.collection(kind).id + "/"
            for path, (ref, data) in uow["writes"].items():
                if not path.startswith(prefix) or "/" in path[len(prefix) :]:
                    continue
                if seen is not None:
                    if path in seen:
                        continue
                    seen.add(path)
                rows.pop(path, None)
                if data and all(
                    data.get(field) == value
                    if op == "=="
                    else value in (data.get(field) or [])
                    for field, op, value in filters
                ):
                    rows[path] = (ref, data)
        return [
            record
            for ref, data in rows.values()
            if (record := self._decode(kind, data, ref, detail=detail)) is not None
        ]

    def _list(self, kind, filters=()):
        """At most LEGACY_LIMIT records: a safety rail for callers that have not
        moved to bounded reads. Callers that legitimately need every match use
        _list_all."""
        docs = self._query(kind, filters, limit=LEGACY_LIMIT + 1)
        if len(docs) > LEGACY_LIMIT:
            raise conflict(
                "result exceeds 100 records; use the paginated API or an administrative job"
            )
        rows = self._collect(kind, filters, docs)
        if len(rows) > LEGACY_LIMIT:
            raise conflict(
                "result exceeds 100 records; use the paginated API or an administrative job"
            )
        return rows

    def _list_all(self, kind, filters=(), *, detail=True):
        """Every matching record, read in bounded pages: each Firestore query
        fetches at most LEGACY_LIMIT documents, so the store never streams a
        whole collection in one read. The decoded result is the caller's own
        payload (a catalog, one user's matches), not a dataset snapshot."""
        records = []
        seen: set[str] = set()
        after = None
        while True:
            docs = self._query(kind, filters, limit=LEGACY_LIMIT, after=after)
            records.extend(
                self._collect(kind, filters, docs, detail=detail, seen=seen)
            )
            if len(docs) < LEGACY_LIMIT:
                return records
            after = docs[-1].id

    def _decode(self, kind, data, ref, *, detail=True):
        if data is None or data.get("tombstone"):
            return None
        record = ADAPTERS[kind].validate_json(data["json"])
        if kind in ("games", "game_versions") and detail:
            chunks = data.get("body_chunks", 0)
            body = "".join(
                self.raw_get(ref.collection("body").document(f"{i:06}"))["text"]
                for i in range(chunks)
            )
            if body:
                record = replace(record, **json.loads(body))
        if kind in ("games", "game_versions"):
            # Records written before the Builder deletion carry the old builder
            # workflow instead of an import package; convert on read.
            legacy = json.loads(data["json"]).get("builder_workflow")
            if legacy and record.import_package is None:
                record = replace(record, import_package=import_package_from_legacy_workflow(legacy))
            if record.import_package:
                # Packages written before the hash-only change carry the
                # resubmission secret itself; normalize on read (the record
                # is serialized in hash form on its next save).
                normalized = hash_package_secret(record.import_package)
                if normalized is not record.import_package:
                    record = replace(record, import_package=normalized)
        if kind == "matches":
            count = data.get("move_count", 0)
            record = replace(
                record,
                moves=MoveHistory(count, lambda a, b: self._read_moves(ref, a, b)),
            )
        return record

    def _get(self, kind, identity, *, detail=True):
        ref = self.ref(kind, identity)
        return self._decode(kind, self.raw_get(ref), ref, detail=detail)

    def _put(self, kind, identity, record, **fields):
        with self.atomic():
            ref = self.ref(kind, identity)
            old = self.raw_get(ref)
            if kind in ("games", "game_versions"):
                body = json.dumps(
                    {"code": record.code, "server_code": record.server_code}
                )
                parts = [body[i : i + 180000] for i in range(0, len(body), 180000)]
                if len(parts) > 40:
                    raise ValueError("game code exceeds storage size limit")
                for i, part in enumerate(parts):
                    self.raw_put(
                        ref.collection("body").document(f"{i:06}"), {"text": part}
                    )
                for i in range(len(parts), (old or {}).get("body_chunks", 0)):
                    self.raw_put(ref.collection("body").document(f"{i:06}"), None)
                fields["body_chunks"] = len(parts)
                record = replace(record, code="", server_code=None)
            payload = ADAPTERS[kind].dump_json(record).decode()
            if len(payload.encode()) > 800000:
                raise ValueError(
                    "record exceeds 800 KB; split growing content into child records"
                )
            metadata = {
                name: getattr(record, name)
                for name in (
                    "owner_user_id",
                    "user_id",
                    "game_id",
                    "game_version",
                    "status",
                    "created_by_user_id",
                    "match_id",
                    "published",
                    "deleted",
                    "experiment_id",
                    "variant_id",
                    "kind",
                    "occurred_at",
                    "locale",
                )
                if hasattr(record, name)
            }
            data = {
                "json": payload,
                "revision": (old or {}).get("revision", 0) + 1,
                **metadata,
                **fields,
            }
            if kind == "games":
                import re

                words = set(
                    re.findall(
                        r"\w+", (record.name + " " + record.description).casefold()
                    )
                )
                data["search_tokens"] = sorted(
                    {w[:n] for w in words for n in range(2, min(len(w), 24) + 1)}
                )[:1000]
            self._update_counts(kind, identity, old, data)
            self.raw_put(ref, data)

    @staticmethod
    def _counts(kind, data):
        if not data or data.get("tombstone"):
            return {}
        result = {kind + "_total": 1}
        if kind == "matches":
            result["matches_" + data["status"]] = 1
            result["moves_total"] = data.get("move_count", 0)
        if kind == "games":
            result["games_deleted" if data.get("deleted") else "games_live"] = 1
        return result

    def _update_counts(self, kind, identity, old, new):
        before, after = self._counts(kind, old), self._counts(kind, new)
        delta = {
            k: after.get(k, 0) - before.get(k, 0) for k in before.keys() | after.keys()
        }
        delta = {k: v for k, v in delta.items() if v}
        if not delta:
            return
        ref = self.collection("counters").document(str(int(key(identity)[:8], 16) % 64))
        counts = self.raw_get(ref) or {}
        for name, value in delta.items():
            counts[name] = counts.get(name, 0) + value
        counts["updated_at"] = dt.datetime.now(dt.timezone.utc)
        self.raw_put(ref, counts)

    def counts(self):
        result = {}
        for document in self.collection("counters").limit(64).stream():
            for name, value in document.to_dict().items():
                if name != "updated_at":
                    result[name] = result.get(name, 0) + value
        return result

    def _delete(self, kind, identity):
        # Tombstones allow bounded deletion; children are cleaned by maintenance.
        with self.atomic():
            ref = self.ref(kind, identity)
            self._update_counts(kind, identity, self.raw_get(ref), None)
            self.raw_put(ref, {"tombstone": True})
            self.raw_put(
                self.ref("cleanup", kind + ":" + identity),
                {
                    "path": ref.path,
                    "kind": kind,
                    "identity": identity,
                    "created_at": dt.datetime.now(dt.timezone.utc),
                },
            )

    def _read_moves(self, ref, start, stop):
        if stop <= start:
            return []
        if stop - start > 100:
            return [
                move
                for a in range(start, stop, 100)
                for move in self._read_moves(ref, a, min(a + 100, stop))
            ]
        refs = [
            ref.collection("moves").document(f"{i:012}") for i in range(start, stop)
        ]
        uow = getattr(self._local, "uow", None)
        if uow is None:
            # Moves are immutable once written, so the read cache serves them
            # in one batch; only cache misses reach Firestore (one get_all).
            by_path = {r.path: r for r in refs}
            values = self._cache.get_or_fetch_many(
                [("doc", r.path) for r in refs],
                lambda keys: {
                    ("doc", snap.reference.path): snap.to_dict()
                    for snap in self.client.get_all(
                        [by_path[path] for _, path in keys]
                    )
                },
            )
            result = []
            for move_ref in refs:
                data = values[("doc", move_ref.path)]
                if data is None:
                    raise RuntimeError("missing persisted move")
                result.append(MOVE_ADAPTER.validate_json(data["json"]))
            return result
        pending = [
            r
            for r in refs
            if not uow or (r.path not in uow["writes"] and r.path not in uow["reads"])
        ]
        fetched = (
            {
                snap.reference.path: snap.to_dict()
                for snap in self.client.get_all(
                    pending, transaction=uow["tx"] if uow else None
                )
            }
            if pending
            else {}
        )
        if uow:
            uow["reads"].update(fetched)
        result = []
        for move_ref in refs:
            data = (
                uow["writes"][move_ref.path][1]
                if uow and move_ref.path in uow["writes"]
                else uow["reads"].get(move_ref.path)
                if uow
                else fetched.get(move_ref.path)
            )
            if data is None:
                raise RuntimeError("missing persisted move")
            result.append(MOVE_ADAPTER.validate_json(data["json"]))
        return result

    def put_match(self, match):
        with self.atomic():
            ref = self.ref("matches", match.id)
            old = self.raw_get(ref) or {}
            previous = old.get("move_count", 0)
            if isinstance(match.moves, MoveHistory):
                if match.moves.persisted_count != previous:
                    raise conflict("match history changed; reload and retry")
                new_moves = match.moves.appended
            else:
                if previous and len(match.moves) < previous:
                    raise conflict("cannot truncate persisted history")
                new_moves = match.moves[previous:]
            for index, move in enumerate(new_moves, previous):
                self.raw_put(
                    ref.collection("moves").document(f"{index:012}"),
                    {"json": MOVE_ADAPTER.dump_json(move).decode()},
                )
            participants = sorted({match.owner_user_id, *match.human_user_ids})
            game = self.get_game_version(match.game_id, match.game_version)
            joinable = not match.private and not match.num_computer_opponents and (
                match.status == "waiting_for_players"
                or (
                    match.status == "ongoing"
                    and game is not None
                    and game.rules.allows_join_mid_match
                )
            )
            self._put(
                "matches",
                match.id,
                replace(match, moves=()),
                move_count=len(match.moves),
                participants=participants,
                historical_participants=sorted(
                    set(old.get("historical_participants", ()))
                    | set(participants)
                    | set(match.hidden_for_user_ids)
                    | {m.made_by_user_id for m in new_moves if m.made_by_user_id}
                ),
                visible_to=[
                    u for u in participants if u not in match.hidden_for_user_ids
                ],
                private=match.private,
                joinable=joinable,
                matchmaking_player_count=match.matchmaking_player_count,
            )

    def get_match(self, match_id):
        return self._get("matches", match_id)

    def delete_match(self, match_id):
        self._delete("matches", match_id)

    def list_matches_involving(self, user_id):
        return self._list_all("matches", [("participants", "array_contains", user_id)])

    def list_matches_for_game(self, game_id):
        """All matches played with [game_id], oldest first, paging past the
        100-record legacy cap (a popular game can have more matches than that)."""
        matches = []
        cursor = None
        while True:
            page = self.page(
                "matches",
                filters=[("game_id", "==", game_id)],
                limit=100,
                cursor=cursor,
            )
            matches.extend(page.items)
            cursor = page.next_cursor
            if not cursor:
                # The paged query returns document-id order, not creation
                # order, so the "oldest first" contract needs an explicit
                # sort (a query without order_by is unordered in Firestore,
                # which made this test flaky: the two matches' ids sorted
                # the other way round).
                return sorted(matches, key=lambda m: m.created_at)

    def list_matches_by_status(self, status):
        """Every match with [status], read in bounded pages; scalable clients
        that only need a page use the paged v2 API instead."""
        return self._list_all("matches", [("status", "==", status)])

    def list_all_matches(self):
        return self._list("matches")

    def _reserve(self, namespace, identity, user_id):
        ref = self.ref(namespace, identity)
        old = self.raw_get(ref)
        if old and old.get("user_id") != user_id:
            raise conflict("identity is already reserved")
        self.raw_put(ref, {"user_id": user_id})

    def reserve_referral(self, user_id):
        import secrets

        code = secrets.token_hex(8)
        self._reserve("referrals", code, user_id)
        return code

    def user_for_referral(self, code):
        value = self.raw_get(self.ref("referrals", code))
        return value.get("user_id") if value else None

    def find_linked_account(self, kind, identifier):
        value = self.raw_get(self.ref("identities", json.dumps([kind, identifier])))
        return self.get_user(value["user_id"]) if value else None

    def put_user(self, user):
        with self.atomic():
            previous = self.raw_get(self.ref("users", user.id))
            old_balance = (
                ADAPTERS["users"].validate_json(previous["json"]).token_balance
                if previous and not previous.get("tombstone")
                else 0
            )
            if not previous or old_balance != user.token_balance:
                revision = (previous or {}).get("revision", 0) + 1
                self.raw_put(
                    self.ref("token_ledger", f"{user.id}:{revision}"),
                    {
                        "user_id": user.id,
                        "revision": revision,
                        "amount": user.token_balance - old_balance,
                        "balance": user.token_balance,
                        "created_at": dt.datetime.now(dt.timezone.utc),
                    },
                )
            if user.referral_code:
                self._reserve("referrals", user.referral_code, user.id)
            for account in user.linked_accounts:
                self._reserve(
                    "identities",
                    json.dumps([account.kind, account.identifier]),
                    user.id,
                )
            self._put(
                "users",
                user.id,
                user,
                invited_by_user_id=user.invited_by_user_id,
                replaced_by_user_id=user.replaced_by_user_id,
            )

    def has_game_membership(self, user_id, game_id, version):
        return bool(
            self._query(
                "matches",
                [
                    ("participants", "array_contains", user_id),
                    ("game_id", "==", game_id),
                    ("game_version", "==", version),
                ],
                limit=1,
            )
        )

    def health(self):
        """A bounded live read, not the status of a nonexistent background saver."""
        try:
            marker = self.collection("meta").document("schema").get(timeout=5)
            return (
                None
                if marker.exists and marker.to_dict().get("version") == SCHEMA
                else "storage schema unavailable"
            )
        except Exception:
            return "storage database unavailable"

    def get_user(self, user_id):
        return self._get("users", user_id)

    def list_users(self):
        return self._list("users")

    def delete_user(self, user_id):
        self._delete("users", user_id)

    def add_game_version(self, game):
        with self.atomic():
            current = self.get_game(game.id)
            if game.version != (current.version + 1 if current else 1):
                raise conflict("game version changed; reload and retry")
            self._put("game_versions", f"{game.id}@{game.version}", game)
            self._put("games", game.id, game)

    def put_game_version(self, game):
        with self.atomic():
            self._put("game_versions", f"{game.id}@{game.version}", game)
            current = self.get_game(game.id)
            if current is None or current.version == game.version:
                self._put("games", game.id, game)

    def get_game(self, game_id):
        return self._get("games", game_id)

    def get_game_without_code(self, game_id):
        """Current game metadata for summaries, without reading code chunks."""
        return self._get("games", game_id, detail=False)

    def get_game_version(self, game_id, version):
        return self._game_version(game_id, version, detail=True)

    def prefetch_game_versions(self, versions):
        """Prime read caches for a bounded match page without per-row round trips.

        Full spectator views still run through the usual permission/projection
        path. Only the same immutable code and visibility reads are batched.
        """
        if getattr(self._local, "uow", None) is not None:
            return  # Transactional readers must retain their own snapshot.
        versions = set(versions)
        refs = [self.ref("game_versions", f"{game_id}@{version}")
                for game_id, version in versions]
        metadata = self._prefetch_refs(refs + [self.ref("games", game_id)
                                             for game_id, _ in versions])
        bodies = [ref.collection("body").document(f"{chunk:06}")
                  for ref in refs
                  for chunk in range((metadata.get(("doc", ref.path)) or {}).get("body_chunks", 0))]
        self._prefetch_refs(bodies)

    def _prefetch_refs(self, refs):
        refs_by_key = {("doc", ref.path): ref for ref in refs}
        if not refs_by_key:
            return {}

        def fetch(keys):
            found = {}
            for offset in range(0, len(keys), 100):
                with timed_external("firestore"):
                    for snapshot in self.client.get_all(
                        [refs_by_key[key] for key in keys[offset:offset + 100]]
                    ):
                        found[("doc", snapshot.reference.path)] = snapshot.to_dict()
            return {key: found.get(key) for key in keys}

        return self._cache.get_or_fetch_many(refs_by_key, fetch)

    def get_game_version_without_code(self, game_id, version):
        """Cover metadata, with current visibility, without any code-chunk reads."""
        return self._game_version(game_id, version, detail=False)

    def _game_version(self, game_id, version, *, detail):
        game = self._get("game_versions", f"{game_id}@{version}", detail=detail)
        # Only the current visibility flags are needed, even for a full version.
        current = self._get("games", game_id, detail=False)
        return (
            replace(game, deleted=current.deleted, published=current.published)
            if game and current
            else game
        )

    def list_games(self, *, owner_user_id=None, include_unpublished=False):
        filters = [("deleted", "==", False)]
        if owner_user_id is not None:
            filters.append(("owner_user_id", "==", owner_user_id))
        if not include_unpublished:
            filters.append(("published", "==", True))
        return self._list_all("games", filters)

    def list_games_without_code(self, *, owner_user_id=None, include_unpublished=False):
        """Like [list_games], but the games have no code: paged queries and no body reads."""
        filters = [("deleted", "==", False)]
        if owner_user_id is not None:
            filters.append(("owner_user_id", "==", owner_user_id))
        if not include_unpublished:
            filters.append(("published", "==", True))
        return self._list_all("games", filters, detail=False)

    def list_all_game_versions(self):
        return self._list("game_versions")

    def set_game_published(self, game_id, published):
        with self.atomic():
            game = self.get_game(game_id)
            if game:
                self._put("games", game_id, replace(game, published=published))

    def delete_game(self, game_id):
        with self.atomic():
            game = self.get_game(game_id)
            if game:
                self._put("games", game_id, replace(game, deleted=True))

    def delete_game_version(self, game_id, version, *, allow_latest=False):
        """Deletes one game_versions/<id>@<version> document (tombstoned; its
        body chunks are cleaned by maintenance, like other deletions). Refuses
        (ValueError) when the version does not exist, when it is the latest
        version unless [allow_latest] is set, and when any match still pins
        that (game_id, version) — callers must delete those matches first.
        Deleting the latest version repoints games/<id> at the previous
        surviving version, or tombstones it when none survives."""
        with self.atomic():
            game = self.get_game_version(game_id, version)
            if game is None:
                raise ValueError(f"no such game version: {game_id}@{version}")
            current = self.get_game(game_id)
            is_latest = current is not None and version == current.version
            if is_latest and not allow_latest:
                raise ValueError(
                    f"refusing to delete the latest version {game_id}@{version}; "
                    "pass allow_latest=True to delete it"
                )
            pinned = self._query(
                "matches",
                [("game_id", "==", game_id), ("game_version", "==", version)],
                limit=1,
            )
            if pinned:
                raise ValueError(
                    f"refusing to delete {game_id}@{version}: pinned by a match; "
                    "delete the matches first"
                )
            self._delete("game_versions", f"{game_id}@{version}")
            if is_latest:
                previous = None
                for earlier in range(version - 1, 0, -1):
                    previous = self.get_game_version(game_id, earlier)
                    if previous is not None:
                        break
                if previous is not None:
                    self._put("games", game_id, previous)
                else:
                    self._delete("games", game_id)

    def put_invite(self, invite):
        self._put(
            "invites",
            invite.token,
            invite,
            participants=sorted(
                {invite.created_by_user_id, *(a.user_id for a in invite.acceptances)}
            ),
        )

    def get_invite(self, token):
        return self._get("invites", token)

    def delete_invite(self, token):
        self._delete("invites", token)

    def list_invites(self, *, created_by_user_id=None, match_id=None):
        return self._list_all(
            "invites",
            [
                (k, "==", v)
                for k, v in {
                    "created_by_user_id": created_by_user_id,
                    "match_id": match_id,
                }.items()
                if v is not None
            ],
        )

    def add_game_version_error(self, error):
        self._put("game_version_errors", error.id, error)

    def list_game_version_errors(self, *, game_id, version):
        return self._list(
            "game_version_errors",
            [("game_id", "==", game_id), ("game_version", "==", version)],
        )

    def put_game_test_seeds(self, record):
        self._put("game_test_seeds", record.game_id, record)

    def get_game_test_seeds(self, game_id):
        return self._get("game_test_seeds", game_id)

    def list_game_test_seeds(self):
        return self._list("game_test_seeds")

    def put_push_subscription(self, subscription):
        with self.atomic():
            old = self.get_push_subscription_by_endpoint(subscription.endpoint)
            if old and old.id != subscription.id:
                self._delete("push_subscriptions", old.id)
            self.raw_put(
                self.ref("endpoints", subscription.endpoint), {"id": subscription.id}
            )
            self._put("push_subscriptions", subscription.id, subscription)

    def get_push_subscription(self, subscription_id):
        return self._get("push_subscriptions", subscription_id)

    def get_push_subscription_by_endpoint(self, endpoint):
        record = self.raw_get(self.ref("endpoints", endpoint))
        return self.get_push_subscription(record["id"]) if record else None

    def list_push_subscriptions(self, *, user_id):
        return self._list("push_subscriptions", [("user_id", "==", user_id)])

    def delete_push_subscription(self, subscription_id):
        with self.atomic():
            record = self.get_push_subscription(subscription_id)
            if record:
                self.raw_put(self.ref("endpoints", record.endpoint), None)
            self._delete("push_subscriptions", subscription_id)

    def delete_push_subscription_by_endpoint(self, endpoint):
        record = self.get_push_subscription_by_endpoint(endpoint)
        if record:
            self.delete_push_subscription(record.id)
