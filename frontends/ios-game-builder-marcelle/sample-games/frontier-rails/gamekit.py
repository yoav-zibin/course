"""Shared helpers for building a POST /games payload (each game folder keeps its own copy).

The game's secret (game_addition_request_id_and_secret) lives in
~/.config/buildplay-games/secrets.json, never in the repo; the first build creates it.
"""

import json
import secrets as _secrets
from html import escape
from pathlib import Path

SECRETS = Path.home() / ".config" / "buildplay-games" / "secrets.json"
LANGS = ["es", "fr", "de", "pt", "zh", "hi", "ar"]


def secret(key: str) -> str:
    SECRETS.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(SECRETS.read_text()) if SECRETS.exists() else {}
    if key not in data:
        data[key] = f"{key}-" + _secrets.token_urlsafe(32)
        SECRETS.write_text(json.dumps(data, indent=2))
        SECRETS.chmod(0o600)
    return data[key]


def tutorial_html(items, figure_svg: str, background: str, ink: str, accent: str) -> str:
    """A static tutorial page: an optional text-free figure, then one element per string."""
    body = "\n".join(f"<{tag}>{escape(text, quote=False)}</{tag}>" for tag, text in items)
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<style>body{{margin:0;padding:20px;max-width:640px;font:17px/1.5 system-ui,sans-serif;"
        f"background:{background};color:{ink}}}h1{{font-size:24px}}h2{{font-size:19px;color:{accent};margin-top:22px}}"
        "svg{display:block;margin:12px 0;max-width:100%;height:auto}</style></head><body>\n"
        + figure_svg + "\n" + body + "\n</body></html>"
    )


def client_strings(client_html: str) -> dict:
    start = client_html.index('id="i18n-strings">') + len('id="i18n-strings">')
    return json.loads(client_html[start:client_html.index("</script>", start)])


def translations(texts, client_html: str) -> dict:
    source = client_strings(client_html)
    out = {}
    for lang in LANGS:
        tr = texts.T[lang]
        assert set(tr["client"]) == set(source), (lang, set(source) ^ set(tr["client"]))
        assert len(tr["tutorial"]) == len(texts.TUTORIAL), lang
        out[lang] = {
            "display_name": tr["name"], "short_description": tr["description"],
            "game_logic_rules": tr["rules"], "game_ui_rules": tr["ui"],
            "tutorial_strings": {text: tr["tutorial"][i] for i, (_, text) in enumerate(texts.TUTORIAL)},
            "client_strings": tr["client"],
        }
    return out


def case(name, description, kind, ctx, state, mover, other, move, view, picture, *, expected_state=None,
         expected_turn=None, expected_payouts=None, error=None):
    """One unit-test case. [view](state, player_id) projects what a player sees; [picture](view, who)
    draws it. Expected states, turns and payouts are written by hand from the rules."""
    names = {p["id"]: p["display_name"] for p in ctx["players"]}
    after = state if error else expected_state
    entry = {
        "name": name, "description": description, "kind": kind, "ctx": ctx, "state": state,
        "player_id": mover, "other_player_id": other, "move": move,
        "view_of_mover": view(state, mover), "view_of_other": view(state, other),
        "expected_state": after, "expected_turn": expected_turn,
        "expected_view_of_mover": view(after, mover), "expected_view_of_other": view(after, other),
    }
    if error:
        entry["expected_error"] = error
        entry["turn"] = expected_turn
    if expected_payouts is not None:
        entry["expected_payouts"] = expected_payouts
    entry["images"] = [
        {"caption": f"Before: {names[mover]}", "svg": picture(entry["view_of_mover"], names[mover])},
        {"caption": f"Before: {names[other]}", "svg": picture(entry["view_of_other"], names[other])},
        {"caption": f"After: {names[mover]}", "svg": picture(entry["expected_view_of_mover"], names[mover])},
        {"caption": f"After: {names[other]}", "svg": picture(entry["expected_view_of_other"], names[other])},
    ]
    return entry


def text_svg(title, lines, background, ink, accent):
    rows = "".join(f'<text x="40" y="{150 + i * 60}" font-size="34" fill="{ink}">{escape(line)}</text>'
                   for i, line in enumerate(lines))
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675">'
            f'<rect width="1200" height="675" fill="{background}"/>'
            f'<text x="40" y="80" font-size="46" font-weight="700" fill="{accent}">{escape(title)}</text>{rows}</svg>')


def write_payload(out: str, payload: dict) -> None:
    path = Path(out)
    text = json.dumps(payload, ensure_ascii=False)
    path.write_text(text)
    path.chmod(0o600)
    print(f"wrote {path} ({len(text.encode()):,} bytes)")
