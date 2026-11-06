"""Reading the texts a game's SERVER writes out of its code (server_code, `*.server.js`).

Used by `tools/extract_server_texts.py` (which adds them to a page's table) and by
`game_text.lint` (which checks that a new game's table has a template for each). It reads only
what is written as text in the code: string literals, template literals, concatenations and
conditionals between texts. See the tool's docstring and docs/game-translation.md.
"""

from __future__ import annotations

import itertools
import re
from dataclasses import dataclass, field
from typing import Final

MAX_ALTERNATIVES: Final = 16
MAX_TEXT: Final = 1000
_TEXT_PROPERTIES = r"msg|text|label|description|desc|banner|title|message|note|summary|reason"
_LOG_FUNCTIONS = r"(?<![\w.])(?:_?log|addLog|pushLog)\(|\._log\("
_PUSH_SINKS = r"\b(?:log|logs|msgs|messages|lines)\.push\("
_ASSIGNMENT_SINKS = r"(?:\.|(?<![\w.]))(?:log|msg|message|text|reason)\s*=(?![=>])"
_PROPERTY_SINKS = rf"[{{,]\s*[\"']?\b(?:{_TEXT_PROPERTIES})[\"']?\s*:"


# Reading JavaScript expressions (just enough: strings, templates, brackets)


def skip_string(src: str, i: int) -> int:
    quote = src[i]
    i += 1
    while i < len(src) and src[i] != quote:
        i += 2 if src[i] == "\\" else 1
    return i + 1


def skip_template(src: str, i: int) -> int:
    i += 1
    while i < len(src) and src[i] != "`":
        if src[i] == "\\":
            i += 2
        elif src.startswith("${", i):
            i = skip_braces(src, i + 1)
        else:
            i += 1
    return i + 1


def skip_braces(src: str, i: int) -> int:
    """[i] is at a `{` (of `${`): the index after its matching `}`."""
    depth = 0
    while i < len(src):
        c = src[i]
        if c in "'\"":
            i = skip_string(src, i)
            continue
        if c == "`":
            i = skip_template(src, i)
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return i


def skip_comment(src: str, i: int) -> int | None:
    if src.startswith("//", i):
        end = src.find("\n", i)
        return len(src) if end < 0 else end
    if src.startswith("/*", i):
        end = src.find("*/", i + 2)
        return len(src) if end < 0 else end + 2
    return None


def read_expression(src: str, i: int) -> tuple[str, int]:
    """The expression starting at [i], up to the first top-level `,` `)` `]` `}` or `;`."""
    start, depth = i, 0
    while i < len(src):
        c = src[i]
        if c in "'\"":
            i = skip_string(src, i)
            continue
        if c == "`":
            i = skip_template(src, i)
            continue
        skipped = skip_comment(src, i) if c == "/" else None
        if skipped is not None:
            i = skipped
            continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            if depth == 0:
                break
            depth -= 1
        elif depth == 0 and c in ",;":
            break
        i += 1
    return src[start:i], i


def split_top(expr: str, separator: str) -> list[str]:
    """[expr] cut at its top-level [separator] characters (a lone `+`, not `++` or `+=`)."""
    parts, depth, start, i = [], 0, 0, 0
    while i < len(expr):
        c = expr[i]
        if c in "'\"":
            i = skip_string(expr, i)
            continue
        if c == "`":
            i = skip_template(expr, i)
            continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif depth == 0 and c == separator:
            before = expr[i - 1] if i else ""
            after = expr[i + 1] if i + 1 < len(expr) else ""
            if before != separator and after not in (separator, "="):
                parts.append(expr[start:i])
                start = i + 1
        i += 1
    parts.append(expr[start:])
    return parts


def find_top(expr: str, target: str) -> int:
    """The index of the first top-level [target] character, or -1."""
    depth, i = 0, 0
    while i < len(expr):
        c = expr[i]
        if c in "'\"":
            i = skip_string(expr, i)
            continue
        if c == "`":
            i = skip_template(expr, i)
            continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif depth == 0 and c == target:
            if target == "?" and expr[i + 1 : i + 2] in (".", "?"):
                i += 2
                continue
            return i
        i += 1
    return -1


def unwrap(expr: str) -> str:
    """[expr] without redundant outer parentheses."""
    expr = expr.strip()
    while expr.startswith("(") and expr.endswith(")") and _closes_at_end(expr):
        expr = expr[1:-1].strip()
    return expr


def _closes_at_end(expr: str) -> bool:
    depth, i = 0, 0
    while i < len(expr):
        c = expr[i]
        if c in "'\"":
            i = skip_string(expr, i)
            continue
        if c == "`":
            i = skip_template(expr, i)
            continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth == 0 and i != len(expr) - 1:
                return False
        i += 1
    return True


_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}


def unescape(body: str) -> str:
    out, i = [], 0
    while i < len(body):
        c = body[i]
        if c != "\\" or i + 1 >= len(body):
            out.append(c)
            i += 1
            continue
        n = body[i + 1]
        if n == "u" and body[i + 2 : i + 3] == "{":
            end = body.index("}", i)
            out.append(chr(int(body[i + 3 : end], 16)))
            i = end + 1
        elif n == "u":
            out.append(chr(int(body[i + 2 : i + 6], 16)))
            i += 6
        elif n == "x":
            out.append(chr(int(body[i + 2 : i + 4], 16)))
            i += 4
        elif n == "\n":
            i += 2
        else:
            out.append(_ESCAPES.get(n, n))
            i += 2
    # Surrogate pairs written as two \u escapes are one character.
    return "".join(out).encode("utf-16", "surrogatepass").decode("utf-16", "replace")


# Turning an expression into the texts it can produce

Part = tuple[str, str]  # ("lit", text) or ("var", source)
Alternative = list[Part]


class Unreadable(Exception):
    pass


def alternatives(expr: str) -> list[Alternative]:
    """Every text [expr] can produce, as lists of literal and variable parts."""
    expr = unwrap(expr)
    question = find_top(expr, "?")
    if question >= 0:
        rest = expr[question + 1 :]
        colon = _matching_colon(rest)
        if colon >= 0:
            branches = [rest[:colon], rest[colon + 1 :]]
            parsed = [_branch(b) for b in branches]
            if all(p is not None for p in parsed):
                return [alt for p in parsed for alt in p]  # type: ignore[union-attr]
        return [[("var", expr)]]
    operands = split_top(expr, "+")
    if len(operands) > 1:
        return _product([_operand(o) for o in operands])
    return _operand(expr)


def _matching_colon(rest: str) -> int:
    depth_q, i, depth = 0, 0, 0
    while i < len(rest):
        c = rest[i]
        if c in "'\"":
            i = skip_string(rest, i)
            continue
        if c == "`":
            i = skip_template(rest, i)
            continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif depth == 0 and c == "?" and rest[i + 1 : i + 2] not in (".", "?"):
            depth_q += 1
        elif depth == 0 and c == ":":
            if depth_q == 0:
                return i
            depth_q -= 1
        i += 1
    return -1


def _branch(expr: str) -> list[Alternative] | None:
    """A conditional's branch, if it is made of text (not just a variable)."""
    found = alternatives(expr)
    if all(any(kind == "lit" for kind, _ in alt) for alt in found):
        return found
    return None


def _operand(expr: str) -> list[Alternative]:
    expr = unwrap(expr)
    if len(expr) >= 2 and expr[0] in "'\"" and skip_string(expr, 0) == len(expr):
        return [[("lit", unescape(expr[1:-1]))]]
    if len(expr) >= 2 and expr[0] == "`" and skip_template(expr, 0) == len(expr):
        return _template(expr[1:-1])
    if find_top(expr, "?") >= 0 or len(split_top(expr, "+")) > 1:
        return alternatives(expr)
    return [[("var", expr)]]


def _template(body: str) -> list[Alternative]:
    pieces: list[list[Alternative]] = []
    i, start = 0, 0
    while i < len(body):
        if body[i] == "\\":
            i += 2
        elif body.startswith("${", i):
            pieces.append([[("lit", unescape(body[start:i]))]])
            end = skip_braces(body, i + 1)
            inner = body[i + 2 : end - 1]
            found = alternatives(inner)
            pieces.append(found if all(any(k == "lit" for k, _ in a) for a in found) else [[("var", inner.strip())]])
            i = start = end
        else:
            i += 1
    pieces.append([[("lit", unescape(body[start:]))]])
    return _product(pieces)


def _product(groups: list[list[Alternative]]) -> list[Alternative]:
    combos = 1
    for group in groups:
        combos *= len(group)
    if combos > MAX_ALTERNATIVES:
        raise Unreadable(f"{combos} variants")
    return [list(itertools.chain.from_iterable(c)) for c in itertools.product(*groups)]


def render(alternative: Alternative) -> str:
    """One alternative as a template: its literals, each variable as `{p1}`, `{p2}`..."""
    out, count = [], 0
    for kind, value in alternative:
        if kind == "lit":
            out.append(re.sub(r"\{(\w+)\}", lambda m: "(" + m.group(1) + ")", value))  # a literal {word} is a placeholder
        else:
            count += 1
            out.append("{p%d}" % count)
    return "".join(out)


# Finding the texts in a server file


@dataclass
class Found:
    kind: str  # "InvalidMove" or "state"
    line: int
    template: str
    source: str
    notes: list[str] = field(default_factory=list)


@dataclass
class Result:
    found: list[Found] = field(default_factory=list)
    unreadable: list[tuple[int, str, str]] = field(default_factory=list)  # line, source, reason


def extract(code: str) -> Result:
    result = Result()

    def line_of(index: int) -> int:
        return code.count("\n", 0, index) + 1

    def add(kind: str, index: int, expr: str, *, report_variables: bool, code_filter: bool) -> None:
        source = " ".join(expr.split())[:120]
        try:
            found = alternatives(expr)
        except Unreadable as error:
            result.unreadable.append((line_of(index), source, f"too many variants ({error})"))
            return
        for alt in found:
            if not any(kind_ == "lit" and re.search(r"[^\W\d_]", value) for kind_, value in alt):
                if report_variables and not any(k == "lit" for k, _ in alt):
                    result.unreadable.append(
                        (line_of(index), source, "the message is not a text written here (a variable or a call)")
                    )
                continue
            template = render(alt)
            if code_filter and re.fullmatch(r"[a-z][a-z0-9_]*", template):
                continue  # a code such as msg: 'refill', not a text
            note = []
            if re.search(r"\{p\d+\}\{p\d+\}", template):
                note.append("two placeholders touch each other, so a match may split their values wrongly")
            if sum(len(v) for k, v in alt if k == "lit" and v.strip()) < 3:
                note.append("almost no fixed words: this template matches many texts")
            if len(template) > MAX_TEXT:
                result.unreadable.append((line_of(index), source, "longer than 1000 characters"))
                continue
            result.found.append(Found(kind, line_of(index), template, source, note))

    for m in re.finditer(r"new\s+InvalidMove\(", code):
        expr, _ = read_expression(code, m.end())
        if expr.strip():
            add("InvalidMove", m.start(), expr, report_variables=True, code_filter=False)
    if re.search(r"new\s+InvalidMove\(\s*\w+\.message\s*\)", code):
        # The game turns the errors of its own rule code into InvalidMove (poker's `act`).
        for m in re.finditer(r"throw\s+new\s+Error\(", code):
            expr, _ = read_expression(code, m.end())
            add("InvalidMove", m.start(), expr, report_variables=True, code_filter=False)
    for pattern, last_only in ((_LOG_FUNCTIONS, True), (_PUSH_SINKS, False)):
        for m in re.finditer(pattern, code):
            args, i = [], m.end()
            while True:
                expr, i = read_expression(code, i)
                args.append((expr, i))
                if i >= len(code) or code[i] != ",":
                    break
                i += 1
            if code[m.end() :].lstrip().startswith(")"):
                continue
            chosen = args[-1:] if last_only else args
            for expr, end in chosen:
                if re.match(r"\s*(\w+\s*(=>|\)\s*\{)|\{)", expr):
                    continue  # a function definition's parameters
                add("state", m.start(), expr, report_variables=False, code_filter=False)
    for m in re.finditer(_ASSIGNMENT_SINKS, code):
        expr, _ = read_expression(code, m.end())
        add("state", m.start(), expr, report_variables=False, code_filter=True)
    for m in re.finditer(_PROPERTY_SINKS, code):
        expr, _ = read_expression(code, m.end())
        add("state", m.start(), expr, report_variables=False, code_filter=True)
    return result
