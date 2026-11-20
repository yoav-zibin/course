"""Install only the invite-capacity policy, reusing configured admin channels.

Run with --project PROJECT after authenticating gcloud as a Monitoring editor.
--channels may override the generic minor policy's existing channels. Existing
server policies, channels, and their enabled/disabled settings are preserved.
"""

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

from policies import INVITE_POLICY_NAME, invite_code_policy


def install(project, *, channels=None, run=subprocess.run):
    def gcloud(*args):
        result = run(["gcloud", "--project=" + project, "--quiet", *args],
                     check=True, text=True, capture_output=True)
        return json.loads(result.stdout) if result.stdout.strip() else None

    existing = gcloud("monitoring", "policies", "list", "--format=json") or []
    if channels is None:
        source = next((p for p in existing if p.get("displayName") ==
                       "Game platform: minor alert from the server's log"), {})
        channels = source.get("notificationChannels", [])
    if not channels:
        raise ValueError("No configured admin notification channels; supply --channels")
    prefix = f"projects/{project}/notificationChannels/"
    if any(not channel.startswith(prefix) for channel in channels):
        raise ValueError("Notification channels must belong to the selected project")
    desired = invite_code_policy(list(dict.fromkeys(channels)))
    matches = [p for p in existing if p.get("displayName") == INVITE_POLICY_NAME]
    if len(matches) > 1:
        raise ValueError("Multiple invite policies exist; reconcile them before installing")
    with tempfile.TemporaryDirectory(prefix="buildplay-invite-alert-") as directory:
        policy_file = Path(directory) / "policy.json"
        policy_file.write_text(json.dumps(desired), encoding="utf-8")
        if matches:
            current = matches[0]
            # Compare the managed fields; Google adds names and timestamps.
            comparable = {key: current.get(key) for key in desired}
            comparable["conditions"] = [
                {key: value for key, value in condition.items() if key != "name"}
                for condition in current.get("conditions", [])]
            if comparable == desired:
                return current["name"]
            result = gcloud("monitoring", "policies", "update", current["name"],
                            "--policy-from-file=" + str(policy_file), "--format=json")
        else:
            result = gcloud("monitoring", "policies", "create",
                            "--policy-from-file=" + str(policy_file), "--format=json")
    return result["name"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--channels", help="Comma-separated existing channel resource names")
    args = parser.parse_args()
    channels = args.channels.split(",") if args.channels else None
    print(install(args.project, channels=channels))


if __name__ == "__main__":
    main()
