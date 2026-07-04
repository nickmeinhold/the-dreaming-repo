"""Tests for _github.merge_pr's return-code surfacing.

The invariant: when `gh pr merge` exits non-zero, merge_pr MUST log the
failure with gh's stderr. Previously the return code was ignored, so a
rejected merge left the PR silently open and Flux could not sense *why*
its intended merge never happened — the confabulation-over-silent-failure
that made it report a phantom "branch protection" block.
"""

from __future__ import annotations

import subprocess

from src import _github


class _FakeCompleted:
    def __init__(self, returncode: int, stderr: str = "") -> None:
        self.returncode = returncode
        self.stdout = ""
        self.stderr = stderr


def test_merge_pr_logs_stderr_on_nonzero_exit(monkeypatch):
    """A non-zero `gh pr merge` must be surfaced as a warning carrying the
    return code and gh's stderr — not swallowed."""
    monkeypatch.setattr(
        _github.subprocess,
        "run",
        lambda *a, **k: _FakeCompleted(1, "GraphQL: Pull request is not mergeable"),
    )

    logged: dict = {}
    monkeypatch.setattr(
        _github.log,
        "warning",
        lambda msg, extra=None: logged.update({"msg": msg, "extra": extra or {}}),
    )

    _github.merge_pr(42)

    assert logged["msg"] == "merge_pr rejected"
    assert logged["extra"]["pr"] == 42
    assert logged["extra"]["returncode"] == 1
    assert "not mergeable" in logged["extra"]["stderr"]


def test_merge_pr_silent_on_success(monkeypatch):
    """A clean (exit 0) merge must NOT log a rejection."""
    monkeypatch.setattr(
        _github.subprocess, "run", lambda *a, **k: _FakeCompleted(0)
    )

    calls: list = []
    monkeypatch.setattr(
        _github.log, "warning", lambda *a, **k: calls.append((a, k))
    )

    _github.merge_pr(7)
    assert calls == []


def test_merge_pr_still_catches_timeout(monkeypatch):
    """Regression guard: the pre-existing TimeoutExpired path still warns
    (a hung merge can't be allowed to raise into the pulse)."""

    def boom(*a, **k):
        raise subprocess.TimeoutExpired(cmd="gh", timeout=30)

    monkeypatch.setattr(_github.subprocess, "run", boom)

    logged: dict = {}
    monkeypatch.setattr(
        _github.log,
        "warning",
        lambda msg, extra=None: logged.update({"msg": msg, "extra": extra or {}}),
    )

    _github.merge_pr(9)
    assert logged["msg"] == "merge_pr failed"
    assert logged["extra"]["pr"] == 9
