"""Writes Lingo's five-letter word lists into server.js (the ANSWERS and EXTRA strings).

    python3 wordlist.py PATH/TO/scowl-2020.12.07/final

Source: SCOWL 2020.12.07 (http://wordlist.aspell.net/), English and American word lists.
ANSWERS (mystery words): sizes 10 and 20, common words. EXTRA (also accepted as guesses): size 35.
Kept: lowercase a-z words of exactly five letters, sorted and written back to back.
SCOWL's copyright notice is repeated at the top of server.js, as its license asks.
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
final = Path(sys.argv[1])


def words(sizes):
    out = set()
    for size in sizes:
        for kind in ("english-words", "american-words"):
            f = final / f"{kind}.{size}"
            if f.exists():
                out |= {w for w in f.read_text(encoding="latin-1").split() if re.fullmatch(r"[a-z]{5}", w)}
    return out


answers = sorted(words((10, 20)))
extra = sorted(words((35,)) - set(answers))
server = HERE / "server.js"
text = server.read_text()
text = re.sub(r'const ANSWERS = "[^"]*";', f'const ANSWERS = "{"".join(answers)}";', text, count=1)
text = re.sub(r'const EXTRA = "[^"]*";', f'const EXTRA = "{"".join(extra)}";', text, count=1)
server.write_text(text)
print(f"{len(answers)} mystery words, {len(extra)} more accepted guesses")
