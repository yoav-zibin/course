"""Verifies third-party login tokens against their providers.

Deliberately no new dependencies: Google ID tokens are checked with Google's
tokeninfo endpoint and Facebook tokens with the Graph API, both plain HTTPS calls
through httpx, which the project already depends on. If logins ever get busy enough
for tokeninfo's rate limits to matter, Google tokens should be verified locally with
their published certificates instead.
"""

import httpx


class ProviderError(Exception):
    """The provider rejected the token, or couldn't be reached."""


def verify_google_id_token(id_token: str, client_id: str) -> tuple[str, str]:
    """Returns (subject, display name) for a Google ID token coming from the
    website's Sign in with Google button. Raises [ProviderError]."""
    try:
        response = httpx.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": id_token},
            timeout=10,
        )
    except httpx.HTTPError as error:
        raise ProviderError(f"couldn't reach Google: {error}") from error
    if response.status_code != 200:
        raise ProviderError("Google rejected the token")
    claims = response.json()
    if claims.get("aud") != client_id:
        raise ProviderError("the token was issued for a different app")
    subject = claims.get("sub")
    if not subject:
        raise ProviderError("Google didn't return a subject")
    return str(subject), str(claims.get("name") or "")


def verify_facebook_access_token(
    access_token: str, app_id: str, app_secret: str
) -> tuple[str, str]:
    """Returns (user id, display name) for a Facebook Login access token. Raises
    [ProviderError]."""
    try:
        debug = (
            httpx.get(
                "https://graph.facebook.com/debug_token",
                params={
                    "input_token": access_token,
                    "access_token": f"{app_id}|{app_secret}",
                },
                timeout=10,
            )
            .json()
            .get("data", {})
        )
    except httpx.HTTPError as error:
        raise ProviderError(f"couldn't reach Facebook: {error}") from error
    if not debug.get("is_valid") or str(debug.get("app_id")) != app_id:
        raise ProviderError("Facebook rejected the token")
    try:
        profile = httpx.get(
            f"https://graph.facebook.com/{debug['user_id']}",
            params={"fields": "id,name", "access_token": access_token},
            timeout=10,
        ).json()
    except httpx.HTTPError as error:
        raise ProviderError(f"couldn't reach Facebook: {error}") from error
    if not profile.get("id"):
        raise ProviderError("Facebook didn't return a user id")
    return str(profile["id"]), str(profile.get("name") or "")
