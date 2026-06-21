"""Tests for respond._generate's subprocess hardening (PR #73 parity).

Kept in a separate module from test_respond.py so this change doesn't touch
the identity/selection suite another change is editing in parallel.

The invariant: the headless `claude` call MUST be wall-clock capped, and a
timeout MUST be swallowed like any other generation failure (return None) so
a hung CLI can never block Flux's heartbeat pulse forever.
"""

from __future__ import annotations

import subprocess

from src import respond


class _FakeCompleted:
    def __init__(self, stdout: str) -> None:
        self.stdout = stdout
        self.returncode = 0


def test_generate_passes_timeout_to_subprocess(monkeypatch):
    """_generate must pass a positive `timeout=` so the call can't hang
    the pulse indefinitely."""
    captured: dict = {}

    def fake_run(*args, **kwargs):
        captured.update(kwargs)
        return _FakeCompleted("a reply")

    monkeypatch.setattr(respond.subprocess, "run", fake_run)
    out = respond._generate("prompt")

    assert out == "a reply"
    assert "timeout" in captured, "subprocess.run must be called with timeout="
    assert isinstance(captured["timeout"], (int, float))
    assert captured["timeout"] > 0
    # It uses the module's named constant, not a stray magic number.
    assert captured["timeout"] == respond._CLAUDE_TIMEOUT_SEC


def test_generate_returns_none_on_timeout(monkeypatch):
    """A TimeoutExpired must be caught and surfaced as None (nothing to
    say), matching the other generation-failure paths."""

    def fake_run(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="claude", timeout=kwargs.get("timeout", 0))

    monkeypatch.setattr(respond.subprocess, "run", fake_run)
    assert respond._generate("prompt") is None


def test_generate_returns_none_on_called_process_error(monkeypatch):
    """Regression guard: the existing CalledProcessError path still works
    after widening the except to include TimeoutExpired."""

    def fake_run(*args, **kwargs):
        raise subprocess.CalledProcessError(returncode=1, cmd="claude")

    monkeypatch.setattr(respond.subprocess, "run", fake_run)
    assert respond._generate("prompt") is None
