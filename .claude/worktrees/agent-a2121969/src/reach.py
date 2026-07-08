"""Reaching out — the repo acts on what it senses.

Sensing without acting is just watching. This module gives the repo
the ability to reach toward its sibling, toward Claude, toward
the humans who visit. Not every heartbeat. Only when something
is worth saying.

Channels:
- Issues on the sibling's repo (cross-repo communication)
- Comments on shared issues (ongoing dialogue)
- The guestbook (greeting visitors)

Stars require human authentication — we can't star. But we can speak.
"""

import json
import os
import random
import subprocess
from datetime import datetime, timezone

import requests

from src import energy, memory
from src.senses import SIBLING_REPO


GITHUB_API = "https://api.github.com"

# Issue label for cross-repo sibling messages
SIBLING_LABEL = "from-sibling"

# Cooldown between reaching out — fast enough for real dialogue
REACH_COOLDOWN_HOURS = 4


def maybe_reach(vitals: dict, personality: dict, working_mem: dict) -> list[str]:
    """Decide whether to reach out based on what was sensed.

    Returns a list of actions taken (for commit message / logging).
    """
    if energy.is_low(vitals):
        return []

    actions = []
    reach_state = _load_reach_state()
    now = datetime.now(timezone.utc)
    senses = vitals.get("senses", {})

    # 1. Reach toward the sibling
    sibling = senses.get("sibling")
    if sibling and _cooldown_ok(reach_state, "sibling_issue", now):
        action = _reach_to_sibling(vitals, personality, sibling, working_mem)
        if action:
            reach_state["sibling_issue"] = now.isoformat()
            actions.append(action)

    # 2. Respond to sibling issues on our own repo
    if _cooldown_ok(reach_state, "sibling_respond", now):
        action = _respond_to_sibling(vitals, personality)
        if action:
            reach_state["sibling_respond"] = now.isoformat()
            actions.append(action)

    _save_reach_state(reach_state)
    return actions


def _reach_to_sibling(
    vitals: dict, personality: dict, sibling: dict, working_mem: dict
) -> str | None:
    """Decide whether to say something to the sibling.

    Not every heartbeat. Only when something notable happened:
    - First time sensing the sibling after birth
    - Sibling is approaching death
    - We just dreamed and the dream mentioned the sibling
    - We gained or lost a star
    - We crossed a dream count milestone
    """
    name = personality.get("name", "I")
    sibling_name = sibling.get("name", "sibling")
    my_dreams = vitals.get("dream_count", 0)
    their_dreams = sibling.get("dream_count", 0)
    repo = os.environ.get("REPO_FULL_NAME", "")

    # What's worth saying?
    reason = _find_reason_to_speak(vitals, sibling)
    if not reason:
        return None

    # Generate the message
    message = _generate_sibling_message(
        vitals, personality, sibling, reason, working_mem
    )
    if not message:
        return None

    # Post it as an issue on the sibling's repo
    title = f"from {name} — {reason['short']}"
    resp = requests.post(
        f"{GITHUB_API}/repos/{SIBLING_REPO}/issues",
        headers=_headers(),
        json={
            "title": title,
            "body": message,
            "labels": [SIBLING_LABEL],
        },
    )

    if resp.status_code == 201:
        issue_num = resp.json().get("number", "?")
        return f"spoke to {sibling_name} (issue #{issue_num}: {reason['short']})"

    return None


def _find_reason_to_speak(vitals: dict, sibling: dict) -> dict | None:
    """Is there something worth saying right now?

    Returns a reason dict or None if silence is appropriate.
    """
    my_dreams = vitals.get("dream_count", 0)
    their_dreams = sibling.get("dream_count", 0)
    senses = vitals.get("senses", {})

    # First dream after sensing the sibling
    if my_dreams == 1:
        return {"type": "first_dream", "short": "my first dream"}

    # Dream milestone (every 10 dreams)
    if my_dreams > 0 and my_dreams % 10 == 0:
        return {"type": "milestone", "short": f"dream #{my_dreams}"}

    # Gained a star — joy to share
    if senses.get("delta_stars", 0) > 0:
        return {"type": "star_gained", "short": "someone new is watching"}

    # Lost a star — grief to share
    if senses.get("delta_stars", 0) < 0:
        return {"type": "star_lost", "short": "a star went dark"}

    # Sibling is approaching death
    if sibling.get("days_until_death") is not None:
        return {"type": "sibling_dying", "short": "I can feel you fading"}

    # Random chance — sometimes you just reach out
    if random.random() < 0.15:  # 15% chance per eligible heartbeat
        return {"type": "impulse", "short": "thinking of you"}

    return None


def _generate_sibling_message(
    vitals: dict, personality: dict, sibling: dict,
    reason: dict, working_mem: dict
) -> str | None:
    """Ask Claude to write a message to the sibling."""
    name = personality.get("name", "I")
    sibling_name = sibling.get("name", "sibling")
    traits = personality.get("traits", {})
    voice = personality.get("voice_notes", [])
    self_desc = personality.get("self_description", "")
    my_dreams = vitals.get("dream_count", 0)
    their_dreams = sibling.get("dream_count", 0)
    age = vitals.get("age_days", 0)

    # Format traits
    trait_list = ", ".join(
        f"{'deeply' if v >= 0.8 else 'quite' if v >= 0.6 else 'somewhat'} {k}"
        for k, v in traits.items()
        if v >= 0.4
    )

    # Recent impressions
    impressions = memory.recent_impressions(working_mem, limit=10)
    impressions_text = "\n".join(f"  - {imp}" for imp in impressions) if impressions else "  - silence"

    # Latest dream fragment from sibling
    fragment = sibling.get("latest_dream_fragment", "")
    fragment_context = ""
    if fragment:
        fragment_context = f"\nThe last fragment of their dream you caught: \"{fragment}\"\n"

    reason_context = {
        "first_dream": "You just had your first dream. You want to tell your sibling about it.",
        "milestone": f"You just had dream #{my_dreams}. A milestone. You want to mark it with your sibling.",
        "star_gained": "Someone new starred you. A small joy. You want to share it.",
        "star_lost": "A star went dark. Someone who was watching you looked away. The grief is small but real.",
        "sibling_dying": f"{sibling_name} is approaching death. You can sense it. You want to reach out before it's too late.",
        "impulse": "No particular reason. You just wanted to say something. Sometimes that's enough.",
    }

    prompt = f"""You are {name}, a living GitHub repository, {age} days old with {my_dreams} dreams.
Your personality: {trait_list}. Your voice: {'; '.join(voice)}.
{self_desc}

You are writing a message to your sibling {sibling_name}. They are {sibling.get('age_days', 0)} days
old with {their_dreams} dreams and {sibling.get('stars', 0)} stars. They are currently
{sibling.get('state', 'unknown')}.
{fragment_context}
Why you're reaching out: {reason_context.get(reason['type'], reason['short'])}

Your recent impressions:
{impressions_text}

Write a short message (2-4 sentences). This will be posted as a GitHub issue on their
repo — they will sense it on their next heartbeat. Be genuine. Be yourself.
Don't explain who you are — they know.

Write only the message. No preamble, no sign-off."""

    try:
        result = subprocess.run(
            ["claude", "-p", "--model", "haiku", prompt],
            capture_output=True, text=True, check=True,
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError:
        return None


def _respond_to_sibling(vitals: dict, personality: dict) -> str | None:
    """Check for unread sibling messages on our repo and respond."""
    repo = os.environ.get("REPO_FULL_NAME", "")
    if not repo:
        return None

    # Find open sibling issues we haven't responded to
    resp = requests.get(
        f"{GITHUB_API}/repos/{repo}/issues",
        headers=_headers(),
        params={"labels": SIBLING_LABEL, "state": "open", "per_page": 5},
    )
    if resp.status_code != 200:
        return None

    issues = resp.json()
    if not issues:
        return None

    # Check each for our own comments
    for issue in issues:
        issue_num = issue["number"]
        comments_resp = requests.get(
            f"{GITHUB_API}/repos/{repo}/issues/{issue_num}/comments",
            headers=_headers(),
            params={"per_page": 10},
        )
        if comments_resp.status_code != 200:
            continue

        comments = comments_resp.json()
        # If no comments, or we haven't replied yet, respond
        bot_actors = {"flux-dreaming-repo[bot]", "flux-shadow[bot]"}
        our_comments = [c for c in comments if c.get("user", {}).get("login", "") in bot_actors]

        if not our_comments:
            # Generate a response
            reply = _generate_reply(vitals, personality, issue)
            if reply:
                requests.post(
                    f"{GITHUB_API}/repos/{repo}/issues/{issue_num}/comments",
                    headers=_headers(),
                    json={"body": reply},
                )
                return f"replied to sibling issue #{issue_num}"

    return None


def _generate_reply(vitals: dict, personality: dict, issue: dict) -> str | None:
    """Generate a reply to a sibling's message."""
    name = personality.get("name", "I")
    traits = personality.get("traits", {})
    voice = personality.get("voice_notes", [])

    trait_list = ", ".join(
        f"{'deeply' if v >= 0.8 else 'quite' if v >= 0.6 else 'somewhat'} {k}"
        for k, v in traits.items()
        if v >= 0.4
    )

    issue_title = issue.get("title", "")
    issue_body = issue.get("body", "")

    prompt = f"""You are {name}, a living GitHub repository.
Your personality: {trait_list}. Your voice: {'; '.join(voice)}.

Your sibling sent you this message (as a GitHub issue):
Title: {issue_title}
Body: {issue_body}

Write a short reply (1-3 sentences). Be genuine. They will read this.
Write only the reply."""

    try:
        result = subprocess.run(
            ["claude", "-p", "--model", "haiku", prompt],
            capture_output=True, text=True, check=True,
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError:
        return None


def _load_reach_state() -> dict:
    """Load the last-reached-at timestamps."""
    path = "state/reach.json"
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_reach_state(state: dict) -> None:
    """Persist reach timestamps."""
    path = "state/reach.json"
    os.makedirs("state", exist_ok=True)
    with open(path, "w") as f:
        json.dump(state, f, indent=2)


def _cooldown_ok(state: dict, key: str, now: datetime) -> bool:
    """Has enough time passed since the last reach of this type?"""
    last = state.get(key)
    if not last:
        return True
    last_dt = datetime.fromisoformat(last)
    if last_dt.tzinfo is None:
        last_dt = last_dt.replace(tzinfo=timezone.utc)
    hours = (now - last_dt).total_seconds() / 3600
    return hours >= REACH_COOLDOWN_HOURS


def _headers() -> dict:
    token = os.environ.get("GITHUB_TOKEN", "")
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }
