"""The texts a game's SERVER writes (docs/game-translation.md, "Texts the server writes").

A game lists them as templates in the same `i18n-strings` table as its page texts, under keys
that start with `server_`: `"server_not_your_turn": "not your turn"`,
`"server_need_cards": "need {count} more cards"`. A text the server wrote (the reason of an
`InvalidMove`, a log line in the match state) is matched against those templates: exact
match, each `{name}` standing for any text, and the most specific template (the most literal
characters) wins. The matching template is translated like any other table text and the
captured values are put back as written. A text that matches nothing is shown as written.

The same rule is in `game_i18n_helper.js` (`tx`), so the page and the platform agree.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final

KEY_PREFIX: Final = "server_"
_PLACEHOLDER: Final = re.compile(r"\{(\w+)\}")


@dataclass(frozen=True)
class Template:
    key: str
    text: str
    pattern: re.Pattern[str]
    names: tuple[str, ...]  # the placeholder names, in order
    literal_length: int


@dataclass(frozen=True)
class Match:
    key: str
    template: str
    params: dict[str, str]


def compile_template(key: str, text: str) -> Template:
    pieces = _PLACEHOLDER.split(text)  # literal, name, literal, name, ..., literal
    names: list[str] = []
    regex = []
    literal = 0
    for index, piece in enumerate(pieces):
        if index % 2:
            names.append(piece)
            regex.append("(.+?)")
        else:
            literal += len(piece)
            regex.append(re.escape(piece))
    return Template(key, text, re.compile("".join(regex), re.DOTALL), tuple(names), literal)


def compile_templates(table: dict[str, str] | None) -> tuple[Template, ...]:
    """The server templates of a string table, most specific first (more literal text, then
    fewer placeholders, then key order), so the first that fits is the answer."""
    templates = [
        compile_template(key, text)
        for key, text in (table or {}).items()
        if key.startswith(KEY_PREFIX) and text
    ]
    templates.sort(key=lambda t: (-t.literal_length, len(t.names), t.key))
    return tuple(templates)


def match(templates: tuple[Template, ...], text: str) -> Match | None:
    """The template that a server-written [text] is an instance of, with the values the
    placeholders stand for; None if there is none."""
    for template in templates:
        found = template.pattern.fullmatch(text)
        if found is not None:
            params: dict[str, str] = {}
            for name, value in zip(template.names, found.groups()):
                params.setdefault(name, value)
            return Match(template.key, template.text, params)
    return None


def fill(template: str, params: dict[str, str]) -> str:
    """[template] with `{name}` replaced by the captured values (unknown names stay)."""
    return _PLACEHOLDER.sub(lambda m: params.get(m.group(1), m.group(0)), template)
