"""Exercise the manual workflow with synthetic credentials and a fake Gradle."""
import base64
import json
import os
from pathlib import Path
import subprocess

import pytest


WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/play-aab.yml"
PASSWORD = "synthetic password: = # & \\ only-for-tests"


def step(name):
    lines = WORKFLOW.read_text().splitlines()
    start = lines.index("      - name: " + name)
    start = next(i for i in range(start, len(lines)) if lines[i] == "        run: |") + 1
    body = []
    for line in lines[start:]:
        if line and not line.startswith("          "):
            break
        body.append(line[10:] if line else "")
    return "\n".join(body)


@pytest.fixture
def build(tmp_path):
    app = tmp_path / "app"
    (app / "android").mkdir(parents=True)
    runner, workspace, bin_dir = (tmp_path / name for name in ("runner", "workspace", "bin"))
    for directory in (runner, workspace, bin_dir):
        directory.mkdir()
    capture = tmp_path / "gradle-inputs.json"
    fake = tmp_path / "fake-gradle.py"
    fake.write_text("""import json, os, pathlib, sys
pathlib.Path(os.environ['CAPTURE']).write_text(json.dumps({
    'args': sys.argv[1:],
    'properties': {key.removeprefix('ORG_GRADLE_PROJECT_'): value
                   for key,value in os.environ.items() if key.startswith('ORG_GRADLE_PROJECT_')},
}))
if os.environ.get('FAIL_GRADLE'): sys.exit(23)
bundle=pathlib.Path('android/app/build/outputs/bundle/release/app-release.aab')
bundle.parent.mkdir(parents=True,exist_ok=True)
bundle.write_bytes(b'synthetic bundle fixture')
print('Synthetic Gradle finished')
""")
    (app / "android/gradlew").write_text('exec python3 "$FAKE_GRADLE" "$@"\n')
    keytool = bin_dir / "keytool"
    keytool.write_text("#!/bin/sh\nprintf 'SHA256: synthetic-certificate-fingerprint\\n'\n")
    keytool.chmod(0o755)
    inherited = {key: value for key, value in os.environ.items() if not key.startswith("ORG_GRADLE_PROJECT_")}
    env = {**inherited, "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
           "RUNNER_TEMP": str(runner), "GITHUB_WORKSPACE": str(workspace),
           "KEYSTORE_BASE64": base64.b64encode(b"synthetic keystore fixture").decode(),
           "KEYSTORE_PASSWORD": PASSWORD, "FAKE_GRADLE": str(fake), "CAPTURE": str(capture)}

    def run(name, **overrides):
        return subprocess.run(["bash", "-e", "-o", "pipefail", "-c", "umask 022\n" + step(name)],
                              cwd=app, env={**env, **overrides}, capture_output=True, text=True)

    return run, capture, runner / "upload.keystore", workspace


def test_configured_password_reaches_gradle_without_command_line_or_log_exposure(build):
    run, capture, _, workspace = build
    assert run("Write upload keystore").returncode == 0
    result = run("Build signed AAB for Play")
    assert result.returncode == 0, result.stderr
    inputs = json.loads(capture.read_text())
    for kind in ("store", "key"):
        assert inputs["properties"][f"android.injected.signing.{kind}.password"] == PASSWORD
    assert PASSWORD not in " ".join(inputs["args"])
    assert PASSWORD not in result.stdout + result.stderr + (workspace / "buildplay-aab-build.log").read_text()
    assert (workspace / "BuildPlay.aab").read_bytes() == b"synthetic bundle fixture"


def test_upload_keystore_is_private_and_byte_identical(build):
    run, _, key, _ = build
    assert run("Write upload keystore").returncode == 0
    assert key.read_bytes() == b"synthetic keystore fixture"
    assert key.stat().st_mode & 0o777 == 0o600


def test_missing_password_fails_before_gradle_or_artifact_creation(build):
    run, capture, _, workspace = build
    assert run("Write upload keystore").returncode == 0
    result = run("Build signed AAB for Play", KEYSTORE_PASSWORD="")
    assert result.returncode != 0
    assert not capture.exists() and not (workspace / "BuildPlay.aab").exists()


def test_missing_keystore_secret_fails_before_writing_a_key(build):
    run, _, key, _ = build
    assert run("Write upload keystore", KEYSTORE_BASE64="").returncode != 0
    assert not key.exists()


def test_failed_build_still_allows_private_key_cleanup(build):
    run, _, key, _ = build
    assert run("Write upload keystore").returncode == 0
    assert run("Build signed AAB for Play", FAIL_GRADLE="1").returncode != 0
    assert run("Remove upload keystore").returncode == 0
    assert not key.exists()
