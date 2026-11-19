"""Exercise signed Play builds, versioning and stale-run guards without credentials."""
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
    jarsigner = bin_dir / "jarsigner"
    jarsigner.write_text("#!/bin/sh\n[ -z \"$FAIL_SIGNATURE\" ] || exit 1\nprintf 'jar verified\\n'\n")
    jarsigner.chmod(0o755)
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


def test_signature_verification_failure_blocks_publication(build):
    run, _, _, _ = build
    assert run("Write upload keystore").returncode == 0
    assert run("Build signed AAB for Play", FAIL_SIGNATURE="1").returncode != 0


def assign_version(tmp_path, run, attempt):
    env_path, output_path = tmp_path / "env", tmp_path / "output"
    result = subprocess.run(["bash", "-e", "-o", "pipefail", "-c", step("Assign immutable Play version code")],
                            env={**os.environ, "GITHUB_RUN_NUMBER": str(run), "GITHUB_RUN_ATTEMPT": str(attempt),
                                 "GITHUB_ENV": str(env_path), "GITHUB_OUTPUT": str(output_path)},
                            capture_output=True, text=True)
    return result, env_path, output_path


@pytest.mark.parametrize(("run", "attempt", "expected"), [(1, 1, 101), (1, 99, 199), (2, 1, 201), (20999999, 99, 2099999999)])
def test_play_versions_increase_for_new_runs_and_retries(tmp_path, run, attempt, expected):
    result, env_path, output_path = assign_version(tmp_path, run, attempt)
    assert result.returncode == 0, result.stderr
    assert env_path.read_text() == f"BUILDPLAY_ANDROID_VERSION_CODE={expected}\n"
    assert output_path.read_text() == f"code={expected}\n"


@pytest.mark.parametrize(("run", "attempt"), [(0, 1), (1, 0), (1, 100), (21000000, 1)])
def test_play_version_range_refuses_collisions_and_overflow(tmp_path, run, attempt):
    result, env_path, output_path = assign_version(tmp_path, run, attempt)
    assert result.returncode != 0
    assert not env_path.exists() and not output_path.exists()


@pytest.fixture
def source_repo(tmp_path):
    repository = tmp_path / "repo"
    repository.mkdir()
    remote = tmp_path / "upstream.git"
    subprocess.run(["git", "init", "--bare", "--initial-branch=main", str(remote)], check=True, capture_output=True)

    def git(*args):
        return subprocess.run(["git", *args], cwd=repository, check=True, capture_output=True, text=True).stdout.strip()

    git("init", "--initial-branch=main")
    git("config", "user.name", "Play workflow tests")
    git("config", "user.email", "play-workflow@example.invalid")
    git("remote", "add", "origin", str(remote))

    def commit(filename):
        path = repository / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(path.read_text() + "\nchange" if path.exists() else "change")
        git("add", filename)
        git("commit", "-m", "Synthetic workflow input")
        git("push", "origin", "HEAD:main")
        return git("rev-parse", "HEAD")

    source = commit("frontends/portal/app.config.ts")

    def current(candidate=source):
        output, summary = tmp_path / "current-output", tmp_path / "summary"
        output.unlink(missing_ok=True)
        result = subprocess.run(["bash", "-e", "-o", "pipefail", "-c", step("Check latest Play build inputs")],
                                cwd=repository, env={**os.environ, "SOURCE_SHA": candidate,
                                "GITHUB_OUTPUT": str(output), "GITHUB_STEP_SUMMARY": str(summary)},
                                capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        return output.read_text()

    return commit, current, git


def test_unrelated_main_push_does_not_drop_the_only_frontend_build(source_repo):
    commit, current, _ = source_repo
    assert current() == "publish=true\n"
    commit("docs/readme.md")
    assert current() == "publish=true\n"


@pytest.mark.parametrize("filename", ["frontends/portal/app.config.ts", "scripts/publish-play-aab.py", "scripts/play_bundle.py", ".github/workflows/play-aab.yml"])
def test_newer_play_inputs_skip_an_old_completed_build(source_repo, filename):
    commit, current, _ = source_repo
    commit(filename)
    assert current() == "publish=false\n"


def test_source_outside_main_cannot_publish_even_with_identical_build_inputs(source_repo):
    commit, current, git = source_repo
    git("checkout", "-b", "unmerged")
    candidate = commit("docs/unmerged.md")
    git("push", "--force", "origin", "HEAD~1:main")
    assert current(candidate) == "publish=false\n"
