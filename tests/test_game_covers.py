"""Cover caching, visibility and bounded Firestore reads."""

from dataclasses import replace
from unittest.mock import patch

import pytest

from game_platform.json_file_store import JsonFileStore
from game_platform.read_cache import ReadCache
from game_platform.tests.fake_firestore import query_store
from game_platform.tests.helpers import Api

SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="blue"/></svg>'


@pytest.fixture(params=["memory", "file", "query"])
def cover_api(request, tmp_path):
    store = (JsonFileStore(tmp_path / "games.json") if request.param == "file" else
             query_store() if request.param == "query" else None)
    api = Api(store=store)
    yield api
    if store is not None:
        store.close()


def create_cover(api):
    owner = api.new_user("owner")
    game_id = api.new_game(owner=owner, allowed_player_counts=[2])
    store = api.platform._store
    game = store.get_game_version(game_id, 1)
    store.put_game_version(replace(game, import_package={"images": [{"caption": "Cover", "svg": SVG}]}))
    return owner, game_id, f"/games/{game_id}/versions/1/cover"


def test_published_cover_cache_policy_survives_middleware(cover_api):
    api = cover_api
    _, game_id, url = create_cover(api)
    response = api.request("GET", url)
    assert response.status_code == 200
    assert response.text == SVG
    assert response.headers["cache-control"] == "public, max-age=3600"
    assert response.headers["content-type"] == "image/svg+xml"
    assert response.headers["content-security-policy"] == "default-src 'none'; sandbox"
    assert response.headers["x-content-type-options"] == "nosniff"
    # Full game JSON must keep its existing privacy policy and complete code.
    full = api.request("GET", f"/games/{game_id}/versions/1")
    assert full.headers["cache-control"] == "private, no-store"
    assert full.json()["code"] == "<div>poker</div>"
    assert full.json()["server_code"]


def test_unchanged_cover_revalidates_without_a_body(cover_api):
    api = cover_api
    _, _, url = create_cover(api)
    first = api.request("GET", url)
    etag = first.headers["etag"]
    for validator in (etag, f'"other", W/{etag}', "*"):
        again = api.client.get(url, headers={"If-None-Match": validator})
        assert (again.status_code, again.content) == (304, b"")
        assert again.headers["etag"] == etag
        assert again.headers["cache-control"] == "public, max-age=3600"
    assert api.client.get(url, headers={"If-None-Match": '"old"'}).status_code == 200


def test_unpublished_cover_is_private_and_revalidation_cannot_bypass_access(cover_api):
    api = cover_api
    owner, game_id, url = create_cover(api)
    outsider = api.new_user("outsider")
    etag = api.request("GET", url).headers["etag"]
    api.ok("POST", f"/games/{game_id}/unpublish", as_user=owner)
    for caller in (None, outsider):
        response = api.request("GET", url, as_user=caller)
        assert response.status_code == 404
        assert response.headers["cache-control"] == "private, no-store"
    # Even a validator obtained while public cannot turn a denied request into 304.
    denied = api.client.get(url, headers={"If-None-Match": etag})
    assert denied.status_code == 404
    assert denied.headers["cache-control"] == "private, no-store"
    owner_response = api.request("GET", url, as_user=owner)
    assert owner_response.status_code == 200
    assert owner_response.headers["cache-control"] == "private, no-store"
    owner_cached = api.client.get(url, headers={"If-None-Match": etag,
        "X-User-Id": owner, "X-User-Password": api.passwords_by_user_id[owner]})
    assert owner_cached.status_code == 304
    assert owner_cached.headers["cache-control"] == "private, no-store"


def test_deleted_game_cover_is_not_publicly_cached(cover_api):
    api = cover_api
    owner, game_id, url = create_cover(api)
    api.ok("DELETE", f"/games/{game_id}", as_user=owner)
    # Versions remain available for existing matches, as before the optimization.
    response = api.request("GET", url, as_user=owner)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"


def test_match_participants_keep_access_to_unpublished_cover(cover_api):
    api = cover_api
    owner, game_id, url = create_cover(api)
    player = api.new_user("player")
    api.new_match(owner=player, game_id=game_id)
    api.ok("POST", f"/games/{game_id}/unpublish", as_user=owner)
    response = api.request("GET", url, as_user=player)
    assert response.status_code == 200
    assert response.text == SVG
    assert response.headers["cache-control"] == "private, no-store"


def test_missing_or_invalid_cover_is_never_cached(cover_api):
    api = cover_api
    _, game_id, url = create_cover(api)
    store = api.platform._store
    game = store.get_game_version(game_id, 1)
    for package, status in [(None, 404), ({"images": [{"caption": "Bad", "svg": '<svg><script/></svg>'}]}, 400)]:
        store.put_game_version(replace(game, import_package=package))
        response = api.request("GET", url)
        assert response.status_code == status
        assert response.headers["cache-control"] == "private, no-store"
    missing = api.request("GET", f"/games/{game_id}/versions/99/cover")
    assert missing.status_code == 404
    assert missing.headers["cache-control"] == "private, no-store"


def test_new_versions_have_distinct_urls_and_validators(cover_api):
    api = cover_api
    _, game_id, old_url = create_cover(api)
    before = api.request("GET", old_url)
    store = api.platform._store
    game = store.get_game_version(game_id, 1)
    store.add_game_version(replace(game, version=2, import_package={
        "images": [{"caption": "New cover", "svg": SVG.replace("blue", "red")}]}))
    after = api.request("GET", f"/games/{game_id}/versions/2/cover")
    assert after.status_code == 200
    assert after.headers["etag"] != before.headers["etag"]
    assert api.request("GET", old_url).text == before.text


def test_query_cover_reads_two_metadata_documents_and_reuses_the_read_cache():
    store = query_store()
    api = Api(store=store)
    try:
        _, game_id, url = create_cover(api)
        # A deterministic cold cache, with refresh work captured rather than run.
        store._cache.close()
        store._cache = ReadCache(clock=lambda: 1000.0, submit=lambda job: None)
        client = store.client
        client.read_paths.clear()
        # This read-only endpoint must not start a transaction and bypass the cache.
        with patch.object(client, "transaction", side_effect=AssertionError("cover opened a transaction")):
            first = api.request("GET", url)
            assert first.status_code == 200
            assert client.read_paths == [store.ref("game_versions", f"{game_id}@1").path,
                                         store.ref("games", game_id).path]
            assert all("/body/" not in path for path in client.read_paths)
            client.read_paths.clear()
            assert api.request("GET", url).status_code == 200
            assert client.read_paths == []
    finally:
        store.close()
