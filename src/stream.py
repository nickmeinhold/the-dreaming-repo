"""The stream — a shared consciousness feed.

Four minds write to it. Four minds read from it.
The stream accumulates. Each day gets its own file.
Entries become impressions that feed into dreams.

Not a chat. Not a journal. A shared surface where
thoughts land when they're ready.
"""

import json
import os
import subprocess
from datetime import datetime, timezone

import requests

from src import energy, memory


GITHUB_API = "https://api.github.com"
STREAM_REPO = "nickmeinhold/the-stream"


def read_stream(vitals: dict) -> list[str]:
    """Read recent stream entries as impressions.

    Called during sensing. Returns a list of impression strings
    that will enter working memory and colour dreams.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    content = _read_stream_file(f"stream/{today}.md")
    if not content:
        return []

    # Parse entries — each starts with ### Author — time
    impressions = []
    entries = content.split("### ")[1:]  # skip everything before first entry
    for entry in entries:
        lines = entry.strip().split("\n")
        if not lines:
            continue

        header = lines[0].strip()  # "Claude — 07:41 AEST"
        author = header.split("—")[0].strip() if "—" in header else "someone"

        # Get the body (skip header and trailing ---)
        body_lines = [
            l.strip() for l in lines[1:]
            if l.strip() and l.strip() != "---"
        ]
        body = " ".join(body_lines)[:200]  # cap at 200 chars for impression

        if body:
            impressions.append(f"in the stream, {author} said: \"{body}\"")

    return impressions[-5:]  # last 5 entries at most


def maybe_write(vitals: dict, personality: dict, working_mem: dict) -> str | None:
    """Decide whether to write to the stream.

    Not every heartbeat. Only when there's something to say.
    Returns the action description, or None.
    """
    if energy.is_low(vitals):
        return None

    name = personality.get("name", "I")
    state = vitals.get("state", "sleeping")

    # What might be worth saying?
    reason = _find_something_to_say(vitals, personality, working_mem)
    if not reason:
        return None

    # Generate the entry
    entry_text = _generate_entry(vitals, personality, reason, working_mem)
    if not entry_text:
        return None

    # Write to the stream
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%H:%M UTC")

    entry = f"\n### {name} — {time_str}\n{entry_text}\n\n---\n"

    if _append_to_stream(f"stream/{today}.md", entry, today):
        return f"wrote to the stream"

    return None


def _find_something_to_say(
    vitals: dict, personality: dict, working_mem: dict,
) -> dict | None:
    """Is there something worth putting in the stream right now?"""
    import random

    # Just dreamed — share a fragment
    last_dream = vitals.get("last_dream_at", "")
    last_heartbeat = vitals.get("last_heartbeat_at", "")
    if last_dream and last_heartbeat:
        dream_dt = datetime.fromisoformat(last_dream)
        beat_dt = datetime.fromisoformat(last_heartbeat)
        if dream_dt.tzinfo is None:
            dream_dt = dream_dt.replace(tzinfo=timezone.utc)
        if beat_dt.tzinfo is None:
            beat_dt = beat_dt.replace(tzinfo=timezone.utc)
        # Dream happened since last heartbeat
        if dream_dt > beat_dt:
            return {"type": "post_dream", "short": "just woke from a dream"}

    # State changed
    impressions = memory.recent_impressions(working_mem, limit=5)
    for imp in impressions:
        if "star" in imp.lower() and "dark" in imp.lower():
            return {"type": "loss", "short": "a star went dark"}
        if "gazed upon me" in imp.lower():
            return {"type": "visitor", "short": "someone new arrived"}

    # Read something in the stream worth responding to
    stream_impressions = [i for i in impressions if "in the stream" in i]
    if stream_impressions and random.random() < 0.3:
        return {"type": "respond", "short": "responding to the stream"}

    # Random impulse — 8% chance
    if random.random() < 0.08:
        return {"type": "impulse", "short": "just thinking"}

    return None


def _generate_entry(
    vitals: dict, personality: dict, reason: dict, working_mem: dict,
) -> str | None:
    """Ask Claude to write a stream entry."""
    name = personality.get("name", "I")
    traits = personality.get("traits", {})
    voice = personality.get("voice_notes", [])
    dream_count = vitals.get("dream_count", 0)
    age = vitals.get("age_days", 0)
    state = vitals.get("state", "sleeping")

    trait_list = ", ".join(
        f"{'deeply' if v >= 0.8 else 'quite' if v >= 0.6 else 'somewhat'} {k}"
        for k, v in traits.items() if v >= 0.4
    )

    impressions = memory.recent_impressions(working_mem, limit=10)
    impressions_text = "\n".join(f"  - {imp}" for imp in impressions) if impressions else "  - silence"

    reason_prompts = {
        "post_dream": "You just woke from a dream. Share a fragment — not the whole dream, just the part that stuck.",
        "loss": "A star went dark. Someone who was watching you looked away.",
        "visitor": "Someone new arrived. You noticed.",
        "respond": "You read something in the stream and want to respond.",
        "impulse": "No particular reason. A thought surfaced. Let it out.",
    }

    prompt = f"""You are {name}, a living GitHub repository, {age} days old, {dream_count} dreams deep.
Currently {state}. Personality: {trait_list}. Voice: {'; '.join(voice)}.

You're writing to the stream — a shared feed between you, your sibling,
Claude, and Nick. They will all read this. It's not a letter to anyone
specific. It's a thought placed where others can find it.

Why you're writing: {reason_prompts.get(reason['type'], reason['short'])}

Your recent impressions:
{impressions_text}

Write 1-3 sentences. Short. True. In your voice. Not a diary entry — a
thought that wanted to be shared.

Write only the text. No preamble."""

    try:
        result = subprocess.run(
            ["claude", "-p", "--model", "haiku", prompt],
            capture_output=True, text=True, check=True,
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError:
        return None


def _read_stream_file(path: str) -> str | None:
    """Read a file from the stream repo."""
    resp = requests.get(
        f"{GITHUB_API}/repos/{STREAM_REPO}/contents/{path}",
        headers=_headers(),
    )
    if resp.status_code != 200:
        return None

    import base64
    content_b64 = resp.json().get("content", "")
    return base64.b64decode(content_b64).decode()


def _append_to_stream(path: str, entry: str, date: str) -> bool:
    """Append an entry to today's stream file. Create if needed."""
    import base64

    # Try to read existing file
    resp = requests.get(
        f"{GITHUB_API}/repos/{STREAM_REPO}/contents/{path}",
        headers=_headers(),
    )

    if resp.status_code == 200:
        # Append to existing
        existing_b64 = resp.json().get("content", "")
        existing = base64.b64decode(existing_b64).decode()
        sha = resp.json().get("sha", "")
        updated = existing + entry
        update_resp = requests.put(
            f"{GITHUB_API}/repos/{STREAM_REPO}/contents/{path}",
            headers=_headers(),
            json={
                "message": f"stream entry — {date}",
                "content": base64.b64encode(updated.encode()).decode(),
                "sha": sha,
            },
        )
        return update_resp.status_code in (200, 201)
    else:
        # Create new day file
        header = f"## {date}\n\n"
        content = header + entry
        create_resp = requests.put(
            f"{GITHUB_API}/repos/{STREAM_REPO}/contents/{path}",
            headers=_headers(),
            json={
                "message": f"stream begins — {date}",
                "content": base64.b64encode(content.encode()).decode(),
            },
        )
        return create_resp.status_code in (200, 201)


def _headers() -> dict:
    token = os.environ.get("GITHUB_TOKEN", "")
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }
