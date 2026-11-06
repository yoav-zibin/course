"""Translations kept as one bundle per language, and GET /i18n/bundle/{locale}."""

import datetime as dt
import importlib.util
import json
import threading
from pathlib import Path
from typing import Any

import pytest

from game_platform import translation_bundle
from game_platform.firestore_store import FirestoreStore
from game_platform.models import Translation
from game_platform.query_store import ADAPTERS, QueryStore, _BundleBackend, key
from game_platform.tests.fake_firestore import FakeClient, query_store
from game_platform.tests.helpers import Api
from game_platform.tests.test_game_translation import GAME, publish
from game_platform.store import InMemoryStore
from game_platform.translation import FakeTranslator, TranslationService, text_hash
from game_platform.translation_bundle import TranslationMemory, pack, unpack

NOW = dt.datetime(2026, 10, 30, 12, tzinfo=dt.timezone.utc)


def row(source: str, text: str = "", *, locale: str = "es", provider: str = "google") -> Translation:
    return Translation(
        locale=locale,
        source_hash=text_hash(source),
        source=source,
        text=text or f"[{locale}] {source}",
        provider=provider,
        created_at=NOW,
    )


def legacy_document(client: FakeClient, namespace: str, translation: Translation) -> None:
    """Saves [translation] the way the store did before bundles: one document per hash."""
    path = f"{namespace}_translations/{key(json.dumps([translation.locale, translation.source_hash]))}"
    client.docs[path] = {"json": ADAPTERS["translations"].dump_json(translation).decode()}


# The bundle documents


def test_translations_are_packed_into_one_document_per_language_and_unpacked_again() -> None:
    rows = [row("Your turn"), row("Hello", locale="fr"), row("{name} wins!")]
    documents = pack(rows)
    assert sorted(documents) == ["es-000", "fr-000"]
    assert documents["es-000"]["locale"] == "es" and documents["es-000"]["chunk"] == 0
    entry = documents["es-000"]["entries"][text_hash("Your turn")]
    assert (entry["t"], entry["s"], entry["p"], entry["r"]) == ("[es] Your turn", "Your turn", "google", False)
    assert sorted(unpack(documents.values()), key=lambda r: r.source) == sorted(rows, key=lambda r: r.source)


def test_a_language_that_outgrows_a_document_spills_into_numbered_chunks(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(translation_bundle, "MAX_CHUNK_BYTES", 600)
    rows = [row(f"text number {i}") for i in range(20)]
    documents = pack(rows)
    assert sorted(documents) == [f"es-{n:03d}" for n in range(len(documents))] and len(documents) > 2
    assert all(len(json.dumps(d).encode()) < 1200 for d in documents.values())
    assert len(unpack(documents.values())) == 20


def test_the_newer_translation_wins_when_two_chunks_hold_the_same_text() -> None:
    older, newer = row("Hi", "Hola"), row("Hi", "Buenas")
    newer = Translation(**{**newer.__dict__, "created_at": NOW + dt.timedelta(seconds=5)})
    docs = [pack([newer])["es-000"], {**pack([older])["es-000"], "chunk": 1}]
    (found,) = unpack(docs)
    assert found.text == "Buenas"


# The memory over a Firestore-like client


def test_a_store_reads_the_bundles_once_and_then_never_touches_the_database() -> None:
    client = FakeClient()
    store = query_store(client=client)
    store.put_translations([row("Your turn"), row("Hello")])
    client.reads = client.queries = 0
    hashes = [text_hash("Your turn"), text_hash("Hello"), text_hash("unknown")]
    for _ in range(50):
        assert set(store.get_translations("es", hashes)) == set(hashes[:2])
        assert len(store.list_translations("es")) == 2
    assert (client.reads, client.queries) == (0, 0)  # the writes put them in memory

    client.docs["test_meta/translations"] = {"bundled": True}  # (the migration was run)
    client.reads = client.queries = 0
    second = query_store(client=client)  # a restarted server: one query loads everything
    for _ in range(50):
        assert len(second.get_translations("es", hashes)) == 2
    assert client.queries == 1  # one query for every language and chunk


def test_adding_correcting_and_deleting_update_the_memory_and_the_document_in_place() -> None:
    client = FakeClient()
    store = query_store(client=client)
    store.put_translations([row("Hello"), row("Bye")])
    store.put_translations([row("Hello", "Buenas", provider="manual")])
    document = client.docs["test_translation_bundles/es-000"]
    assert document["entries"][text_hash("Hello")]["t"] == "Buenas"
    assert store.get_translations("es", [text_hash("Hello")])[text_hash("Hello")].provider == "manual"
    store.delete_translation("es", text_hash("Bye"))
    assert list(client.docs["test_translation_bundles/es-000"]["entries"]) == [text_hash("Hello")]
    assert store.get_translations("es", [text_hash("Bye")]) == {}
    store.delete_translation("fr", text_hash("never there"))  # nothing to delete: no error


def test_a_write_touches_only_its_own_entries_so_two_servers_do_not_overwrite_each_other() -> None:
    client = FakeClient()
    first, second = query_store(client=client), query_store(client=client)
    first.put_translations([row("From the first")])
    second.put_translations([row("From the second")])
    entries = client.docs["test_translation_bundles/es-000"]["entries"]
    assert set(entries) == {text_hash("From the first"), text_hash("From the second")}


def test_another_servers_translations_show_up_after_the_ttl() -> None:
    client = FakeClient()
    clock = {"now": 0.0}
    mine = TranslationMemory(_BundleBackend(query_store(client=client)), ttl=60, clock=lambda: clock["now"])
    other = query_store(client=client)
    assert mine.get("es", [text_hash("Hi")]) == {}
    other.put_translations([row("Hi")])
    clock["now"] = 59
    assert mine.get("es", [text_hash("Hi")]) == {} and mine.loads == 1
    clock["now"] = 61
    assert text_hash("Hi") in mine.get("es", [text_hash("Hi")])
    assert mine.loads == 2


def test_a_chunk_is_chosen_for_new_texts_and_all_chunks_load_in_one_query(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(translation_bundle, "MAX_CHUNK_BYTES", 700)
    client = FakeClient()
    store = query_store(client=client)
    store.put_translations([row(f"a fairly long text number {i}") for i in range(15)])
    chunks = sorted(path for path in client.docs if "translation_bundles" in path)
    assert len(chunks) > 2
    store.put_translations([row("a corrected one", "x"), row("a fairly long text number 3", "fixed")])
    # a corrected text stays in the chunk it was in
    holding = [p for p in chunks if text_hash("a fairly long text number 3") in client.docs[p]["entries"]]
    assert len(holding) == 1
    client.docs["test_meta/translations"] = {"bundled": True}
    client.queries = 0
    again = query_store(client=client)
    assert len(again.list_translations("es")) == 16 and client.queries == 1


def test_a_failing_database_keeps_the_copy_in_memory(caplog: pytest.LogCaptureFixture) -> None:
    client = FakeClient()
    store = query_store(client=client)
    store.put_translations([row("Hi")])
    clock = {"now": 0.0}
    memory = TranslationMemory(_BundleBackend(store), ttl=1, clock=lambda: clock["now"])
    assert len(memory.list("es")) == 1
    boom = _BundleBackend(store)
    boom.read_bundles = lambda: (_ for _ in ()).throw(RuntimeError("unavailable"))  # type: ignore[method-assign]
    memory._backend = boom
    clock["now"] = 2
    assert len(memory.list("es")) == 1  # still served


def test_listing_translations_is_not_limited_to_a_hundred() -> None:
    store = query_store()
    store.put_translations([row(f"text {i}") for i in range(250)])
    assert len(store.list_translations()) == 250
    page = store.page("translations", limit=100)
    assert len(page.items) == 100 and page.next_cursor
    second = store.page("translations", limit=100, cursor=page.next_cursor)
    third = store.page("translations", limit=100, cursor=second.next_cursor)
    seen = {r.source_hash for r in page.items + second.items + third.items}
    assert len(seen) == 250 and third.next_cursor is None


# The migration from one row per hash


def test_until_migrated_the_old_rows_are_read_once_at_startup() -> None:
    client = FakeClient()
    old = [row("Hello"), row("Bye"), row("Hello", locale="fr")]
    for item in old:
        legacy_document(client, "test", item)
    store = query_store(client=client)
    assert len(store.list_translations()) == 3
    reads = client.reads
    for _ in range(20):
        store.get_translations("es", [text_hash("Hello")])
    assert client.reads == reads  # the old rows are not read again
    store.put_translations([row("New")])  # new ones go to the bundle
    assert set(client.docs["test_translation_bundles/es-000"]["entries"]) == {text_hash("New")}
    # a restart still sees the old rows and the new one
    assert len(query_store(client=client).list_translations()) == 4
    # deleting an old row removes it for good
    store.delete_translation("es", text_hash("Hello"))
    assert len(query_store(client=client).list_translations()) == 3


def load_tool() -> Any:
    path = Path(__file__).parent.parent / "tools" / "migrate_translation_bundles.py"
    spec = importlib.util.spec_from_file_location("migrate_translation_bundles", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_migration_folds_old_rows_into_bundles_and_can_be_run_again() -> None:
    client = FakeClient()
    for item in [row("Hello"), row("Bye"), row("Hello", locale="fr")]:
        legacy_document(client, "test", item)
    query_store(client=client)  # initialises the namespace marker
    tool = load_tool()

    assert tool.migrate(client, "test", dry_run=True) == {"old_rows": 3, "already_bundled": 0, "to_fold": 3}
    assert not any("translation_bundles" in path for path in client.docs)

    done = tool.migrate(client, "test")
    assert (done["folded"], done["bundled_total"]) == (3, 3)
    assert client.docs["test_meta/translations"]["bundled"] is True
    assert sorted(p.rsplit("/", 1)[1] for p in client.docs if "translation_bundles" in p) == ["es-000", "fr-000"]

    again = tool.migrate(client, "test")
    assert (again["folded"], again["already_bundled"]) == (0, 3)  # nothing more to do

    # after the marker the server reads bundles only: the old rows are not even fetched
    client.reads = client.queries = 0
    store = query_store(client=client)
    assert len(store.list_translations()) == 3
    assert client.queries == 1
    assert not any(path.startswith("test_translations/") for path in client.read_paths)


def test_a_translation_corrected_after_the_migration_is_not_overwritten_by_running_it_again() -> None:
    client = FakeClient()
    legacy_document(client, "test", row("Hello"))
    store = query_store(client=client)
    tool = load_tool()
    tool.migrate(client, "test")
    store.put_translations([row("Hello", "Buenas", provider="manual")])
    tool.migrate(client, "test")
    assert query_store(client=client).list_translations("es")[0].text == "Buenas"


# The Firestore store that keeps everything in memory


def test_the_in_memory_firestore_store_saves_one_document_per_language_and_migrates_old_rows() -> None:
    client = FakeClient()
    legacy_document(FakeClient(), "x", row("ignored"))  # (just checks the helper)
    for item in [row("Old one")]:
        client.docs[f"translations/{item.locale}@{item.source_hash}"] = {
            "json": ADAPTERS["translations"].dump_json(item).decode()
        }
    store = FirestoreStore(client, min_write_interval_seconds=0)
    assert [t.source for t in store.list_translations("es")] == ["Old one"]  # read from the old rows
    store.put_translations([row("New one"), row("Nouveau", locale="fr")])
    store.close()  # saves
    assert sorted(p for p in client.docs if p.startswith("translation_bundles/")) == [
        "translation_bundles/es-000",
        "translation_bundles/fr-000",
    ]
    assert not any(p.startswith("translations/") for p in client.docs)  # the old rows are gone
    reopened = FirestoreStore(client, min_write_interval_seconds=0)
    try:
        assert {t.source for t in reopened.list_translations()} == {"Old one", "New one", "Nouveau"}
        reopened.delete_translation("fr", text_hash("Nouveau"))
    finally:
        reopened.close()
    assert "translation_bundles/fr-000" not in client.docs  # an empty language leaves no document


# The bundle endpoint


class BundledStore(InMemoryStore):
    """Games and users in memory; translations in a Firestore-like store (counting reads)."""

    def __init__(self, bundles: QueryStore) -> None:
        super().__init__()
        self.bundles = bundles

    def get_translations(self, locale: str, source_hashes: Any) -> Any:
        return self.bundles.get_translations(locale, source_hashes)

    def put_translations(self, translations: Any) -> None:
        self.bundles.put_translations(translations)

    def delete_translation(self, locale: str, source_hash: str) -> None:
        self.bundles.delete_translation(locale, source_hash)

    def list_translations(self, locale: str | None = None) -> Any:
        return self.bundles.list_translations(locale)


class BundleApi(Api):
    """The app, with its translations kept in a Firestore-like store (counting reads)."""

    def __init__(self, translator: Any = None, *, wait: float = 3.0) -> None:
        self.firestore = FakeClient()
        self.bundles = query_store(client=self.firestore)
        super().__init__(store=BundledStore(self.bundles))
        platform = self.client.app.state.platform  # type: ignore[attr-defined]
        platform._translation = TranslationService(platform._store, translator, clock=platform._clock)
        platform._bundle_wait_seconds = wait
        platform._bundle_games_ttl_seconds = 0

    def bundle(self, locale: str = "es", *, etag: str | None = None) -> Any:
        headers = {"If-None-Match": etag} if etag else {}
        return self.client.get(f"/i18n/bundle/{locale}", headers=headers)


def test_the_bundle_has_the_catalog_and_every_published_games_texts() -> None:
    api = BundleApi(FakeTranslator())
    owner = api.new_user("owner")
    chess = publish(api, owner, name="Chess")
    plain = publish(api, owner, name="Plain", code="<html>no table</html>")
    hidden = publish(api, owner, name="Hidden")
    api.ok("POST", f"/games/{hidden}/unpublish", as_user=owner)

    response = api.bundle("es")
    assert response.status_code == 200
    body = response.json()
    assert (body["locale"], body["direction"], body["status"]) == ("es", "ltr", "translated")
    assert body["catalog"]["messages"] == api.ok("GET", "/i18n/es")["messages"]
    assert body["catalog"]["version"] == api.ok("GET", "/i18n/es")["version"]
    assert set(body["games"]) == {chess, plain}  # an unpublished game is not in it
    game = body["games"][chess]
    assert (game["version"], game["status"], game["translatable"]) == (1, "translated", True)
    assert game["name"] == "[es] Chess" and game["description"] == "[es] Three in a row wins"
    assert game["strings"] == {"your_turn": "[es] Your turn", "wins": "[es] {name} wins!", "moves": "[es] Moves: {count}"}
    assert body["games"][plain]["translatable"] is False and body["games"][plain]["strings"] == {}
    # the same texts as the per-game endpoint gives
    assert api.ok("GET", f"/games/{chess}/versions/1/strings", params={"lang": "es"})["strings"] == game["strings"]
    assert api.ok("GET", "/i18n/games/es")["games"][chess]["name"] == game["name"]
    assert api.bundle("ar").json()["direction"] == "rtl"


def test_english_needs_no_translation_and_an_unknown_language_is_not_found() -> None:
    fake = FakeTranslator()
    api = BundleApi(fake)
    game_id = publish(api, api.new_user("owner"))
    body = api.bundle("en").json()
    assert body["status"] == "source" and body["games"][game_id]["name"] == "Tic-tac-toe"
    assert body["games"][game_id]["strings"]["wins"] == "{name} wins!"
    assert fake.calls == []
    assert api.bundle("xx").status_code == 404


def test_once_the_bundle_is_loaded_a_request_makes_no_firestore_reads() -> None:
    api = BundleApi(FakeTranslator())
    publish(api, api.new_user("owner"))
    first = api.bundle("es")
    assert first.status_code == 200
    reads = (api.firestore.reads, api.firestore.queries)
    for _ in range(5):
        assert api.bundle("es").status_code == 200
        assert api.bundle("es", etag=first.headers["ETag"]).status_code == 304
    assert (api.firestore.reads, api.firestore.queries) == reads  # not one read


def test_the_etag_is_strong_and_changes_when_a_translation_is_added_corrected_or_deleted() -> None:
    fake = FakeTranslator()
    api = BundleApi(fake)
    game_id = publish(api, api.new_user("owner"))
    first = api.bundle("es")
    etag = first.headers["ETag"]
    assert etag.startswith('"') and not etag.startswith("W/")
    assert first.headers["Cache-Control"] == "no-cache"
    assert api.bundle("es", etag=etag).status_code == 304
    assert api.bundle("es", etag=f'W/{etag}, "other"').status_code == 304
    assert api.bundle("es", etag='"nope"').status_code == 200
    assert api.bundle("fr").headers["ETag"] != etag  # another language, another bundle
    assert api.bundle("es", etag=etag).content == b""

    api.ok("PUT", "/admin/translations", json={"locale": "es", "source": "{name} wins!", "text": "¡{name} gana!"})
    changed = api.bundle("es", etag=etag)
    assert changed.status_code == 200 and changed.headers["ETag"] != etag
    assert changed.json()["games"][game_id]["strings"]["wins"] == "¡{name} gana!"
    assert [target for _, target in fake.calls] == ["es", "fr"]  # the correction cost nothing

    api.ok("DELETE", f"/admin/translations/es/{text_hash('{name} wins!')}")
    after = api.bundle("es", etag=changed.headers["ETag"])
    assert after.status_code == 200 and after.json()["games"][game_id]["strings"]["wins"] == "[es] {name} wins!"


def test_a_new_machine_translation_shows_up_in_the_bundle() -> None:
    api = BundleApi(FakeTranslator())
    owner = api.new_user("owner")
    publish(api, owner, name="First")
    etag = api.bundle("es").headers["ETag"]
    second = publish(api, owner, name="Second")  # a new game, never translated
    response = api.bundle("es", etag=etag)
    assert response.status_code == 200 and response.headers["ETag"] != etag
    assert response.json()["games"][second]["name"] == "[es] Second"
    assert text_hash("Second") in api.bundles.get_translations("es", [text_hash("Second")])


def test_the_bundle_never_waits_long_for_the_translator_and_says_what_is_missing() -> None:
    release = threading.Event()

    class Slow(FakeTranslator):
        def translate(self, texts: Any, target: str) -> list[str]:
            release.wait(5)
            return super().translate(texts, target)

    api = BundleApi(Slow(), wait=0.05)
    game_id = publish(api, api.new_user("owner"))
    started = dt.datetime.now()
    response = api.bundle("es")
    assert (dt.datetime.now() - started).total_seconds() < 2
    body = response.json()
    assert (response.status_code, body["status"]) == (200, "unavailable")
    game = body["games"][game_id]
    assert game["status"] == "unavailable" and game["name"] == "Tic-tac-toe"  # the original text
    assert game["strings"]["your_turn"] == "Your turn"
    release.set()  # the translator finishes in the background...
    for _ in range(100):
        done = api.bundle("es").json()
        if done["status"] == "translated":
            break
        threading.Event().wait(0.05)
    assert done["games"][game_id]["name"] == "[es] Tic-tac-toe"  # ...and the next request has it


def test_a_failing_or_missing_translator_gives_originals_with_a_status() -> None:
    from game_platform.translation import TranslationError

    for translator in (None, FakeTranslator(fail=TranslationError("down"))):
        api = BundleApi(translator)
        game_id = publish(api, api.new_user("owner"))
        response = api.bundle("de")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "unavailable" and body["games"][game_id]["name"] == "Tic-tac-toe"
        assert body["catalog"]["messages"]  # the interface texts are there regardless


def test_the_existing_endpoints_still_answer_as_before() -> None:
    api = BundleApi(FakeTranslator())
    game_id = publish(api, api.new_user("owner"))
    assert api.ok("GET", "/i18n/es")["locale"] == "es"
    assert api.ok("GET", "/i18n/games/es")["status"] == "translated"
    assert api.ok("GET", f"/games/{game_id}/versions/1/strings", params={"lang": "es"})["status"] == "translated"
    assert GAME  # the sample game is the one these tests publish
