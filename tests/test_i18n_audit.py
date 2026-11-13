"""Ratchet: no new hard-coded English on the website.

tools/find_untranslated_text.py lists the visible texts in static/*.html and static/*.js
that are not translatable. tools/i18n_untranslated_allowlist.json holds the texts that are
allowed on purpose and, per file, how many findings are still tolerated (the admin data
screens and the legal privacy page). A new file, or a new hard-coded text in a converted
file, fails here: translate it (data-i18n* in the HTML, I18n.t in the scripts) and add the
keys to every locales/*.json. See docs/i18n.md.
"""

import importlib.util
import json
from pathlib import Path

PACKAGE_DIR = Path(__file__).parent.parent
_spec = importlib.util.spec_from_file_location(
    "find_untranslated_text", PACKAGE_DIR / "tools" / "find_untranslated_text.py"
)
assert _spec and _spec.loader
audit = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(audit)


def _format(name: str, findings: list[tuple[int, str, str]]) -> str:
    return name + "\n" + "\n".join(f"  {line}: {text[:100]!r}" for line, _, text in findings)


def test_no_file_has_more_untranslated_texts_than_its_ratchet() -> None:
    ratchet = json.loads(audit.ALLOWLIST.read_text(encoding="utf-8"))["ratchet"]
    over = [
        _format(name, findings)
        for name, findings in audit.scan_all().items()
        if len(findings) > ratchet.get(name, 0)
    ]
    assert over == [], "hard-coded English found (translate it):\n" + "\n".join(over)


def test_the_priority_files_are_completely_translatable() -> None:
    ratchet = json.loads(audit.ALLOWLIST.read_text(encoding="utf-8"))["ratchet"]
    assert {name: ratchet[name] for name in audit.PRIORITY if name in ratchet} == {}
    results = audit.scan_all()
    for name in audit.PRIORITY:
        assert name in results, f"{name} is listed as a priority file but does not exist"
        assert results[name] == [], _format(name, results[name])


def test_the_ratchet_is_lowered_when_texts_are_converted() -> None:
    """A file under its number makes the number stale: lower it so it cannot grow back."""
    ratchet = json.loads(audit.ALLOWLIST.read_text(encoding="utf-8"))["ratchet"]
    results = audit.scan_all()
    stale = {
        name: (len(results.get(name, [])), limit)
        for name, limit in ratchet.items()
        if len(results.get(name, [])) < limit
    }
    assert stale == {}, f"lower these in the allowlist (found, ratchet): {stale}"
