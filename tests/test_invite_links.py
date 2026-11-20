"""Public URL entry points and verified native domain associations."""

import re

from game_platform.tests.helpers import Api


def test_short_invite_opens_shared_application_without_a_redirect(api: Api):
    response = api.request("GET", "/invite/wxyz")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert 'id="root"' in response.text
    assert response.history == []
    for invalid in ("WXYZ", "abc", "abcde", "1234"):
        assert api.request("GET", f"/invite/{invalid}").status_code == 404


def test_invite_management_and_qr_pages_are_removed(api: Api):
    assert api.request("GET", "/invites").status_code == 404
    assert api.request("GET", "/invites/wxyz/qr.svg").status_code == 404


def test_domain_associations_are_public_json_with_current_signed_apps(api: Api):
    apple = api.request("GET", "/.well-known/apple-app-site-association")
    android = api.request("GET", "/.well-known/assetlinks.json")
    for response in (apple, android):
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/json")
        assert response.history == []
    details = apple.json()["applinks"]["details"]
    assert details == [{"appID": "3B24UCE5E7.fun.buildplay.sample", "paths": ["/invite/????"]}]
    assert {entry["target"]["package_name"] for entry in android.json()} == {"fun.buildplay", "fun.buildplay.debug"}
    for entry in android.json():
        assert entry["relation"] == ["delegate_permission/common.handle_all_urls"]
        assert all(re.fullmatch(r"(?:[0-9A-F]{2}:){31}[0-9A-F]{2}", value)
                   for value in entry["target"]["sha256_cert_fingerprints"])
