"""Writes the English word list into server.js (the line `const WORDS_CODED = "...";`).

    python3 wordlist.py PATH/TO/scowl-2020.12.07/final

Source: SCOWL 2020.12.07 (http://wordlist.aspell.net/), sizes 10, 20 and 35 of the English and
American word lists: common words only. Kept: lowercase a-z words of 4+ letters. Encoding: sorted
words, each written as one digit (letters shared with the previous word, at most 9) followed by the
rest of the word. SCOWL's copyright notice is repeated at the top of server.js, as its license asks.
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
final = Path(sys.argv[1])
words = set()
for size in (10, 20, 35):
    for kind in ("english-words", "american-words"):
        f = final / f"{kind}.{size}"
        if f.exists():
            words |= {w for w in f.read_text(encoding="latin-1").split() if re.fullmatch(r"[a-z]{4,}", w)}
coded, prev = [], ""
for w in sorted(words):
    k = 0
    while k < min(len(prev), len(w), 9) and prev[k] == w[k]:
        k += 1
    coded.append(f"{k}{w[k:]}")
    prev = w
server = HERE / "server.js"
text = re.sub(r'const WORDS_CODED = "[^"]*";', f'const WORDS_CODED = "{"".join(coded)}";', server.read_text(), count=1)
server.write_text(text)
print(f"{len(words)} words, {len(''.join(coded)):,} characters")
