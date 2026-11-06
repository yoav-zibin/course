"""Machine translations, kept as one bundle per language.

A translation used to be one Firestore document per (language, hash of the source text), so a
page that needed fifty texts made fifty reads. Now a language's translations live together:
a document `translation_bundles/<language>-<n>` holds a map from the hash of the source text to
its translation, and the server loads them all at once into memory ([TranslationMemory]).
Lookups then never touch the database.

    translation_bundles/es-000 = {
        "locale": "es", "chunk": 0,
        "entries": {"<hash>": {"t": "Tu turno", "s": "Your turn", "p": "google",
                               "c": "2026-10-30T12:00:00+00:00", "r": false}, ...}}

An entry also keeps the source text, the provider and the review flag, so the backoffice can
list and correct translations. A document holds at most 1 MiB, so a language that grows past
[MAX_CHUNK_BYTES] spills into `es-001`, `es-002`, ...; the server reads every chunk of every
language with one query of the collection.

Writes change only the entries they touch (one merge-set that adds entries and removes the
deleted ones with DELETE_FIELD), so concurrent requests never overwrite each other's entries and no
transaction is needed. The memory is updated in place after a write, and re-read from the
database after [ttl] seconds, which is how a second server process catches up.

Before the bundles existed, rows were saved one per hash (the `translations` collection).
While the migration has not been run, those rows are read once at startup as a fallback;
`python -m game_platform.tools.migrate_translation_bundles` folds them into bundles.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import threading
import time
from collections.abc import Callable, Iterable, Sequence
from typing import Any, Final, Protocol

from game_platform.models import Translation

logger = logging.getLogger(__name__)

# Well under Firestore's 1 MiB document limit (strings are counted in UTF-8 bytes).
MAX_CHUNK_BYTES: Final = 600_000
DEFAULT_TTL_SECONDS: Final = 60.0
# After a failed read, wait this long before trying again; the old copy is served meanwhile.
RETRY_SECONDS: Final = 5.0


def doc_id(locale: str, chunk: int) -> str:
    return f"{locale}-{chunk:03d}"


def entry_of(translation: Translation) -> dict[str, Any]:
    return {
        "t": translation.text,
        "s": translation.source,
        "p": translation.provider,
        "c": translation.created_at.isoformat(),
        "r": translation.reviewed,
    }


def translation_of(locale: str, source_hash: str, entry: dict[str, Any]) -> Translation:
    return Translation(
        locale=locale,
        source_hash=source_hash,
        source=entry.get("s", ""),
        text=entry["t"],
        provider=entry.get("p", "google"),
        created_at=dt.datetime.fromisoformat(entry["c"]),
        reviewed=bool(entry.get("r", False)),
    )


def entry_size(source_hash: str, entry: dict[str, Any]) -> int:
    return len(source_hash) + len(json.dumps(entry, ensure_ascii=False).encode()) + 8


def pack(translations: Iterable[Translation]) -> dict[str, dict[str, Any]]:
    """The bundle documents ({document id: fields}) holding [translations]."""
    chunks: dict[str, tuple[int, dict[str, dict[str, Any]]]] = {}
    documents: dict[str, dict[str, Any]] = {}
    for translation in sorted(translations, key=lambda item: (item.locale, item.source_hash)):
        entry = entry_of(translation)
        size = entry_size(translation.source_hash, entry)
        number, entries = 0, None
        if translation.locale in chunks:
            number, entries = chunks[translation.locale]
        used = len(json.dumps(entries, ensure_ascii=False).encode()) if entries else 0
        if entries is None or used + size > MAX_CHUNK_BYTES:
            number = number + 1 if entries is not None else 0
            entries = {}
            documents[doc_id(translation.locale, number)] = {
                "locale": translation.locale,
                "chunk": number,
                "entries": entries,
            }
            chunks[translation.locale] = (number, entries)
        entries[translation.source_hash] = entry
    return documents


def unpack(documents: Iterable[dict[str, Any]]) -> list[Translation]:
    """Every translation in the bundle documents. If a text is in two chunks (two servers
    raced), the newer translation wins."""
    found: dict[tuple[str, str], Translation] = {}
    for document in documents:
        locale = document.get("locale")
        if not locale:
            continue
        for source_hash, entry in (document.get("entries") or {}).items():
            try:
                translation = translation_of(locale, source_hash, entry)
            except (KeyError, TypeError, ValueError):
                logger.warning("skipping an unreadable translation %s/%s", locale, source_hash)
                continue
            key = (locale, source_hash)
            before = found.get(key)
            if before is None or translation.created_at >= before.created_at:
                found[key] = translation
    return list(found.values())


class BundleBackend(Protocol):
    """Where the bundles are saved."""

    def read_bundles(self) -> list[dict[str, Any]]:
        """Every bundle document, in one query."""
        ...

    def write_entries(
        self,
        locale: str,
        chunk: int,
        puts: dict[str, dict[str, Any]],
        deletes: Sequence[str],
    ) -> None:
        """Adds or replaces [puts] and removes [deletes] in the chunk's document, touching
        no other entry."""
        ...

    def read_legacy(self) -> list[Translation] | None:
        """The old one-row-per-hash translations, or None once they were migrated."""
        ...

    def delete_legacy(self, locale: str, source_hash: str) -> None: ...


class TranslationMemory:
    """All the translations of a store, in memory: lookups are dictionary reads.

    Loaded on first use and re-read after [ttl] seconds (the old copy keeps being served
    while that happens, and if it fails). A write goes to the backend first and then into
    the memory, so what the memory says was saved."""

    def __init__(
        self,
        backend: BundleBackend,
        *,
        ttl: float = DEFAULT_TTL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._backend = backend
        self._ttl = ttl
        self._clock = clock
        self._lock = threading.RLock()
        self._load_lock = threading.Lock()
        self._rows: dict[str, dict[str, Translation]] = {}
        self._chunk_of: dict[tuple[str, str], int] = {}
        self._chunk_bytes: dict[tuple[str, int], int] = {}
        # Rows saved the old way, still in the database; read once, until they are migrated.
        self._legacy_rows: dict[tuple[str, str], Translation] = {}
        self._loaded = False
        self._refresh_after = 0.0
        self._writes = 0
        # Changes whenever a translation does (also when another server's change is read).
        self.revision = 0
        # How many times the backend was asked for the bundles, for tests and monitoring.
        self.loads = 0

    # Reading

    def get(self, locale: str, source_hashes: Iterable[str]) -> dict[str, Translation]:
        self._ensure_fresh()
        with self._lock:
            rows = self._rows.get(locale, {})
            return {h: rows[h] for h in dict.fromkeys(source_hashes) if h in rows}

    def fold_legacy(self) -> int:
        """Writes the old one-row-per-hash translations that are in no bundle into the
        bundles, and returns how many. Running it again does nothing more."""
        self._ensure_fresh()
        with self._lock:
            missing = [
                row for key, row in self._legacy_rows.items() if key not in self._chunk_of
            ]
        self.put(missing)
        return len(missing)

    def current_revision(self) -> int:
        """The revision after making sure the memory is not older than the TTL."""
        self._ensure_fresh()
        return self.revision

    def list(self, locale: str | None = None) -> list[Translation]:
        self._ensure_fresh()
        with self._lock:
            return [
                row
                for code, rows in self._rows.items()
                if locale is None or code == locale
                for row in rows.values()
            ]

    # Writing

    def put(self, translations: Sequence[Translation]) -> None:
        if not translations:
            return
        self._ensure_fresh()
        by_chunk: dict[tuple[str, int], dict[str, dict[str, Any]]] = {}
        placed: dict[tuple[str, str], int] = {}
        with self._lock:
            sizes = dict(self._chunk_bytes)
            for translation in translations:
                entry = entry_of(translation)
                size = entry_size(translation.source_hash, entry)
                chunk = self._chunk_of.get((translation.locale, translation.source_hash))
                if chunk is None:
                    chunk = self._chunk_for_new(translation.locale, size, sizes, by_chunk)
                sizes[(translation.locale, chunk)] = sizes.get((translation.locale, chunk), 0) + size
                by_chunk.setdefault((translation.locale, chunk), {})[translation.source_hash] = entry
                placed[(translation.locale, translation.source_hash)] = chunk
        for (locale, chunk), puts in by_chunk.items():
            self._backend.write_entries(locale, chunk, puts, ())
        with self._lock:
            for translation in translations:
                key = (translation.locale, translation.source_hash)
                self._rows.setdefault(translation.locale, {})[translation.source_hash] = translation
                self._chunk_of[key] = placed[key]
            for key, size in sizes.items():
                self._chunk_bytes[key] = size
            self._writes += 1
            self.revision += 1

    def delete(self, locale: str, source_hash: str) -> None:
        self._ensure_fresh()
        with self._lock:
            chunk = self._chunk_of.get((locale, source_hash))
            legacy = (locale, source_hash) in self._legacy_rows
        if chunk is not None:
            self._backend.write_entries(locale, chunk, {}, [source_hash])
        if legacy:
            self._backend.delete_legacy(locale, source_hash)
        with self._lock:
            self._rows.get(locale, {}).pop(source_hash, None)
            self._chunk_of.pop((locale, source_hash), None)
            self._legacy_rows.pop((locale, source_hash), None)
            self._writes += 1
            self.revision += 1

    def _chunk_for_new(
        self,
        locale: str,
        size: int,
        sizes: dict[tuple[str, int], int],
        pending: dict[tuple[str, int], dict[str, dict[str, Any]]],
    ) -> int:
        chunks = [number for (code, number) in sizes if code == locale]
        chunks += [number for (code, number) in pending if code == locale]
        last = max(chunks, default=0)
        if sizes.get((locale, last), 0) + size > MAX_CHUNK_BYTES:
            return last + 1
        return last

    # Loading

    def _ensure_fresh(self) -> None:
        if self._loaded and self._clock() < self._refresh_after:
            return
        # One thread loads; the others serve the old copy (or wait for the very first one).
        if not self._load_lock.acquire(blocking=not self._loaded):
            return
        try:
            if self._loaded and self._clock() < self._refresh_after:
                return
            self._load()
        finally:
            self._load_lock.release()

    def _load(self) -> None:
        with self._lock:
            writes_before = self._writes
        try:
            documents = self._backend.read_bundles()
            legacy = None if self._loaded else self._backend.read_legacy()
        except Exception:
            logger.exception("could not read the translation bundles; using the copy in memory")
            self._refresh_after = self._clock() + RETRY_SECONDS
            return
        self.loads += 1
        chunk_of: dict[tuple[str, str], int] = {}
        chunk_bytes: dict[tuple[str, int], int] = {}
        bundled: dict[str, dict[str, Translation]] = {}
        for document in documents:
            locale, chunk = document.get("locale"), int(document.get("chunk", 0))
            if not locale:
                continue
            entries = document.get("entries") or {}
            chunk_bytes[(locale, chunk)] = sum(entry_size(h, e) for h, e in entries.items())
            for translation in unpack([document]):
                known = bundled.get(locale, {}).get(translation.source_hash)
                if known is None or translation.created_at >= known.created_at:
                    bundled.setdefault(locale, {})[translation.source_hash] = translation
                    chunk_of[(locale, translation.source_hash)] = chunk
        with self._lock:
            if self._writes != writes_before:
                # A write finished while reading: the read may predate it. Keep the memory
                # (which includes the write) and read again at the next chance.
                self._loaded = True
                self._refresh_after = self._clock()
                return
            if legacy is not None:
                self._legacy_rows = {(row.locale, row.source_hash): row for row in legacy}
            rows: dict[str, dict[str, Translation]] = {}
            for (locale, source_hash), row in self._legacy_rows.items():
                rows.setdefault(locale, {})[source_hash] = row
            for locale, found in bundled.items():
                rows.setdefault(locale, {}).update(found)
            if rows != self._rows:
                self.revision += 1
            self._rows, self._chunk_of, self._chunk_bytes = rows, chunk_of, chunk_bytes
            self._loaded = True
            self._refresh_after = self._clock() + self._ttl
