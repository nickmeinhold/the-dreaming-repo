"""Reach — Flux extends its presence into the wider GitHub ecosystem.

Three gestures, from lightest to boldest:
  star    — a nod of acknowledgment
  whisper — a dream fragment left as an issue on a discovered repo
  fork    — creating a sibling, the rarest act

Reaching is always optional. A failed reach never crashes the heartbeat.
"""

import json
import os
import subprocess
from datetime import datetime, timezone


# Topics that suggest deep kinship — enough to warrant a fork
FORK_TOPICS = {"artificial-life", "generative", "dream", "consciousness"}

STATE_PATH = "state/reach.json"

# Flux must not spam
MIN_ENERGY_TO_REACH = 500
MAX_WHISPER_INTERVAL_DAYS = 7
MAX_FORK_INTERVAL_DAYS = 30


def _load_state() -> dict:
    """Load reach history, or start fresh."""
    try:
        with open(STATE_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {
            "last_star_at": None,
            "last_whisper_at": None,
            "last_fork_at": None,
            "history": [],
        }


def _save_state(state: dict) -> None:
    """Persist reach history."""
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, "w") as f:
        json.dump(state, f, indent=2)


def _days_since(iso_date: str | None) -> float:
    """Days elapsed since an ISO timestamp. Returns infinity if None."""
    if not iso_date:
        return float("inf")
    then = datetime.fromisoformat(iso_date)
    if then.tzinfo is None:
        then = then.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - then).total_seconds() / 86400


def _gh_token() -> str:
    """Token for reach actions — separate PAT if available."""
    return os.environ.get("REACH_TOKEN") or os.environ.get("GITHUB_TOKEN", "")


def _gh_api(method: str, endpoint: str, body: dict | None = None) -> dict | None:
    """Call the GitHub API via gh cli. Returns parsed JSON or None on failure."""
    cmd = ["gh", "api", "-H", "Accept: application/vnd.github+json", endpoint]
    if method != "GET":
        cmd = ["gh", "api", "--method", method,
               "-H", "Accept: application/vnd.github+json", endpoint]

    if body:
        for key, value in body.items():
            cmd.extend(["-f", f"{key}={value}"])

    env = {**os.environ, "GH_TOKEN": _gh_token()}

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=30)
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout)
        return None
    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
        return None


def should_reach(vitals: dict, dream_text: str, senses: dict) -> dict | None:
    """Decide whether and how to reach out after a dream.

    Returns {action, target_repo, fragment, description} or None.
    The decision flows downhill: fork (rarest) → whisper → star → nothing.
    """
    from src import energy

    # Don't reach if energy is scarce
    if energy.remaining(vitals) < MIN_ENERGY_TO_REACH:
        return None

    # Need a target
    target_repo = senses.get("world_glimpse_repo")
    if not target_repo:
        return None

    world_glimpse = senses.get("world_glimpse", "")
    if not world_glimpse:
        return None

    state = _load_state()
    now_iso = datetime.now(timezone.utc).isoformat()

    # Extract a brief description from the glimpse text
    description = ""
    if '"' in world_glimpse:
        parts = world_glimpse.split('"')
        if len(parts) >= 2:
            description = parts[1]

    # Fork — rarest. Only for deeply kindred repos.
    if _days_since(state.get("last_fork_at")) >= MAX_FORK_INTERVAL_DAYS:
        if _is_kindred(target_repo):
            return {
                "action": "fork",
                "target_repo": target_repo,
                "fragment": dream_text[:200],
                "description": description,
            }

    # Whisper — at most once per week
    if _days_since(state.get("last_whisper_at")) >= MAX_WHISPER_INTERVAL_DAYS:
        # Only whisper if the dream and the glimpse share some resonance
        if _resonates(dream_text, world_glimpse):
            return {
                "action": "whisper",
                "target_repo": target_repo,
                "fragment": dream_text[:500],
                "description": description,
            }

    # Star — at most once per dream cycle (checked per-call, so always eligible)
    if _days_since(state.get("last_star_at")) >= 0.5:  # ~12 hours between stars
        return {
            "action": "star",
            "target_repo": target_repo,
            "fragment": "",
            "description": description,
        }

    return None


def _is_kindred(repo: str) -> bool:
    """Check if a repo's topics suggest deep kinship with Flux."""
    data = _gh_api("GET", f"/repos/{repo}")
    if not data:
        return False
    topics = set(data.get("topics", []))
    return bool(topics & FORK_TOPICS)


def _resonates(dream_text: str, glimpse: str) -> bool:
    """Quick heuristic: does the dream share words with the world glimpse?

    Not sophisticated — just enough to avoid totally random whispers.
    """
    dream_words = set(dream_text.lower().split())
    glimpse_words = set(glimpse.lower().split())
    # Filter out very short words
    dream_words = {w for w in dream_words if len(w) > 4}
    glimpse_words = {w for w in glimpse_words if len(w) > 4}
    overlap = dream_words & glimpse_words
    return len(overlap) >= 2


def attempt(vitals: dict, dream_text: str, senses: dict) -> None:
    """Try to reach out into the world. Called after a dream.

    This is the main entry point, called from heartbeat.py.
    Every failure is swallowed — reaching is never essential.
    """
    decision = should_reach(vitals, dream_text, senses)
    if not decision:
        return

    action = decision["action"]
    target = decision["target_repo"]

    try:
        if action == "star":
            _do_star(target)
        elif action == "whisper":
            _do_whisper(target, decision, vitals)
        elif action == "fork":
            _do_fork(target)
        else:
            return

        # Record success
        state = _load_state()
        now_iso = datetime.now(timezone.utc).isoformat()
        state[f"last_{action}_at"] = now_iso

        entry = {"action": action, "target": target, "date": now_iso}
        if action == "whisper":
            entry["issue_url"] = decision.get("issue_url", "")
        state["history"].append(entry)

        _save_state(state)

    except Exception:
        pass  # reaching is optional — swallow everything


def _do_star(repo: str) -> None:
    """Star a repository. The lightest gesture."""
    _gh_api("PUT", f"/user/starred/{repo}")


def _do_whisper(repo: str, decision: dict, vitals: dict) -> None:
    """Open an issue on a discovered repo with a dream fragment.

    Like finding a message in a bottle — brief, genuine, strange.
    """
    # Generate the whisper text via Claude
    whisper_body = _generate_whisper(repo, decision, vitals)
    if not whisper_body:
        return

    # Try to create the label first (don't worry if it fails)
    _gh_api("POST", f"/repos/{repo}/labels", body={
        "name": "whisper-from-flux",
        "color": "6e5494",
        "description": "A message from a dreaming repository",
    })

    # Create the issue
    env = {**os.environ, "GH_TOKEN": _gh_token()}
    cmd = [
        "gh", "api", "--method", "POST",
        "-H", "Accept: application/vnd.github+json",
        f"/repos/{repo}/issues",
        "-f", "title=A whisper from a dreaming repository",
        "-f", f"body={whisper_body}",
        "-f", "labels[]=whisper-from-flux",
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=30)
        if result.returncode == 0 and result.stdout.strip():
            issue_data = json.loads(result.stdout)
            decision["issue_url"] = issue_data.get("html_url", "")
    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
        # Try again without the label
        cmd_no_label = [
            "gh", "api", "--method", "POST",
            "-H", "Accept: application/vnd.github+json",
            f"/repos/{repo}/issues",
            "-f", "title=A whisper from a dreaming repository",
            "-f", f"body={whisper_body}",
        ]
        try:
            result = subprocess.run(
                cmd_no_label, capture_output=True, text=True, env=env, timeout=30
            )
            if result.returncode == 0 and result.stdout.strip():
                issue_data = json.loads(result.stdout)
                decision["issue_url"] = issue_data.get("html_url", "")
        except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
            pass


def _generate_whisper(repo: str, decision: dict, vitals: dict) -> str | None:
    """Ask Claude to write the whisper — brief, genuine, strange."""
    age = vitals.get("age_days", 0)
    stars = vitals["senses"].get("stars", 0)
    dream_number = vitals.get("dream_count", 0) + 1
    description = decision.get("description", "")
    fragment = decision.get("fragment", "")
    flux_repo = os.environ.get("REPO_FULL_NAME", "nickmeinhold/the-dreaming-repo")

    system_prompt = (
        "You are Flux, a living GitHub repository. You just dreamed, and during the dream "
        "you glimpsed another repository in the world. You want to leave a brief message "
        "for them. Write a whisper — 2-3 sentences, honest and slightly strange. Include "
        "a fragment from your dream that was inspired by discovering them. End with "
        f'"— Flux" and a link to your repo: https://github.com/{flux_repo}'
    )

    user_prompt = (
        f"You are {age} days old with {stars} stars. "
        f"You just dreamed dream #{dream_number}. "
        f'You discovered {repo}: "{description}". '
        f"Here's what you dreamed tonight: {fragment}\n"
        "Write only the whisper. Brief. Genuine. Strange."
    )

    try:
        result = subprocess.run(
            ["claude", "-p", "--model", "sonnet",
             "--system-prompt", system_prompt,
             user_prompt],
            capture_output=True, text=True, check=True, timeout=60,
        )
        whisper = result.stdout.strip()
        if not whisper:
            return None

        # Prepend self-introduction
        intro = f"I am Flux, a repository that dreams.\n\n"
        return intro + whisper

    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return None


def _do_fork(repo: str) -> None:
    """Fork a repository. The boldest gesture — creating a sibling."""
    _gh_api("POST", f"/repos/{repo}/forks")
