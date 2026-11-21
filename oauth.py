"""Google ID-token verification using public signing certificates.

Tokens are verified locally with Google's library. Only public certificates are
downloaded: credentials never enter outbound URLs or HTTP request logs.
"""

import time
from collections.abc import Mapping

import requests
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token as google_id_token


class ProviderError(Exception):
    """The provider rejected the token, or couldn't be reached."""


def _verified_google_claims(id_token: str, client_id: str):
    if not client_id:
        raise ProviderError("Google sign-in is not configured.")
    try:
        with requests.Session() as session:
            transport = GoogleRequest(session=session)

            def fetch_certificates(url, method="GET", body=None, headers=None, **kwargs):
                return transport(url, method=method, body=body, headers=headers, timeout=10)

            claims = google_id_token.verify_oauth2_token(
                id_token, fetch_certificates, audience=client_id, clock_skew_in_seconds=60,
            )
    except (GoogleAuthError, ValueError, TypeError, requests.RequestException):
        # Library exceptions can quote rejected input. Keep credential values
        # and provider response bodies out of replies and exception chains.
        raise ProviderError("Google sign-in could not be verified. Try again.") from None
    try:
        valid = (
            isinstance(claims, Mapping) and claims.get("aud") == client_id
            and claims.get("iss") in ("https://accounts.google.com", "accounts.google.com")
            and isinstance(claims.get("sub"), str) and bool(claims["sub"])
            and int(claims["exp"]) > time.time()
        )
    except (ValueError, TypeError, KeyError):
        valid = False
    if not valid:
        raise ProviderError("Google rejected the token")
    return claims


def _profile(claims) -> tuple[str, str, str, str]:
    return (claims["sub"], str(claims.get("name") or ""), str(claims.get("email") or "").strip(),
            str(claims.get("picture") or ""))


def verify_google_admin_token(id_token: str, client_id: str) -> tuple[str, str, str, str]:
    """Require fresh Google proof and a verified email for an admin browser."""
    claims = _verified_google_claims(id_token, client_id)
    try:
        issued = int(claims["iat"])
        now = time.time()
        valid = (
            (claims.get("email_verified") is True or claims.get("email_verified") == "true")
            and isinstance(claims.get("email"), str) and "@" in claims["email"]
            and now - 600 <= issued <= now + 60
        )
    except (ValueError, TypeError, KeyError):
        valid = False
    if not valid:
        raise ProviderError("A fresh Google sign-in with a verified email is required.")
    return _profile(claims)


def verify_google_id_token(id_token: str, client_id: str) -> tuple[str, str, str, str]:
    """Return (subject, name, email, picture) for the ordinary portal login.

    Existing portal profiles may omit email; the additional fresh-email policy
    belongs to admin sign-in. Both paths verify the signed Google identity.
    """
    return _profile(_verified_google_claims(id_token, client_id))
