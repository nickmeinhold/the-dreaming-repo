"""Tests for src/_integration.py — the shared hardened integration layer.

These pin the three invariants the module exists to enforce: no subprocess can
hang the heartbeat (timeout → typed failure), two logins for the same actor
compare equal (identity normalization), and a gh error object is never read as
data (API-shape validation).
"""

from __future__ import annotations

import subprocess

import pytest

from src import _integration as integ


# --------------------------------------------------------------------------
# 1. run / run_claude — timeout-enforced subprocess
# --------------------------------------------------------------------------

class TestRun:
    def test_success(self):
        res = integ.run(["true"], timeout=5)
        assert res.ok and not res.timed_out and res.returncode == 0

    def test_nonzero_exit_is_not_ok_with_check(self):
        res = integ.run(["false"], timeout=5)
        assert not res.ok and res.returncode == 1 and not res.timed_out

    def test_nonzero_exit_is_ok_with_check_false(self):
        """check=False: a non-zero exit is an expected outcome, not a failure."""
        res = integ.run(["false"], timeout=5, check=False)
        assert res.ok and res.returncode == 1

    def test_timeout_returns_typed_failure_not_raise(self):
        """The case the old code lost: neither success nor CalledProcessError,
        but a hang. Must surface as timed_out, never raise."""
        res = integ.run(["sleep", "5"], timeout=1)
        assert not res.ok and res.timed_out and res.returncode is None

    def test_missing_binary_is_typed_failure(self):
        res = integ.run(["this-binary-does-not-exist-xyz"], timeout=5)
        assert not res.ok and not res.timed_out and res.returncode is None

    def test_input_is_piped_to_stdin(self):
        res = integ.run(["cat"], timeout=5, input="hello from stdin")
        assert res.ok and res.stdout == "hello from stdin"

    def test_captures_stdout_and_stderr(self):
        res = integ.run(["sh", "-c", "echo out; echo err >&2"], timeout=5)
        assert "out" in res.stdout and "err" in res.stderr


class TestRunClaude:
    def test_pipes_prompt_via_stdin_not_argv(self, monkeypatch):
        """The ARG_MAX-safety invariant (cage-match #4, generalized): the
        prompt must go to stdin, never onto the command line."""
        captured = {}

        def fake_run(cmd, *, timeout, input=None, check=True):
            captured["cmd"] = cmd
            captured["input"] = input
            return integ.RunResult(True, "  a reply  ", "", 0, False)

        monkeypatch.setattr(integ, "run", fake_run)
        out = integ.run_claude("a very long prompt", model="haiku")

        assert out == "a reply", "stdout must be stripped"
        assert captured["input"] == "a very long prompt", "prompt must be on stdin"
        assert "a very long prompt" not in captured["cmd"], "prompt must NOT be argv"
        assert captured["cmd"] == ["claude", "-p", "--model", "haiku"]

    def test_system_prompt_goes_on_argv(self, monkeypatch):
        captured = {}
        monkeypatch.setattr(integ, "run", lambda cmd, **k: captured.update(cmd=cmd) or integ.RunResult(True, "x", "", 0, False))
        integ.run_claude("p", system_prompt="be brief")
        assert "--system-prompt" in captured["cmd"]
        assert "be brief" in captured["cmd"]

    def test_failure_returns_none(self, monkeypatch):
        monkeypatch.setattr(integ, "run", lambda cmd, **k: integ.RunResult(False, "", "boom", 1, False))
        assert integ.run_claude("p") is None

    def test_timeout_returns_none(self, monkeypatch):
        monkeypatch.setattr(integ, "run", lambda cmd, **k: integ.RunResult(False, "", "", None, True))
        assert integ.run_claude("p") is None

    def test_empty_output_returns_none(self, monkeypatch):
        """An ok call with whitespace-only stdout is 'nothing to say' → None."""
        monkeypatch.setattr(integ, "run", lambda cmd, **k: integ.RunResult(True, "   \n  ", "", 0, False))
        assert integ.run_claude("p") is None


# --------------------------------------------------------------------------
# 2. Identity normalization
# --------------------------------------------------------------------------

class TestIdentity:
    @pytest.mark.parametrize("raw, expected", [
        ("flux-dreaming-repo[bot]", "flux-dreaming-repo"),
        ("flux-dreaming-repo", "flux-dreaming-repo"),
        ("Flux-Dreaming-Repo[bot]", "flux-dreaming-repo"),
        ("  flux-dreaming-repo[bot]  ", "flux-dreaming-repo"),
        ("", ""),
        (None, ""),
    ])
    def test_normalize_login(self, raw, expected):
        assert integ.normalize_login(raw) == expected

    def test_is_self_suffix_insensitive(self):
        """The exact load/decide asymmetry that caused the self-reply loop:
        GraphQL (no suffix) vs REST (suffix) must compare equal."""
        assert integ.is_self("flux-dreaming-repo", self_login="flux-dreaming-repo[bot]")
        assert integ.is_self("flux-dreaming-repo[bot]", self_login="flux-dreaming-repo")

    def test_is_self_case_insensitive(self):
        assert integ.is_self("Flux-Dreaming-Repo", self_login="flux-dreaming-repo[bot]")

    def test_is_self_rejects_other_and_empty(self):
        assert not integ.is_self("flux-shadow[bot]", self_login="flux-dreaming-repo[bot]")
        assert not integ.is_self("", self_login="flux-dreaming-repo[bot]")
        assert not integ.is_self("anyone", self_login=""), "empty self_login is never self"


# --------------------------------------------------------------------------
# 3. API-shape validation + REST comment parsing
# --------------------------------------------------------------------------

class TestGhShape:
    def test_is_gh_error_with_documentation_url(self):
        assert integ.is_gh_error({"message": "Not Found", "documentation_url": "https://..."})

    def test_is_gh_error_with_status(self):
        """Real gh 404 bodies carry `status` and may omit documentation_url."""
        assert integ.is_gh_error({"message": "Not Found", "status": "404"})

    def test_message_only_dict_is_not_error(self):
        """A data dict that merely contains a `message` field (e.g. a commit)
        must NOT be misclassified as an error."""
        assert not integ.is_gh_error({"message": "fix the thing", "sha": "abc"})

    def test_list_is_not_error(self):
        assert not integ.is_gh_error([{"x": 1}])

    def test_gh_json_parses_data(self):
        assert integ.gh_json('[{"a": 1}]') == [{"a": 1}]

    def test_gh_json_none_on_error_object(self):
        assert integ.gh_json('{"message": "Not Found", "status": "404"}') is None

    def test_gh_json_none_on_garbage_or_empty(self):
        assert integ.gh_json("not json") is None
        assert integ.gh_json("") is None
        assert integ.gh_json(None) is None

    def test_parse_comments_maps_rest_shape_preserving_bot_suffix(self):
        out = (
            '[{"user": {"login": "nickmeinhold"}, "created_at": "t0", "body": "q?"},'
            ' {"user": {"login": "flux-dreaming-repo[bot]"}, "created_at": "t1", "body": "a"}]'
        )
        comments = integ.parse_comments(out)
        assert [c.login for c in comments] == ["nickmeinhold", "flux-dreaming-repo[bot]"]
        assert comments[1].login.endswith("[bot]"), "REST suffix must survive — the loop fix"
        assert comments[0].created_at == "t0"

    def test_parse_comments_drops_malformed_and_guards_non_dict_user(self):
        out = (
            '[{"user": {"login": "a"}, "created_at": "t", "body": "x"},'
            ' "not-a-comment",'
            ' {"user": null, "created_at": "t", "body": "ghost"},'
            ' {"user": "stringly", "created_at": "t", "body": "weird"}]'
        )
        comments = integ.parse_comments(out)
        assert len(comments) == 3, "the bare string element is dropped"
        assert comments[1].login == "" and comments[2].login == "", "null/non-dict user → empty"

    def test_parse_comments_error_object_is_empty(self):
        assert integ.parse_comments('{"message": "Not Found", "status": "404"}') == []
