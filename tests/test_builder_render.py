"""Node discovery for the build's screenshot stage (builder_render).

The production service runs under a minimal systemd PATH; a bare
subprocess call to 'node' died with '[Errno 2] No such file or
directory' on the first build that ever reached rendering, even though
nothing about the game was wrong. Discovery must check the usual
install locations, and absence must produce a clear platform error.
"""
import os
import stat

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


def test_missing_node_fails_with_a_clear_message(monkeypatch, tmp_path):
    monkeypatch.setattr(builder_render.shutil, 'which', lambda name: None)
    monkeypatch.setattr(builder_render.Path, 'home', staticmethod(lambda: tmp_path))
    monkeypatch.setattr(builder_render.os.path, 'isfile', lambda p: False)
    assert builder_render._node_binary() is None
    with pytest.raises(RuntimeError, match='Node.js was not found on the server'):
        builder_render.render_game('draft', 'job', '<html></html>', [])
