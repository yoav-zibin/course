"""Cosmetic avatars: independent of seeded gameplay randomness."""
import json
import secrets
from pathlib import Path

_CATALOG = json.loads((Path(__file__).parent / "static/avatars/manifest.json").read_text())
USER_AVATARS = tuple("/static/avatars/" + item["file"] for item in _CATALOG if item["kind"] == "user")
COMPUTER_AVATARS = tuple("/static/avatars/" + item["file"] for item in _CATALOG if item["kind"] == "computer")

def random_user_avatar() -> str:
    return secrets.choice(USER_AVATARS)

def computer_avatar(identity: str) -> str:
    index = sum(ord(char) for char in identity)
    return COMPUTER_AVATARS[index % len(COMPUTER_AVATARS)]


def user_avatar(picture_url: str) -> str:
    """Keep an assigned catalog avatar; replace provider or missing pictures once."""
    return picture_url if picture_url in USER_AVATARS else random_user_avatar()
