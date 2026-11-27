"""Keep application and tooling storage access behind the shared async API."""
from pathlib import Path
import os
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MODULE = "frontends/portal/modules/legacy-portal"
ANDROID = f"{MODULE}/android/src/main/java/com/buildplay/legacyportal"
PLATFORM = "frontends/portal/src/platform"
SOURCE = {".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx", ".html", ".py", ".sh",
          ".kt", ".java", ".swift", ".m", ".mm", ".h", ".cpp"}
RULES = [
    (re.compile(r"""\blocalStorage\b|\bStorage\s*(?:\.\s*prototype\b|\[\s*["']prototype["'])"""),
     {"static/shared/device-storage.js"}),
    (re.compile(r"\bAsyncStorage\b|@react-native-async-storage/async-storage"),
     {f"{PLATFORM}/storage.native.ts"}),
    (re.compile(r"\b(?:__buildPlayStorageBinding|installStorageWorklet)\b"),
     {f"{PLATFORM}/storage-worklet.native.ts", f"{MODULE}/cpp/StorageWorkletBinding.h",
      f"{MODULE}/ios/LegacyPortalModule.swift", f"{ANDROID}/LegacyPortalModule.kt"}),
    (re.compile(r"\bPortalPersistentStorage\b"),
     {f"{MODULE}/ios/LegacyPortalModule.swift", f"{MODULE}/ios/PortalPersistentStorage.swift",
      f"{ANDROID}/StorageWorklet.kt", f"{ANDROID}/LegacyPortalModule.kt", f"{ANDROID}/PortalPersistentStorage.kt"}),
]


def check(path):
    relative = path.as_posix()
    # Fixtures intentionally seed old on-disk formats or force quota/permission failures.
    if (path.suffix not in SOURCE or {"tests", "e2e", "androidTest"}.intersection(path.parts)
            or path == Path(__file__).resolve().relative_to(ROOT) or not (ROOT / path).is_file()):
        return True
    good = True
    for number, line in enumerate((ROOT / path).read_text().splitlines(), 1):
        if line.lstrip().startswith(("//", "/*", "*", "# ")):
            continue
        if relative == "scripts/build-portal-parity-fixture.ts" and line.startswith("Object.defineProperty(globalThis,'localStorage',"):
            continue
        if any(relative not in owners and rule.search(line) for rule, owners in RULES):
            print(f"{path}:{number}: Use the shared asynchronous device storage API.", file=sys.stderr)
            good = False
    return good


if __name__ == "__main__":
    files = sys.argv[1:] or os.fsdecode(subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT)).split("\0")
    failures = sum(not check(Path(filename)) for filename in files if filename)
    if not failures:
        print("Device storage access check passed.")
    sys.exit(1 if failures else 0)
