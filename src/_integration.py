"""Shared hardened layer for Flux's external integrations.

Every place Flux touches the outside world — the `claude` CLI, the `gh` CLI,
the GitHub REST/GraphQL APIs — used to re-implement the same three concerns
slightly differently and get at least one of them wrong. A retrospective
(cage-match on the heartbeat) named the pattern as a *proprioception failure*:
the agent could not reliably sense its own identity or the effect of its own
actions. Three concrete failures came out of it:

1. **No enforced timeout.** A hung `claude -p` or `gh` call froze the whole
   30-minute heartbeat pulse. (PR #73, PR #77.)
2. **No identity normalization.** REST returns `flux-dreaming-repo[bot]`;
   GraphQL returns `flux-dreaming-repo` — code comparing one against a constant
   written for the other silently failed. This was the self-reply loop. (#78.)
3. **No API-shape validation.** `gh api` returns a JSON *object*
   `{"message": ...}` on error but an *array* on success; code that iterated
   the error object as data crashed or misbehaved.

This module makes each concern a single invariant enforced in ONE place that
every integration point routes through, per the design in
`docs/integration-helper-design.md`. It is the antidote, not another patch.

Reconciliations vs. that design doc (verified against the live code, 2026-06-23):
- `run` takes an `input` parameter, and `run_claude` ALWAYS pipes the prompt
  via stdin rather than as an argv element. `respond.py` learned the hard way
  (cage-match #4) that issue *threads* can exceed `ARG_MAX` (~128KB) on the
  command line; stdin is unbounded and has no downside, so the helper makes
  the ARG_MAX-safe path universal instead of respond-only.
- `is_gh_error` accepts `status` as well as `documentation_url` alongside
  `message` — real `gh api` 404 bodies carry `status`, and not every error
  body carries `documentation_url`. `fetch_issue_comments` additionally
  requires the success payload to be a `list`, so an error object can never be
  mistaken for comment data even if the error shape drifts.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass

# claude calls are slow (model inference); gh/git calls are fast (network/local).
DEFAULT_CLAUDE_TIMEOUT = 120  # matches the established convention (PR #73)
DEFAULT_GH_TIMEOUT = 60

# The lone source of truth for the App-bot suffix the two GitHub APIs disagree
# on. REST keeps it; GraphQL strips it. (See #78 / reference_gh_bot_login.)
BOT_SUFFIX = "[bot]"


# --------------------------------------------------------------------------
# 1. Timeout-enforced subprocess wrapper
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class RunResult:
    """A subprocess outcome that can never silently swallow a hang.

    `ok=False` with `timed_out=True` is the case the old per-site code lost: a
    call that neither succeeded nor raised `CalledProcessError`, but ran
    forever. Branch on `.ok` / `.timed_out` instead of re-deriving a (subtly
    different) `except` tuple at every call site.
    """

    ok: bool
    stdout: str
    stderr: str
    returncode: int | None
    timed_out: bool


def run(
    cmd: list[str],
    *,
    timeout: int,
    input: str | None = None,
    check: bool = True,
) -> RunResult:
    """Run a subprocess with a MANDATORY timeout, returning a typed result.

    Never raises `TimeoutExpired` or `CalledProcessError` up to the caller —
    those become `RunResult` fields, so one bad external call can't crash the
    heartbeat pulse.

    `input` is piped to the child's stdin (used for `claude -p`, where the
    prompt must not go on the command line — ARG_MAX). `check=True` (the
    default) marks a non-zero exit as `ok=False`; pass `check=False` when a
    non-zero exit is an expected, non-error outcome.
    """
    try:
        proc = subprocess.run(
            cmd,
            input=input,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return RunResult(False, "", "", None, timed_out=True)
    except FileNotFoundError as e:
        return RunResult(False, "", str(e), None, timed_out=False)

    ok = (proc.returncode == 0) or (not check)
    return RunResult(
        ok=ok,
        stdout=proc.stdout or "",
        stderr=proc.stderr or "",
        returncode=proc.returncode,
        timed_out=False,
    )


def run_claude(
    prompt: str,
    *,
    model: str = "sonnet",
    system_prompt: str | None = None,
    timeout: int = DEFAULT_CLAUDE_TIMEOUT,
) -> str | None:
    """Run `claude -p` and return stripped stdout, or None on ANY failure.

    Subsumes the duplicated claude runners across dream/greet/birth/mortality/
    reach/metrics/propose/respond. The prompt is piped via STDIN, never argv,
    so an arbitrarily long prompt (an issue thread, a memory dump) can't hit
    ARG_MAX (cage-match #4, generalized).

    A timeout / non-zero exit / missing CLI / empty output all collapse to
    `None`. Fallback is the CALLER's job: a site called unguarded in the
    heartbeat (dream.generate, mortality.last_dream) must still supply its own
    fallback string via `run_claude(...) or "<fallback>"`. The wrapper
    guarantees "no hang, no uncaught raise"; it does not guarantee a value.
    """
    cmd = ["claude", "-p", "--model", model]
    if system_prompt is not None:
        cmd += ["--system-prompt", system_prompt]
    res = run(cmd, input=prompt, timeout=timeout)
    if not res.ok:
        return None
    out = res.stdout.strip()
    return out or None


# --------------------------------------------------------------------------
# 2. Identity normalization — one predicate for "is this login me?"
# --------------------------------------------------------------------------

def normalize_login(login: str | None) -> str:
    """Strip the REST-only `[bot]` suffix and lowercase, so REST and GraphQL
    logins for the same actor compare equal.

        normalize_login("flux-dreaming-repo[bot]") == "flux-dreaming-repo"
        normalize_login("flux-dreaming-repo")      == "flux-dreaming-repo"
        normalize_login("Flux-Dreaming-Repo")      == "flux-dreaming-repo"

    Lowercasing matters because GitHub logins are case-insensitive; comparing
    raw forms would miss a casing mismatch the same way the suffix mismatch was
    missed. This is the single source of truth for #10.
    """
    if not login:
        return ""
    login = login.strip()
    if login.endswith(BOT_SUFFIX):
        login = login[: -len(BOT_SUFFIX)]
    return login.lower()


def is_self(login: str | None, *, self_login: str) -> bool:
    """True iff `login` names this bot, comparing under normalization.

    Applied at every "did I write this?" check — both the load side (filter my
    own comments out of a thread) and the decision side (don't reply to
    myself). The self-reply loop was exactly a load/decide asymmetry where one
    side normalized and the other didn't; routing both through this predicate
    makes that impossible. Empty `self_login` is never self (degrade
    conservatively: nothing counts as me, rather than everything).
    """
    if not self_login:
        return False
    return normalize_login(login) == normalize_login(self_login)


# --------------------------------------------------------------------------
# 3. API-shape validation + REST-preferring fetch
# --------------------------------------------------------------------------

def _is_http_error_status(value: object) -> bool:
    """True if `value` looks like a gh-api error `status` — a 4xx/5xx HTTP
    code string like "404". A data field that happens to be named `status`
    (`"completed"`, `"open"`, `"200"`) is not an error signal (cage-match #81,
    Carnot): keying off the bare *presence* of `status` would make `gh_json`
    discard a legitimate data object that carried both `message` and `status`.
    """
    s = str(value).strip()
    return len(s) == 3 and s.isdigit() and s[0] in ("4", "5")


def is_gh_error(payload: object) -> bool:
    """True if a parsed `gh api` payload is an error object, not data.

    `gh api` returns `{"message": "...", "documentation_url": "..."}` and/or
    `{"message": "...", "status": "404"}` on error, but a list (or a data
    object) on success. Iterating an error object as if it were a list of
    items was the third proprioception bug. We key off `message` plus an
    error-ONLY companion — a `documentation_url`, or a `status` that is an
    actual 4xx/5xx HTTP code — so a legitimate data dict that merely contains
    a `message` (a commit) or a benign `status` (a run: `"completed"`) isn't
    misclassified.
    """
    if not (isinstance(payload, dict) and "message" in payload):
        return False
    return "documentation_url" in payload or _is_http_error_status(payload.get("status"))


def gh_json(out: str | None) -> object | None:
    """Parse `gh api` stdout into data, or None on empty/unparseable/error.

    The caller never sees an error object wearing data's clothes: a recognized
    gh error object (`is_gh_error`) maps to None just like a parse failure.
    """
    if not out:
        return None
    try:
        payload = json.loads(out)
    except json.JSONDecodeError:
        return None
    if is_gh_error(payload):
        return None
    return payload


@dataclass(frozen=True)
class GhComment:
    """A GitHub issue/PR comment in the one shape Flux reads.

    REST is preferred over GraphQL precisely because its `user.login` carries
    the `[bot]` suffix, which round-trips through `normalize_login` /
    `is_self` consistently. One fetch shape feeding one identity predicate.
    """

    login: str
    body: str
    created_at: str


def parse_comments(out: str | None) -> list[GhComment]:
    """Map `gh api .../comments` (REST) stdout onto `GhComment`s.

    Anything that isn't a JSON array — an error object, a malformed body — and
    any non-dict element is dropped rather than crashing the heartbeat. A
    non-dict `user` (string/number) yields an empty login rather than raising.
    """
    payload = gh_json(out)
    if not isinstance(payload, list):
        return []
    comments: list[GhComment] = []
    for c in payload:
        if not isinstance(c, dict):
            continue
        user = c.get("user")
        login = user.get("login", "") if isinstance(user, dict) else ""
        comments.append(
            GhComment(
                login=login,
                body=c.get("body", "") or "",
                created_at=c.get("created_at", "") or "",
            )
        )
    return comments
