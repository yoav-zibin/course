"""Verifies third-party login tokens against their providers.

Deliberately no new dependencies: Google ID tokens are checked with Google's
tokeninfo endpoint and Apple ID tokens are verified locally against Apple's
published keys with an RSA check written on the standard library (base64,
hashlib, hmac), all plain HTTPS through httpx, which the project already
depends on. If logins ever get busy enough for these calls to matter, cache
Apple's keys instead of fetching them per login.
"""

import base64
import hashlib
import hmac
import json
import time

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


_APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
_APPLE_ISSUER = "https://appleid.apple.com"


def _b64url_decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _rsa_pkcs1_v1_5_sha256_verify(
    signing_input: bytes, signature: bytes, n: int, e: int
) -> bool:
    """True when [signature] is a valid PKCS#1 v1.5 RSA signature of
    [signing_input] under the public key (n, e), using SHA-256."""
    key_bytes = (n.bit_length() + 7) // 8
    if len(signature) != key_bytes:
        return False
    decrypted = pow(int.from_bytes(signature, "big"), e, n).to_bytes(key_bytes, "big")
    digest = hashlib.sha256(signing_input).digest()
    # DER prefix for SHA-256 in EMSA-PKCS1-v1_5.
    prefix = bytes.fromhex("3031300d060960864801650304020105000420")
    padding_len = key_bytes - len(prefix) - len(digest) - 3
    if padding_len < 8:
        return False
    expected = b"\x00\x01" + b"\xff" * padding_len + b"\x00" + prefix + digest
    return hmac.compare_digest(decrypted, expected)


def verify_apple_id_token(id_token: str, client_id: str) -> tuple[str, str]:
    """Returns (subject, email) for an Apple ID token coming from the website's
    "Sign in with Apple" button. The JWT signature is checked against Apple's
    published keys and the issuer/audience/expiry claims are validated. Raises
    [ProviderError]."""
    parts = id_token.split(".")
    if len(parts) != 3:
        raise ProviderError("Apple token is not a JWT")
    try:
        header = json.loads(_b64url_decode(parts[0]))
        payload = json.loads(_b64url_decode(parts[1]))
        signature = _b64url_decode(parts[2])
    except Exception as error:
        raise ProviderError("Apple token is malformed") from error
    if header.get("alg") != "RS256" or not header.get("kid"):
        raise ProviderError("Apple token has an unexpected signing algorithm")
    try:
        response = httpx.get(_APPLE_JWKS_URL, timeout=10)
    except httpx.HTTPError as error:
        raise ProviderError(f"couldn't reach Apple: {error}") from error
    if response.status_code != 200:
        raise ProviderError("Apple didn't return its signing keys")
    keys = response.json().get("keys", [])
    key = next((k for k in keys if k.get("kid") == header["kid"]), None)
    if key is None:
        raise ProviderError("Apple token was signed by an unknown key")
    try:
        n = int.from_bytes(_b64url_decode(key["n"]), "big")
        e = int.from_bytes(_b64url_decode(key["e"]), "big")
    except Exception as error:
        raise ProviderError("Apple's signing key is malformed") from error
    if not _rsa_pkcs1_v1_5_sha256_verify(
        f"{parts[0]}.{parts[1]}".encode("ascii"), signature, n, e
    ):
        raise ProviderError("Apple token signature is invalid")
    if payload.get("iss") != _APPLE_ISSUER:
        raise ProviderError("Apple token has an unexpected issuer")
    if payload.get("aud") != client_id:
        raise ProviderError("the token was issued for a different app")
    if not isinstance(payload.get("exp"), (int, float)) or payload["exp"] <= time.time():
        raise ProviderError("Apple token is expired")
    subject = payload.get("sub")
    if not subject:
        raise ProviderError("Apple didn't return a subject")
    return str(subject), str(payload.get("email") or "")
