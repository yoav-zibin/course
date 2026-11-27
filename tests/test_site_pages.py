"""HTML reporting stays present across routing, caching and streamed responses."""

from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from game_platform.api import create_app


STORAGE = '/static/shared/device-storage.js?v=1'
MARKER = '/static/site-bug-report.js?v=4'


def test_public_pages_and_not_found_have_one_early_reporter():
    client = TestClient(create_app(master_password="fixture-master"))
    for path in ("/", "/portal", "/static/privacy.html", "/static/delete-account.html",
                 "/admin/login", "/not-a-page"):
        response = client.get(path, headers={"Accept": "text/html"})
        assert response.status_code in (200, 404), path
        assert response.text.count(STORAGE) == response.text.count(MARKER) == 1, path
        assert response.text.index(STORAGE) < response.text.index(MARKER), path
        assert response.text.index(MARKER) < response.text.index("</head>"), path
    login = client.get("/admin/login")
    assert 'data-admin="true"' in login.text


def test_html_etags_describe_the_injected_document_and_revalidate():
    client = TestClient(create_app())
    first = client.get("/portal")
    assert first.status_code == 200 and MARKER in first.text
    assert first.headers["etag"].startswith('"site-reporting-')
    cached = client.get("/portal", headers={"If-None-Match": first.headers["etag"]})
    assert cached.status_code == 304 and cached.content == b""
    assert cached.headers["etag"] == first.headers["etag"]
    stale = client.get("/portal", headers={"If-None-Match": '"old-original-file-etag"'})
    assert stale.status_code == 200 and MARKER in stale.text
    head = client.head("/static/app/index.html")
    assert head.status_code == 200 and head.content == b""
    assert head.headers["etag"] == first.headers["etag"]


def test_stream_boundaries_and_compression_do_not_corrupt_html_or_json():
    app = create_app()

    @app.get("/streamed-page")
    def streamed():
        return StreamingResponse(iter([b"<!doctype html><ht", b"ml><hea", b"d>",
                                       b"</head><body>" + b"visible text " * 200,
                                       b"</body></html>"]), media_type="text/html")

    client = TestClient(app)
    response = client.get("/streamed-page", headers={"Accept-Encoding": "gzip"})
    assert response.headers["content-encoding"] == "gzip"
    assert response.text.count(MARKER) == 1
    assert "</body></html>" in response.text
    assert "visible text " * 200 in response.text
    health = client.get("/health")
    assert health.status_code == 200 and health.json()["status"] == "ok"
    assert MARKER not in health.text


def test_google_signin_and_unexpected_server_errors_have_the_icon_too():
    app = create_app(master_password="fixture-master")

    @app.get("/crash-test")
    def crash():
        raise RuntimeError("unexpected fixture failure")

    client = TestClient(app, raise_server_exceptions=False)
    redirect = client.get("/admin", headers={"Accept": "text/html"}, follow_redirects=False)
    assert redirect.status_code == 303
    assert "www-authenticate" not in redirect.headers
    signin = client.get(redirect.headers["location"])
    assert signin.text.count(MARKER) == 1
    assert 'data-admin="true"' in signin.text
    failure = client.get("/crash-test", headers={"Accept": "text/html"})
    assert failure.status_code == 500
    assert failure.text.count(MARKER) == 1
    assert "unexpected fixture failure" not in failure.text


def test_google_html_gate_does_not_redirect_private_api_automation():
    client = TestClient(create_app(master_password="old-game-master", admin_api_key="fixture-master"))
    assert client.get("/admin/students", auth=("admin", "fixture-master"),
                      follow_redirects=False).status_code == 303
    queue = client.get("/game-server-bugs", auth=("admin", "fixture-master"),
                       headers={"Accept": "application/json"})
    assert queue.status_code == 200 and "items" in queue.json()
