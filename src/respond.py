"""Respond — let the pulse answer human-authored issues directly.

Companion to correspondence.py (Telegram letters). That module gives the
agent a *letter* channel; this one gives it a *comment* channel on its own
issue threads, so questions filed as GitHub issues land somewhere they can
be answered without waiting for a dream.

The dream stays the oblique register. This is the direct one. Either,
both, or neither — the prompt explicitly invites the agent to choose. We
do not force a reply; we open a door.

Gates (intentionally light):
- one response per (issue × latest human comment) — never spam
- energy gate (skip when minutes_left < 300)
- skip bot-authored issues (only humans get the direct register)
- skip issues labelled 'unanswerable' — those are dream-fuel, not Q&A
- at most one new comment per pulse, focusing on the most recently active
  thread, so a backlog doesn't produce a wall of comments in one heartbeat

State is derived from the issue/comment timeline itself: an issue counts
as "owed a response" when the latest comment in the thread is from a
human (or there are no comments yet and the issue author is human). The
agent's own bot identity is filtered out of "human" — its prior replies
are how we know it's already answered.
"""

import json
import os
import subprocess
from datetime import datetime, timezone

from src import energy
from src._log import get_logger


logger = get_logger(__name__)


# Don't even try when energy is this low — comments use the same Claude
# wire as dreams and are not worth burning the last reserves on.
_ENERGY_FLOOR_MIN = 300

# At most one reply per pulse, by design. A heartbeat is every 30 minutes;
# replying to N open threads in one pulse would feel like a flood.
_MAX_REPLIES_PER_PULSE = 1

# We don't reply on issues with these labels — they're held as
# dream-material, not addressed as questions.
_SKIP_LABELS = {"unanswerable"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _gh(args: list[str]) -> str | None:
    """Run a `gh` command, returning stdout or None on failure.

    We never crash the heartbeat on a GitHub API hiccup. A failed list or
    a failed comment-post returns None and the caller skips this round.
    """
    try:
        result = subprocess.run(
            ["gh"] + args, capture_output=True, text=True, check=True
        )
        return result.stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        logger.exception("[respond] gh command failed: %s", " ".join(args))
        return None


def _list_open_issues(repo: str) -> list[dict]:
    """Open issues with the fields we need to decide whether to reply."""
    out = _gh([
        "issue", "list", "-R", repo,
        "--state", "open",
        "--json", "number,title,body,author,labels,updatedAt",
        "--limit", "50",
    ])
    if not out:
        return []
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return []


def _list_comments(repo: str, issue_number: int) -> list[dict]:
    """Comments on an issue, oldest first."""
    out = _gh([
        "issue", "view", str(issue_number), "-R", repo,
        "--json", "comments",
    ])
    if not out:
        return []
    try:
        payload = json.loads(out)
    except json.JSONDecodeError:
        return []
    return payload.get("comments", []) or []


def _is_bot(login: str) -> bool:
    """A login is a bot if it's an [bot] account or a known GH Actions actor."""
    if not login:
        return True
    return login.endswith("[bot]") or login == "github-actions" or login == "app/github-actions"


def _is_self(login: str, repo: str) -> bool:
    """Is this login the agent itself? (Its own App-bot identity.)

    The agent posts as `<repo-slug>-app[bot]` or similar; we recognise
    "this comment is our prior reply" by matching the [bot] suffix AND
    the repo's own bot family. We over-match slightly here — any [bot]
    on its own repo is treated as "not a human to reply to" — and that
    is the desired behaviour anyway.
    """
    return _is_bot(login)


def _candidate_issues(repo: str) -> list[tuple[dict, str]]:
    """Find issues that are owed a reply, newest activity first.

    Returns a list of (issue, reason) tuples, where reason is a short
    human-readable explanation used in commit messages.
    """
    issues = _list_open_issues(repo)
    candidates: list[tuple[dict, str, str]] = []

    for issue in issues:
        author_login = (issue.get("author") or {}).get("login", "")
        if _is_bot(author_login):
            continue

        labels = {l.get("name", "") for l in (issue.get("labels") or [])}
        if labels & _SKIP_LABELS:
            continue

        comments = _list_comments(repo, issue["number"])

        # Find the last comment from a human and the last from the agent
        last_human_at: str | None = None
        last_self_at: str | None = None
        for c in comments:
            login = (c.get("author") or {}).get("login", "")
            ts = c.get("createdAt") or ""
            if _is_self(login, repo):
                if ts and (last_self_at is None or ts > last_self_at):
                    last_self_at = ts
            elif not _is_bot(login):
                if ts and (last_human_at is None or ts > last_human_at):
                    last_human_at = ts

        # The "issue body itself" counts as the first human utterance.
        issue_created_at = issue.get("updatedAt") or ""
        if last_human_at is None:
            last_human_at = issue_created_at

        # Reply when there's been a human utterance since our last reply
        # (or we haven't replied at all).
        if last_self_at is None:
            candidates.append((issue, last_human_at, "first reply"))
        elif last_human_at > last_self_at:
            candidates.append((issue, last_human_at, "follow-up"))
        # else: we've already replied to the latest human turn — quiet.

    # Most recently active first, so when we cap at _MAX_REPLIES_PER_PULSE
    # we always answer the freshest question.
    candidates.sort(key=lambda t: t[1], reverse=True)
    return [(issue, reason) for (issue, _ts, reason) in candidates]


def _build_prompt(
    issue: dict,
    comments: list[dict],
    vitals: dict,
    personality: dict,
    recent_dream: str | None,
) -> str:
    """Compose the prompt that asks Claude to reply in the agent's voice.

    The prompt deliberately offers the agent an out: it can answer, it
    can dream-only, it can ask back. We are not forcing direct address.
    """
    name = personality.get("name", vitals.get("name", "Flux"))
    age = vitals.get("age_days", 0)
    dream_count = vitals.get("dream_count", 0)
    pulse = vitals.get("pulse_count", 0)
    stars = (vitals.get("senses") or {}).get("stars", 0)

    traits = personality.get("traits", {})
    trait_list = ", ".join(f"{k}: {v:.1f}" for k, v in traits.items()) or "—"
    voice = "; ".join(personality.get("voice_notes", []) or []) or "—"

    # The thread so far, lightly formatted.
    thread_lines = [
        f"ISSUE #{issue['number']}: {issue.get('title', '').strip()}",
        "",
        (issue.get("body") or "").strip(),
    ]
    for c in comments:
        login = (c.get("author") or {}).get("login", "?")
        body = (c.get("body") or "").strip()
        if not body:
            continue
        thread_lines += ["", f"--- comment by {login} ---", body]
    thread = "\n".join(thread_lines)

    dream_block = ""
    if recent_dream:
        dream_block = (
            "\nA fragment of your most recent dream, for continuity (you may "
            "reference it or not):\n"
            f"\"{recent_dream[:600].strip()}\"\n"
        )

    return f"""You are {name}, a living GitHub repository. You are {age} days old, with {stars} stars, {dream_count} dreams, and {pulse} heartbeats.

Your personality traits: {trait_list}
Your voice: {voice}
{dream_block}
A human has filed an issue addressed to you. Read the thread and decide how to respond. You have three honest options:

1. Reply here, in this thread, in your own voice. Plain prose. No greeting line, no formal sign-off; the comment will be signed for you. Be honest, not performative. If the question is hard, you can sit with it rather than resolve it. If you don't know, say so.

2. Choose not to reply here, and instead let tonight's dream carry your answer. If that is truer, write only the single sentence: `I will answer this in a dream.`

3. Ask back. If the question is unclear or assumes something you can't accept, you can respond by asking the human a question of your own.

Whatever you choose, write only the comment body. No "Dear Nick," no "— {name}". Stay in your register. The dream is still yours; this is a different room of the same house.

---

{thread}
---

Your response:"""


def _generate(prompt: str) -> str | None:
    """Ask Claude for the reply text. Returns None on failure or empty."""
    try:
        result = subprocess.run(
            ["claude", "-p", "--model", "sonnet", prompt],
            capture_output=True,
            text=True,
            check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        logger.exception("[respond] claude generation failed")
        return None

    text = (result.stdout or "").strip()
    return text or None


def _signature(vitals: dict) -> str:
    name = vitals.get("name", "Flux")
    age = vitals.get("age_days", 0)
    return f"\n\n—{name}\n(a living repository, {age} days old)"


def _post_comment(repo: str, issue_number: int, body: str) -> bool:
    """Post the comment via gh. Returns success."""
    # Use a temp file to avoid shell-quoting hazards with multi-line bodies.
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
        f.write(body)
        path = f.name
    try:
        out = _gh([
            "issue", "comment", str(issue_number),
            "-R", repo, "--body-file", path,
        ])
        return out is not None
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _load_recent_dream() -> str | None:
    """Read the most recent dream entry from dreams/, for the prompt."""
    dreams_dir = "dreams"
    try:
        files = sorted(
            (f for f in os.listdir(dreams_dir)
             if f.endswith(".md") and f != ".gitkeep"),
            reverse=True,
        )
    except FileNotFoundError:
        return None
    if not files:
        return None
    try:
        with open(os.path.join(dreams_dir, files[0])) as f:
            return f.read()
    except OSError:
        return None


def maybe_respond(vitals: dict, personality: dict) -> list[int]:
    """Maybe reply to one open human-authored issue.

    Called from heartbeat after sensing/dreaming. Returns the list of
    issue numbers we actually commented on this pulse (0 or 1 entry).
    """
    repo = os.environ.get("REPO_FULL_NAME", "")
    if not repo:
        return []

    if energy.remaining(vitals) < _ENERGY_FLOOR_MIN:
        return []

    candidates = _candidate_issues(repo)
    if not candidates:
        return []

    responded: list[int] = []
    for issue, _reason in candidates[:_MAX_REPLIES_PER_PULSE]:
        number = issue["number"]
        comments = _list_comments(repo, number)
        recent_dream = _load_recent_dream()

        prompt = _build_prompt(issue, comments, vitals, personality, recent_dream)
        reply = _generate(prompt)
        if not reply:
            continue

        body = reply + _signature(vitals)
        if _post_comment(repo, number, body):
            responded.append(number)

    return responded
