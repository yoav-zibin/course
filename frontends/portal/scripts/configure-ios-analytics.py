"""Prepare the Firebase client registered to the exact TestFlight bundle."""
import os
from pathlib import Path
import plistlib


def main():
    raw = os.environ["BUILDPLAY_IOS_GOOGLE_SERVICES_PLIST"].encode()
    config = plistlib.loads(raw)
    if (config.get("BUNDLE_ID") != os.environ["IOS_PORTAL_BUNDLE_ID"]
            or ":ios:" not in config.get("GOOGLE_APP_ID", "") or not config.get("PROJECT_ID")):
        raise ValueError("The Firebase client must match the production iOS bundle.")
    target = Path(os.environ["RUNNER_TEMP"]) / "GoogleService-Info.plist"
    with os.fdopen(os.open(target, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600), "wb") as output:
        output.write(raw)
    with Path(os.environ["GITHUB_ENV"]).open("a") as env:
        env.write(f"BUILDPLAY_IOS_GOOGLE_SERVICES_FILE={target}\n")


if __name__ == "__main__":
    main()
