#!/usr/bin/env python3
"""Finds text a person sees on the website that is not translatable.

Scans static/*.html for visible text nodes and attributes (placeholder, title,
aria-label, alt, <option>/<button> text, <title>) that have no data-i18n* attribute,
and static/*.js for string literals that reach the screen (textContent, innerText,
innerHTML, placeholder, title, aria-label, toast/alert/confirm/showMessage..., thrown
Error messages, label/title/text object properties) outside an I18n.t(...) call.

Standard library only.

    python tools/find_untranslated_text.py                 count per file and the texts
    python tools/find_untranslated_text.py portal.js       only these files
    python tools/find_untranslated_text.py --counts        one line per file
    python tools/find_untranslated_text.py --check         exit 1 when a file has more
                                                           findings than its ratchet

tools/i18n_untranslated_allowlist.json holds:
  "allow":   texts that are not translatable on purpose (brand names, symbols, code)
             -- {"*": [...]} for every file or {"file.js": [...]} for one;
  "ratchet": the number of findings each file may still have. Files not listed may
             have none, so new hard-coded English fails tests/test_i18n_audit.py.
Lower a number when you convert texts; never raise it.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
ALLOWLIST = Path(__file__).with_name("i18n_untranslated_allowlist.json")

# Pages and scripts that are converted first; the test requires them to stay clean.
PRIORITY = [
    "portal.html", "portal.js", "portal-practice.js", "portal-speed.js", "portal-install.js",
    "portal-match-layout.js", "portal-offline.js", "portal-feedback.js",
    "builder.html", "builder.js", "guided-builder.html", "guided-builder.js",
    "auth.js", "common.js", "push-notifications.js", "storage-pages.js",
    "feedback-dialog.js", "invites.html", "invites.js", "referral-pages.js",
]

# Not page text: the language library itself, the service worker, game-side helpers.
LIBRARY_FILES = {"i18n.js", "portal-sw.js"}
TEXT_ATTRIBUTES = ("placeholder", "title", "aria-label", "alt", "value")
SKIP_TAGS = {"script", "style", "svg", "code", "pre", "kbd", "samp", "noscript", "template"}
LETTER = re.compile(r"[^\W\d_]", re.UNICODE)


def is_text(value: str) -> bool:
    """True when [value] has a letter, i.e. is words rather than a symbol or number."""
    return bool(LETTER.search(value))


# ----------------------------------------------------------------------------- HTML


class _Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, bool]] = []  # (tag, translated)
        self.found: list[tuple[int, str, str]] = []

    VOID = {"br", "hr", "img", "input", "meta", "link", "area", "base", "col", "source", "wbr"}

    def _translated(self) -> bool:
        return any(flag for _, flag in self.stack)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        own = "data-i18n" in a or "data-i18n-managed" in a
        for name in TEXT_ATTRIBUTES:
            if name not in a or not a[name] or not is_text(a[name]):
                continue
            if name == "value" and not (tag == "input" and a.get("type") in ("button", "submit")):
                continue
            if name == "title" and tag == "meta":
                continue
            if f"data-i18n-{name}" in a or "data-i18n-managed" in a:
                continue
            if tag == "html" or (tag == "link"):
                continue
            self.found.append((self.getpos()[0], f"{tag}[{name}]", a[name]))
        if tag not in self.VOID:
            self.stack.append((tag, own))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.stack.pop()

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                return

    def handle_data(self, data):
        text = re.sub(r"\s+", " ", data).strip()
        if not text or not is_text(text):
            return
        if any(tag in SKIP_TAGS for tag, _ in self.stack) or self._translated():
            return
        self.found.append((self.getpos()[0], "text", text))


def scan_html(source: str) -> list[tuple[int, str, str]]:
    parser = _Page()
    parser.feed(source)
    return parser.found


# ------------------------------------------------------------------------------- JS

PUNCT_BEFORE_REGEX = set("(,=:[!&|?{};+-*%<>~^")
KEYWORDS_BEFORE_REGEX = {"return", "typeof", "case", "in", "of", "delete", "void", "throw", "else"}


def tokenize(src: str):
    """Yield ("str", text, start, end, line) for string literals; template literals give
    their static text with ${...} replaced by {}; everything else is skipped."""
    i, n, line = 0, len(src), 1
    last = ""  # last significant char/word for regex detection
    tokens = []

    def template(i):
        # returns (text, end index, newlines)
        out, depth, j = [], 0, i + 1
        while j < n:
            c = src[j]
            if c == "\\":
                out.append(src[j : j + 2]); j += 2; continue
            if c == "`":
                return "".join(out), j + 1
            if c == "$" and src[j + 1 : j + 2] == "{":
                out.append("{}")
                depth, j = 1, j + 2
                while j < n and depth:
                    if src[j] == "{":
                        depth += 1
                    elif src[j] == "}":
                        depth -= 1
                    elif src[j] in "\"'":
                        quote = src[j]; j += 1
                        while j < n and src[j] != quote:
                            j += 2 if src[j] == "\\" else 1
                    elif src[j] == "`":
                        _, j = template(j); continue
                    j += 1
                continue
            out.append(c); j += 1
        return "".join(out), j

    while i < n:
        c = src[i]
        if c == "\n":
            line += 1; i += 1; continue
        if c in " \t\r":
            i += 1; continue
        if src.startswith("//", i):
            while i < n and src[i] != "\n":
                i += 1
            continue
        if src.startswith("/*", i):
            end = src.find("*/", i + 2)
            end = n if end < 0 else end + 2
            line += src.count("\n", i, end); i = end; continue
        if c in "\"'":
            j = i + 1
            while j < n and src[j] != c and src[j] != "\n":
                j += 2 if src[j] == "\\" else 1
            raw = src[i + 1 : j]
            tokens.append(("str", decode(raw), i, j + 1, line))
            i, last = j + 1, "s"; continue
        if c == "`":
            text, end = template(i)
            tokens.append(("str", decode(text), i, end, line))
            line += src.count("\n", i, end); i, last = end, "s"; continue
        if c == "/":
            if last in PUNCT_BEFORE_REGEX or last in KEYWORDS_BEFORE_REGEX or last == "":
                j, in_class = i + 1, False
                while j < n and src[j] != "\n":
                    if src[j] == "\\":
                        j += 2; continue
                    if src[j] == "[":
                        in_class = True
                    elif src[j] == "]":
                        in_class = False
                    elif src[j] == "/" and not in_class:
                        break
                    j += 1
                i, last = j + 1, "s"; continue
            i, last = i + 1, "/"; continue
        if c.isalnum() or c in "_$":
            j = i
            while j < n and (src[j].isalnum() or src[j] in "_$"):
                j += 1
            last = src[i:j]; i = j; continue
        last = c; i += 1
    return tokens


def decode(raw: str) -> str:
    def repl(m):
        s = m.group(1)
        if s[0] == "u":
            return chr(int(s[1:].strip("{}"), 16)) if re.fullmatch(r"u(\{[0-9a-fA-F]+\}|[0-9a-fA-F]{4})", s) else s
        if s[0] == "x":
            return chr(int(s[1:], 16))
        return {"n": "\n", "t": "\t", "r": ""}.get(s, s)

    return re.sub(r"\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)", repl, raw, flags=re.S)


# Where text reaches the screen. Each regex ends right where the shown value starts.
ASSIGN_SINKS = re.compile(
    r"\.(?:textContent|innerText|innerHTML|outerHTML|placeholder|title|label|alt)\s*\+?=(?!=)"
    r"|\.insertAdjacentHTML\([^,]*,"
)
CALL_SINKS = re.compile(
    r"\b(?:toast|alert|confirm|prompt|showMessage|setMessage|setStatus|showError|announce|notify|"
    r"flash|setNote|showNotice|showToast|showPageError|say)\s*\("
    r"|\bnew\s+(?:\w*Error)\s*\("
    r"|\bsetAttribute\(\s*[\"'](?:aria-label|placeholder|title|alt|aria-description)[\"']\s*,"
    r"|\.(?:set|show)(?:Message|Status|Error|Text|Title)\s*\("
)
PROP_SINKS = re.compile(
    r"\b(?:label|title|text|message|hint|placeholder|description|heading|caption|summary|"
    r"empty|help|body|subtitle|tooltip|ariaLabel|cta|status|textContent|innerText|innerHTML|"
    r"[\"']aria-label[\"']|[\"']title[\"']|[\"']placeholder[\"']|[\"']alt[\"'])\s*:"
)
I18N_CALL = re.compile(r"\bI18n\s*\.\s*t\s*\(|\bt\s*\(")


def balanced_end(src: str, start: int, limit: int = 1500) -> int:
    """Index where the expression starting at [start] ends: a `;` or an unmatched closer
    at depth 0, a `,` at depth 0 for property values, or the limit."""
    depth, i, n = 0, start, min(len(src), start + limit)
    quote = None
    while i < n:
        c = src[i]
        if quote:
            if c == "\\":
                i += 2; continue
            if c == quote:
                quote = None
            i += 1; continue
        if c in "\"'`":
            quote = c
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            if depth == 0:
                return i
            depth -= 1
        elif c == ";" and depth == 0:
            return i
        elif c == "\n" and depth == 0 and src[start:i].strip() and not re.search(r"[+?:&|,(=]\s*$", src[start:i]):
            nxt = src[i:].lstrip()[:1]
            if nxt not in ("+", "?", ":", "&", "|", "."):
                return i
        i += 1
    return n


def spans_of_i18n(src: str) -> list[tuple[int, int]]:
    spans = []
    for m in re.finditer(r"\bI18n\s*\.\s*(?:t|plural)\s*\(", src):
        spans.append((m.start(), balanced_end(src, m.end())))
    return spans


def code_like(text: str, strict: bool) -> bool:
    """Class names, ids, keys, urls, css and code are not for translation."""
    t = text.strip()
    if not is_text(t):
        return True
    if re.fullmatch(r"[\w$.\-:/#\[\]=*>~@%?&,;()|!^+<{}\\ ]*", t) and " " not in t:
        if re.search(r"[_\-./#:\[\]=@%?&;()|!^+<{}\\]", t) or re.fullmatch(r"[a-z]+[A-Z]\w*|[a-z0-9]+", t) and (strict or len(t) < 3):
            return True
        if strict and re.fullmatch(r"[a-z0-9]+", t):
            return True
    if re.fullmatch(r"(?:https?:)?//\S+|/[\w/\-.?=&%]*|#[\w-]+|\.[\w-]+", t):
        return True
    if re.fullmatch(r"(?:[\w-]+\s*:\s*[^;]+;?\s*)+", t) and ":" in t and re.search(r"[;]", t):
        return True  # css declarations
    if re.fullmatch(r"</?[a-z][^>]*>", t):
        return True
    return False


def html_text_in(text: str) -> list[str]:
    """Words shown by an HTML string (innerHTML): the text between the tags."""
    return [re.sub(r"\s+", " ", p).strip() for p in re.split(r"<[^>]*>|\{\}", text) if is_text(p)]


def scan_js(source: str) -> list[tuple[int, str, str]]:
    tokens = tokenize(source)
    i18n = spans_of_i18n(source)
    found: dict[tuple[int, str], tuple[int, str, str]] = {}

    def inside_i18n(pos: int) -> bool:
        return any(a <= pos < b for a, b in i18n)

    def collect(start: int, end: int, kind: str, strict_prop: bool) -> None:
        for token in tokens:
            _, text, a, b, line = token
            if a < start or a >= end or inside_i18n(a):
                continue
            # skip strings that are keys of lookups, i.e. followed by `]` or used in comparisons
            after = source[b : b + 3].lstrip()
            before = source[max(0, a - 4) : a].rstrip()
            if after.startswith("]") or before.endswith(("===", "!==", "==", "!=", "[")):
                continue
            if after.startswith(":") and not strict_prop and before.endswith(("{", ",")):
                continue
            pieces = html_text_in(text) if "<" in text else [text]
            for piece in pieces:
                piece = piece.strip()
                if code_like(piece, strict_prop):
                    continue
                if strict_prop and " " not in piece and not piece[:1].isupper():
                    continue
                found[(a, piece)] = (line, kind, piece)

    # el("tag", {attrs}, "child text", ...): strings that are direct arguments
    for m in re.finditer(r"(?<![\w.$])el\(", source):
        if inside_i18n(m.start()):
            continue
        end = balanced_end(source, m.end())
        spans = [(t[2], t[3]) for t in tokens if m.end() <= t[2] < end]
        depth, i, first = 0, m.end(), True
        while i < end:
            span = next((sp for sp in spans if sp[0] == i), None)
            if span:
                token = next(t for t in tokens if t[2] == i)
                if depth == 0 and not first and not inside_i18n(i):
                    nxt = source[span[1] : span[1] + 3].lstrip()
                    if not nxt.startswith(":") and not code_like(token[1], False):
                        for piece in (html_text_in(token[1]) if "<" in token[1] else [token[1]]):
                            if piece.strip() and not code_like(piece.strip(), False):
                                found[(i, piece.strip())] = (token[4], "el-child", piece.strip())
                first = False
                i = span[1]
                continue
            c = source[i]
            if c in "([{":
                depth += 1
            elif c in ")]}":
                depth -= 1
            elif c == "," and depth == 0:
                first = False
            elif not c.isspace() and first and depth == 0 and c not in "\"'`":
                pass
            i += 1

    for regex, kind, strict in (
        (ASSIGN_SINKS, "assign", False),
        (CALL_SINKS, "call", False),
        (PROP_SINKS, "property", True),
    ):
        for m in regex.finditer(source):
            if inside_i18n(m.start()):
                continue
            if kind == "property" and re.match(r"\s*(?:\{|\[|function|\()", source[m.end():m.end() + 12]):
                pass
            end = balanced_end(source, m.end())
            if kind == "property":
                # the value ends at the first top-level comma
                end = min(end, first_top_comma(source, m.end(), end))
            collect(m.end(), end, kind, strict)
    # Anything that reads like a sentence, wherever it is used.
    sentence = re.compile(r"^[A-Z][\w’'-]*(?:[ ,]+[\w’'\-.:/()…!?]+){1,}$")
    for token in tokens:
        _, text, a, b, line = token
        if inside_i18n(a) or any(key[0] == a for key in found):
            continue
        piece = text.strip()
        if sentence.match(piece) and " " in piece and not code_like(piece, True):
            found[(a, piece)] = (line, "sentence", piece)
    return sorted(found.values())


def first_top_comma(src: str, start: int, limit: int) -> int:
    depth, i, quote = 0, start, None
    while i < limit:
        c = src[i]
        if quote:
            if c == "\\":
                i += 2; continue
            if c == quote:
                quote = None
        elif c in "\"'`":
            quote = c
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif c == "," and depth == 0:
            return i
        i += 1
    return limit


# ----------------------------------------------------------------------- reporting


def load_allowlist() -> dict:
    if ALLOWLIST.exists():
        return json.loads(ALLOWLIST.read_text(encoding="utf-8"))
    return {"allow": {}, "ratchet": {}}


def scan_file(path: Path, allow: dict | None = None) -> list[tuple[int, str, str]]:
    allow = allow if allow is not None else load_allowlist()["allow"]
    source = path.read_text(encoding="utf-8")
    found = scan_html(source) if path.suffix == ".html" else scan_js(source)
    allowed = set(allow.get("*", [])) | set(allow.get(path.name, []))
    return [item for item in found if item[2] not in allowed]


def scan_all(static: Path = STATIC) -> dict[str, list[tuple[int, str, str]]]:
    allow = load_allowlist()["allow"]
    out = {}
    for path in sorted(static.glob("*.html")) + sorted(static.glob("*.js")):
        if path.name in LIBRARY_FILES:
            continue
        out[path.name] = scan_file(path, allow)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="*", help="file names in static/ (default: all)")
    parser.add_argument("--counts", action="store_true", help="only the count per file")
    parser.add_argument("--priority", action="store_true", help="only the priority files")
    parser.add_argument("--check", action="store_true", help="exit 1 when a file exceeds its ratchet")
    args = parser.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    results = scan_all()
    names = args.files or (PRIORITY if args.priority else list(results))
    ratchet = load_allowlist()["ratchet"]
    failed = False
    total = 0
    for name in names:
        items = results.get(name, [])
        total += len(items)
        limit = ratchet.get(name, 0)
        over = len(items) > limit
        failed = failed or over
        if args.counts or not items:
            if items or not args.files:
                print(f"{len(items):4d}  {name}" + (f"   (ratchet {limit})" if over else ""))
            continue
        print(f"\n{name}: {len(items)} untranslated" + (f" (ratchet {limit})" if over else ""))
        for line, kind, text in items:
            print(f"  {line:5d} {kind:14s} {text[:110]!r}")
    print(f"\ntotal: {total}")
    return 1 if args.check and failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
