# Design proposal: a shared hardened integration layer (`src/_integration.py`)

> **Status: PROPOSAL.** This document designs a module; it does **not** implement it.
> Implementation is deliberately deferred because the call-site migrations would
> collide with two sibling PRs in flight (the `respond.py` GraphQL-login fix and the
> `correspondence.py`/timeout work). Merge this design first, migrate after the
> siblings land.

## The disease this cures

A retrospective on two recent incidents — a bot-login self-reply loop and a
timeout-less `claude` subprocess that can hang the heartbeat — named a single root
pattern: **Flux's interaction points with every external service are happy-path code
with no shared hardening.** Concretely, every place Flux touches GitHub (`gh`
REST/GraphQL), the `claude` CLI, or Telegram re-implements the same three concerns
slightly differently, and gets at least one of them wrong:

1. **No enforced timeout.** A hung `claude -p` or `gh` call freezes the GitHub Actions
   pulse until the job's own wall-clock kills it. (See the companion audit PR: ~11
   call sites, several with no timeout at all.)
2. **No identity normalization.** REST returns `flux-dreaming-repo[bot]`; GraphQL
   returns `flux-dreaming-repo`. Code that compares a login from one source against a
   constant written for the other silently fails — this is the bot-login self-reply
   loop. Flux literally could not recognise its own voice.
3. **No API-shape validation.** `gh api` returns a JSON **object** `{"message": "Not
   Found", ...}` on error but an **array** on success. Code that does
   `json.loads(...)` and iterates assumes the array shape; the error object either
   throws or, worse, is treated as a one-element thing.

Kelvin framed this as a **proprioception failure**: the agent cannot reliably sense
its own identity or the effect of its own actions. The per-site patches (PR #1's
identity fix, PR #2's timeout) each fix *one instance* of *one* of these three
concerns. They do not make the concern impossible to get wrong at the next call site.
The antidote is to make each concern a single invariant enforced by one module that
every integration point routes through.

This is the *single-source-of-truth* discipline applied to behaviour, not just schema:
make ONE definition authoritative, have the rest reference it.

---

## Module sketch: `src/_integration.py`

Three small, independent surfaces. Each is usable on its own; a call site adopts only
the ones it needs.

### 1. Timeout-enforced subprocess wrapper

The invariant: **no subprocess call can hang the heartbeat.** A timeout is not
optional; it is the default, and exceeding it produces a *typed failure*, never a
silent hang and never an uncaught exception that crashes the pulse.

```python
import subprocess
from dataclasses import dataclass

# claude calls are slow (model inference); gh/git calls are fast (network/local).
DEFAULT_CLAUDE_TIMEOUT = 120   # matches the established convention (PR #73)
DEFAULT_GH_TIMEOUT = 60


@dataclass(frozen=True)
class RunResult:
    """A subprocess outcome that can never silently swallow a hang.

    ok=False with timed_out=True is the case the old code lost: a call that
    neither succeeded nor raised a CalledProcessError, but ran forever.
    """
    ok: bool
    stdout: str
    stderr: str
    returncode: int | None
    timed_out: bool


def run(cmd: list[str], *, timeout: int, check: bool = False) -> RunResult:
    """Run a subprocess with a MANDATORY timeout, returning a typed result.

    Never raises TimeoutExpired or CalledProcessError up to the caller — those
    become RunResult fields. The caller branches on `.ok` / `.timed_out`
    instead of wrapping every site in its own (subtly different) except tuple.
    """
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return RunResult(False, "", "", None, timed_out=True)
    except FileNotFoundError as e:
        return RunResult(False, "", str(e), None, timed_out=False)

    ok = proc.returncode == 0
    if check and not ok:
        ok = False
    return RunResult(ok, proc.stdout, proc.stderr, proc.returncode, timed_out=False)


def run_claude(prompt: str, *, model: str = "sonnet",
               system_prompt: str | None = None,
               timeout: int = DEFAULT_CLAUDE_TIMEOUT) -> str | None:
    """Run `claude -p` and return stripped stdout, or None on any failure.

    Subsumes the four-times-duplicated claude runner across dream.py,
    greet.py, birth.py, mortality.py, reach.py, metrics.py, propose.py —
    and the already-good one in _github.run_claude, which becomes a thin
    alias for this.
    """
    cmd = ["claude", "-p", "--model", model]
    if system_prompt is not None:
        cmd += ["--system-prompt", system_prompt]
    cmd.append(prompt)
    res = run(cmd, timeout=timeout)
    return res.stdout.strip() if res.ok and res.stdout.strip() else None
```

> **Design note — fallback is the caller's job, not the wrapper's.** `run_claude`
> returns `None`; sites like `dream.generate` / `mortality.last_dream` that are called
> *unguarded* in the heartbeat must still supply their own fallback *string* (a quiet
> night, a plain epitaph). The wrapper guarantees "no hang, no uncaught raise"; it does
> **not** guarantee a meaningful value. Keep the load/write contract honest: a call
> site that needs a non-None value is responsible for the `or <fallback>`.

### 2. Identity normalization

The invariant: **two logins that name the same actor compare equal**, regardless of
which API surfaced them.

```python
# The lone source of truth for "is this login me?".
BOT_SUFFIX = "[bot]"


def normalize_login(login: str | None) -> str:
    """Strip the REST-only `[bot]` suffix and lowercase, so REST and GraphQL
    logins for the same actor compare equal.

        normalize_login("flux-dreaming-repo[bot]") == "flux-dreaming-repo"
        normalize_login("flux-dreaming-repo")      == "flux-dreaming-repo"
    """
    if not login:
        return ""
    login = login.strip()
    if login.endswith(BOT_SUFFIX):
        login = login[: -len(BOT_SUFFIX)]
    return login.lower()


def is_self(login: str | None, *, self_login: str) -> bool:
    """True iff `login` names this bot, comparing under normalization.

    This is the predicate that, applied at every "did I write this?" check,
    closes the self-reply loop. self_login is read once from config/env, not
    hard-coded per site.
    """
    return normalize_login(login) == normalize_login(self_login)
```

> One predicate, used on both the load side (filtering "my own comments" out of a
> thread) and the decision side (don't reply to myself). The bot-login loop was
> precisely a *load/decide* asymmetry: one site stripped the suffix, another didn't.

### 3. API-shape validation + REST-preferring fetch

The invariant: **a `gh api` error object is never mistaken for data.**

```python
def is_gh_error(payload: object) -> bool:
    """True if a parsed gh-api payload is an error object, not data.

    gh api returns {"message": "...", "documentation_url": "..."} on error
    but a list (or a data object) on success. Iterating an error object as if
    it were a list of items is the third proprioception bug.
    """
    return isinstance(payload, dict) and "message" in payload and "documentation_url" in payload


def gh_json(cmd: list[str], *, timeout: int = DEFAULT_GH_TIMEOUT) -> object | None:
    """Run a `gh` command expected to emit JSON; return parsed data or None.

    Returns None on: timeout, non-zero exit, unparseable output, OR a
    recognised gh error object. The caller never sees an error object
    wearing data's clothes.
    """
    res = run(cmd, timeout=timeout)
    if not res.ok or not res.stdout.strip():
        return None
    try:
        payload = json.loads(res.stdout)
    except json.JSONDecodeError:
        return None
    if is_gh_error(payload):
        return None
    return payload


def fetch_issue_comments(repo: str, issue_number: int,
                         *, timeout: int = DEFAULT_GH_TIMEOUT) -> list[dict]:
    """REST-preferring comment fetch.

    REST is preferred over GraphQL here precisely because the identity field
    it returns (`user.login` = "...[bot]") round-trips through normalize_login
    consistently. One fetch shape feeding one identity predicate.
    """
    payload = gh_json(
        ["gh", "api", f"repos/{repo}/issues/{issue_number}/comments"],
        timeout=timeout,
    )
    return payload if isinstance(payload, list) else []
```

---

## Migration plan

The ~11 call sites adopt the helper in **risk-descending** order, so the highest-value
hardening lands first and each wave is independently shippable. The companion audit PR
has already applied the *per-site* timeout+except patches; this migration *subsumes*
those patches into the shared invariant (the local `except` tuples collapse into a
single `res.ok` branch, and the four duplicate claude-runners collapse into one
import).

| Wave | Sites | Concern subsumed | Why this order |
|---|---|---|---|
| **0 (done in audit PR)** | all ~11 | per-site `timeout=` + `TimeoutExpired` in except | stop the bleeding immediately, no shared module needed |
| **1** | `dream.generate` (352), `mortality.last_dream` (85), `birth.be_born` (120), `greet.generate_greeting` (84) | `run_claude` | the unguarded-in-heartbeat claude calls — highest hang blast radius |
| **2** | `reach` (214, 298), `metrics` (70), `propose` (170), `dream._fetch_unanswerable` (226) | `run_claude` + `gh_json` | the duplicate haiku runners; mechanical replacement |
| **3** | `respond.py`, `correspondence.py` | `is_self` / `normalize_login` + `run_claude` | **after the two sibling PRs land** — these files are owned elsewhere right now |
| **4** | `_github.py` (all `gh api` sites + `already_reviewed`, `flux_approved_but_open`) | `gh_json` + `is_gh_error` + `is_self` | `_github.run_claude` becomes an alias; `already_reviewed`'s `"bot" in c.lower()` heuristic is replaced by `is_self` |

Migration is mechanical and reviewable: each site's hand-rolled
`subprocess.run(...) + try/except(...)` becomes a single `_integration.*` call, and the
diff *removes* code. The invariant moves from "11 sites each remember to do three
things" to "1 module does three things; 11 sites call it."

### How it subsumes the per-site patches

- **PR #1 (identity fix)** hard-codes a `{"flux-dreaming-repo[bot]", ...}` set at its
  call site. After wave 3/4 that set is gone; the comparison is `is_self(login,
  self_login=...)`, and a *new* GraphQL/REST mismatch at a future site is impossible
  by construction (there is one normalizer).
- **PR #2 / audit PR (timeouts)** add `timeout=` and `TimeoutExpired` per site. After
  waves 1–4 the timeout is a parameter *default* on one wrapper; a future call site
  that forgets it gets the default rather than an unbounded wait. The `except`
  tuples — which today differ subtly site to site (`immunity.py:377` had `timeout=30`
  but omitted `TimeoutExpired` from its except, an exact instance of the asymmetry) —
  collapse into branching on `res.ok` / `res.timed_out`.

---

## Open questions for review

- **Telegram.** `correspondence.py` owns the Telegram surface; the helper should grow a
  `post_telegram` / timeout-enforced HTTP wrapper too, but that's wave 3 territory and
  needs the sibling PR's shape settled first. Listed here so it isn't forgotten.
- **`self_login` source.** Read once from env (`REPO_FULL_NAME`-derived?) vs a config
  constant. Whichever is chosen must be the *only* place the bot's own name is written,
  or we've reintroduced the drift we're removing.
- **`check=` semantics in `run`.** The death path (`mortality.die`) deliberately wants a
  *raising* failure (a hung delete must fail loudly and retry, not report a death that
  never happened). The wrapper's no-raise contract is wrong for that one site — it
  should keep raw `subprocess.run(..., check=True, timeout=...)`. Naming the carve-out
  here so it's a deliberate exception, not an oversight.
