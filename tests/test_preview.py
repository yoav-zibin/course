import importlib.util
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location('course_preview', Path(__file__).resolve().parents[1] / 'preview.py')
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


def test_preview_portal_disables_service_worker_and_prevents_asset_caching():
    with TestClient(preview.create_preview('https://buildplay.fun', transport=httpx.MockTransport(lambda request: httpx.Response(200)))) as client:
        entry = client.get('/portal')
        assert entry.status_code == 200
        assert entry.headers['cache-control'] == 'no-store'
        assert 'name="local-preview"' in entry.text
        assert "registration.unregister()" in entry.text
        assert "location.replace('/static/portal.html'+location.search+location.hash)" in entry.text

        portal = client.get('/static/portal.html')
        assert portal.status_code == 200
        assert portal.headers['cache-control'] == 'no-store'
        assert 'name="local-preview"' in portal.text

        script = client.get('/static/portal.js?v=20')
        assert script.status_code == 200
        assert script.headers['cache-control'] == 'no-store'
        assert 'meta[name="local-preview"]' in script.text


def test_preview_keeps_backend_errors_and_query_parameters():
    def backend(request):
        assert request.url.params['owner_user_id'] == 'owner'
        return httpx.Response(401, json={'detail': 'invalid credentials'})
    with TestClient(preview.create_preview('https://buildplay.fun', transport=httpx.MockTransport(backend))) as client:
        response = client.get('/games?owner_user_id=owner')
        assert response.status_code == 401
        assert response.json()['detail'] == 'invalid credentials'


def test_preview_reports_unreachable_backend():
    def backend(request):
        raise httpx.ConnectError('unreachable', request=request)
    with TestClient(preview.create_preview('https://buildplay.fun', transport=httpx.MockTransport(backend))) as client:
        assert client.get('/auth/config').status_code == 502


def test_preview_forwards_every_api_area_the_pages_call():
    # Regression (bug 13): languages, push, invites and matchmaking answered 404.
    seen = []
    def backend(request):
        seen.append(request.url.path)
        return httpx.Response(200, json={})
    with TestClient(preview.create_preview('https://buildplay.fun', transport=httpx.MockTransport(backend))) as client:
        for path in ['/games', '/i18n/locales', '/i18n/catalogs/es', '/push/config', '/invites/x',
                     '/matchmaking/quick-match', '/storage/capabilities', '/v2/games']:
            method = client.post if path.startswith('/matchmaking') else client.get
            assert method(path).status_code == 200, path
        assert client.get('/admin/stats').status_code == 404
    assert '/push/config' in seen and '/invites/x' in seen


def test_preview_short_invite_links_open_the_local_portal():
    with TestClient(preview.create_preview('https://buildplay.fun', transport=httpx.MockTransport(lambda request: httpx.Response(500)))) as client:
        response = client.get('/r/48213', follow_redirects=False)
        assert response.status_code == 302
        assert response.headers['location'] == '/portal?ref=48213'
