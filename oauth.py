"""Verifies third-party login tokens against their providers.

Deliberately no new dependencies: Google ID tokens are checked with Google's
tokeninfo endpoint, a plain HTTPS call through httpx, which the project already
depends on. If logins ever get busy enough for tokeninfo's rate limits to
matter, Google tokens should be verified locally with their published
certificates instead.
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
