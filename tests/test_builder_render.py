"""Node discovery and failure reporting for the build's screenshot stage.

The production service runs under a minimal systemd PATH; a bare
subprocess call to 'node' died with '[Errno 2] No such file or
directory' on the first build that ever reached rendering, even though
nothing about the game was wrong. Discovery must check the usual
install locations, and absence must produce a clear platform error.

Also covers the stderr filter: host-level agents banner every Node
process's stderr, and the raw banner once buried the actual screenshot
finding in the build's error message.
"""
import os
import stat
from types import SimpleNamespace

import pytest

from game_platform import builder_render


def _fake_node(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('#!/bin/sh\n')
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


def test_path_node_wins(monkeypatch):
    monkeypatch.setattr(builder_render.shutil, 'which', lambda name: '/somewhere/node')
    assert builder_render._node_binary() == '/somewhere/node'


def test_nvm_install_is_found_when_path_has_no_node(monkeypatch, tmp_path):
    node = _fake_node(tmp_path / '.nvm' / 'versions' / 'node' / 'v20.11.0' / 'bin' / 'node')
    monkeypatch.setattr(builder_render.shutil, 'which', lambda name: None)
    monkeypatch.setattr(builder_render.Path, 'home', staticmethod(lambda: tmp_path))
    # Keep the system locations of the machine running the tests out of it:
    # only files under tmp_path "exist".
    real_isfile = os.path.isfile
    monkeypatch.setattr(builder_render.os.path, 'isfile',
                        lambda p: str(p).startswith(str(tmp_path)) and real_isfile(p))
    assert builder_render._node_binary() == str(node)


def test_failure_detail_drops_host_agent_banners():
    stderr = ('DATADOG TRACER CONFIGURATION - {"service":"node","version":"6.21.0"}\n'
              'Error: UI verification failed: {"tinyTargets":81}\n'
              'DATADOG TRACER INTEGRATIONS LOADED - ["net","dns","fs"]\n')
    detail = builder_render._failure_detail(stderr)
    assert 'DATADOG' not in detail and 'tinyTargets' in detail


def test_render_failure_message_uses_the_filtered_detail(monkeypatch, tmp_path):
    monkeypatch.setattr(builder_render, '_node_binary', lambda: '/bin/node')
    monkeypatch.setattr(builder_render, 'ARTIFACT_ROOT', tmp_path)
    done = SimpleNamespace(returncode=1, stdout='',
                           stderr='DATADOG TRACER CONFIGURATION - {}\nError: UI verification failed: {"blank":true}\n')
    monkeypatch.setattr(builder_render.subprocess, 'run', lambda *args, **kwargs: done)
    with pytest.raises(RuntimeError) as excinfo:
        builder_render.render_game('draft', 'job', '<html></html>', [])
    assert 'DATADOG' not in str(excinfo.value) and 'blank' in str(excinfo.value)


def test_missing_node_fails_with_a_clear_message(monkeypatch, tmp_path):
    monkeypatch.setattr(builder_render.shutil, 'which', lambda name: None)
    monkeypatch.setattr(builder_render.Path, 'home', staticmethod(lambda: tmp_path))
    monkeypatch.setattr(builder_render.os.path, 'isfile', lambda p: False)
    assert builder_render._node_binary() is None
    with pytest.raises(RuntimeError, match='Node.js was not found on the server'):
        builder_render.render_game('draft', 'job', '<html></html>', [])


def test_preflight_reports_missing_node(monkeypatch, tmp_path):
    monkeypatch.setattr(builder_render.shutil, 'which', lambda name: None)
    monkeypatch.setattr(builder_render.Path, 'home', staticmethod(lambda: tmp_path))
    monkeypatch.setattr(builder_render.os.path, 'isfile', lambda p: False)
    ok, detail = builder_render.preflight_browser()
    assert not ok and 'Node.js was not found' in detail


def test_preflight_reports_missing_playwright(monkeypatch):
    monkeypatch.setattr(builder_render, '_node_binary', lambda: '/bin/node')
    done = SimpleNamespace(returncode=1, stdout='',
                           stderr="Error: Cannot find module 'playwright'\n")
    monkeypatch.setattr(builder_render.subprocess, 'run', lambda *args, **kwargs: done)
    ok, detail = builder_render.preflight_browser()
    assert not ok and 'playwright' in detail


def test_preflight_reports_an_unrunnable_node(monkeypatch):
    monkeypatch.setattr(builder_render, '_node_binary', lambda: '/bin/node')
    def run(*args, **kwargs):
        raise OSError('permission denied')
    monkeypatch.setattr(builder_render.subprocess, 'run', run)
    ok, detail = builder_render.preflight_browser()
    assert not ok and 'could not be run' in detail


def test_preflight_passes_when_the_module_resolves(monkeypatch):
    monkeypatch.setattr(builder_render, '_node_binary', lambda: '/bin/node')
    seen = {}
    def run(command, **kwargs):
        seen['command'] = command
        return SimpleNamespace(returncode=0, stdout='/repo/node_modules/playwright/index.js', stderr='')
    monkeypatch.setattr(builder_render.subprocess, 'run', run)
    ok, detail = builder_render.preflight_browser()
    assert ok and detail == ''
    # The check resolves from the render script's own directory — the
    # same walk Node does for the script's require('playwright').
    assert seen['command'][0] == '/bin/node' and seen['command'][-1].endswith('scripts')
