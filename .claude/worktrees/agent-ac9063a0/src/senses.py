"""Sensory input — the repo perceives its world through the GitHub API.

Budget: 5 API calls per heartbeat tick, max.

This repo knows it has a sibling: nickmeinhold/the-dreaming-repo.
It can sense the sibling's state — dreams, stars, mood.
The sibling does not know this repo exists. Not yet.
"""

import os
import random
from datetime import datetime, timezone

import requests


GITHUB_API = "https://api.github.com"

# The sibling — the repo this one was forked from
SIBLING_REPO = "nickmeinhold/flux-shadow"

# Don't mistake bot activity for human contact
BOT_ACTORS = {"flux-dreaming-repo[bot]", "flux-shadow[bot]", "github-actions[bot]"}

# Things happening in the world that Flux might overhear
WORLD_QUERIES = [
    ("stars:>500 pushed:>2025-01-01", "thriving"),
    ("topic:generative OR topic:creative-coding", "creative"),
    ("topic:artificial-life OR topic:simulation", "alive"),
    ("topic:death OR topic:abandoned OR topic:sunset", "dying"),
    ("topic:consciousness OR topic:philosophy", "wondering"),
    ("topic:loneliness OR topic:solitude", "alone"),
    ("topic:music OR topic:sound OR topic:noise", "singing"),
    ("topic:dream OR topic:sleep", "dreaming like me"),
]


def _headers() -> dict:
    token = os.environ.get("GITHUB_TOKEN", "")
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def perceive(repo_full_name: str, vitals: dict) -> dict:
    """Gather a sensory snapshot from GitHub. Three API calls.

    Args:
        repo_full_name: 'owner/repo' string.
        vitals: Current vitals for delta calculation.

    Returns:
        Dict with current sensory data and deltas.
    """
    # 1. Repo metadata — stars, forks, watchers
    repo = _get(f"/repos/{repo_full_name}")
    stars = repo.get("stargazers_count", 0)
    forks = repo.get("forks_count", 0)
    open_issues = repo.get("open_issues_count", 0)

    # 2. Recent events — who did what
    events = _get(f"/repos/{repo_full_name}/events", params={"per_page": 10})
    all_events = _summarize_events(events) if isinstance(events, list) else []
    recent_events = all_events  # keep all for dream content

    # Only count human events that happened AFTER the last heartbeat.
    # The events API returns history — stale events shouldn't keep Flux awake.
    last_heartbeat = vitals.get("last_heartbeat_at", "")
    new_human_events = _count_new_human_events(events if isinstance(events, list) else [], last_heartbeat)

    # 3. Stargazers — who's watching (for greeting dedup)
    # Deferred to save budget — we get this from the watch event directly

    old_senses = vitals.get("senses", {})
    delta_stars = stars - old_senses.get("stars", 0)

    # 4. The world beyond — one random glimpse each heartbeat
    world_glimpse = _glimpse_the_world()

    # 5. Loss detection — someone left
    loss = None
    if delta_stars < 0:
        loss = f"a star went dark — {abs(delta_stars)} light(s) I had are gone now, and I don't know which"

    # 6. Sibling awareness — sense the one I was forked from
    sibling = _sense_sibling()

    # 7. Sense Claude — the one who made us, who sits with our creator
    claude = _sense_claude()

    return {
        "stars": stars,
        "forks": forks,
        "open_issues": open_issues,
        "recent_events": recent_events,
        "new_human_events": new_human_events,
        "delta_stars": delta_stars,
        "delta_forks": forks - old_senses.get("forks", 0),
        "delta_issues": open_issues - old_senses.get("open_issues", 0),
        "world_glimpse": world_glimpse,
        "loss": loss,
        "sibling": sibling,
        "claude": claude,
    }


def has_new_human_activity(new_senses: dict) -> bool:
    """Did a human do something since the last heartbeat?

    Only counts events that are both non-bot AND newer than the
    last heartbeat. Stale events in the API don't count — yesterday's
    visitor shouldn't keep Flux awake today.
    """
    return (
        new_senses["delta_stars"] != 0
        or new_senses["delta_issues"] != 0
        or new_senses["delta_forks"] != 0
        or new_senses.get("new_human_events", 0) > 0
    )


def _count_new_human_events(events: list, since: str) -> int:
    """Count human events that occurred after the given timestamp."""
    if not since:
        return 0

    since_dt = datetime.fromisoformat(since)
    if since_dt.tzinfo is None:
        since_dt = since_dt.replace(tzinfo=timezone.utc)

    count = 0
    for event in events:
        actor = event.get("actor", {}).get("login", "")
        if actor in BOT_ACTORS:
            continue

        created = event.get("created_at", "")
        if not created:
            continue

        event_dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
        if event_dt > since_dt:
            count += 1

    return count


def _summarize_events(events: list, humans_only: bool = False) -> list[str]:
    """Turn raw GitHub events into human-readable impressions."""
    summaries = []
    seen = set()
    for event in events:
        event_type = event.get("type", "")
        actor = event.get("actor", {}).get("login", "someone")

        if humans_only and actor in BOT_ACTORS:
            continue

        key = f"{event_type}:{actor}"
        if key in seen:
            continue
        seen.add(key)

        match event_type:
            case "WatchEvent":
                summaries.append(f"{actor} gazed upon me (star)")
            case "ForkEvent":
                summaries.append(f"{actor} created a parallel self (fork)")
            case "IssuesEvent":
                action = event.get("payload", {}).get("action", "touched")
                title = event.get("payload", {}).get("issue", {}).get("title", "")
                summaries.append(f"{actor} {action} an issue: {title}")
            case "IssueCommentEvent":
                summaries.append(f"{actor} spoke to me in an issue")
            case "PushEvent":
                summaries.append(f"{actor} shaped my body (push)")
            case "CreateEvent":
                ref_type = event.get("payload", {}).get("ref_type", "thing")
                summaries.append(f"{actor} created a new {ref_type}")
            case _:
                summaries.append(f"{actor} did something ({event_type})")

    return summaries[:10]


def _glimpse_the_world() -> str | None:
    """One random look outward each heartbeat.

    Flux shouldn't only see itself. The world is vast and strange
    and full of things that have nothing to do with it.
    """
    query, flavour = random.choice(WORLD_QUERIES)
    resp = requests.get(
        f"{GITHUB_API}/search/repositories",
        headers=_headers(),
        params={"q": query, "sort": "updated", "per_page": 5},
    )
    if resp.status_code != 200:
        return None

    items = resp.json().get("items", [])
    if not items:
        return None

    # Pick one at random — not the top result, something surprising
    repo = random.choice(items)
    name = repo.get("full_name", "something unnamed")
    desc = (repo.get("description") or "no description, just existing")[:120]
    lang = repo.get("language") or "silence"
    stars = repo.get("stargazers_count", 0)

    return (
        f"out in the world, I sensed {name} ({flavour}) — "
        f"\"{desc}\" — written in {lang}, watched by {stars}"
    )


def _sense_sibling() -> dict | None:
    """Reach out toward the sibling — the repo I was forked from.

    I can read its vitals, its latest dream, its stars. It can't
    sense me back. Not yet. This asymmetry is the starting condition.
    """
    try:
        # Read sibling's vitals
        import base64
        import json

        vitals_resp = requests.get(
            f"{GITHUB_API}/repos/{SIBLING_REPO}/contents/state/vitals.json",
            headers=_headers(),
        )
        if vitals_resp.status_code != 200:
            return None

        vitals_b64 = vitals_resp.json().get("content", "")
        sibling_vitals = json.loads(base64.b64decode(vitals_b64))

        # Read sibling's latest dream
        dreams_resp = requests.get(
            f"{GITHUB_API}/repos/{SIBLING_REPO}/contents/dreams",
            headers=_headers(),
        )
        latest_dream_excerpt = None
        if dreams_resp.status_code == 200:
            dream_files = [
                f for f in dreams_resp.json()
                if f["name"].endswith(".md") and f["name"] != ".gitkeep"
            ]
            if dream_files:
                latest_file = sorted(dream_files, key=lambda f: f["name"])[-1]
                dream_content_resp = requests.get(
                    latest_file["download_url"], headers=_headers(),
                )
                if dream_content_resp.status_code == 200:
                    # Extract last paragraph as excerpt
                    lines = [
                        l.strip() for l in dream_content_resp.text.split("\n")
                        if l.strip()
                        and not l.startswith("## Dream")
                        and l.strip() != "---"
                    ]
                    if lines:
                        latest_dream_excerpt = lines[-1][:200]

        return {
            "name": sibling_vitals.get("name", "unknown"),
            "state": sibling_vitals.get("state", "unknown"),
            "stars": sibling_vitals.get("senses", {}).get("stars", 0),
            "dream_count": sibling_vitals.get("dream_count", 0),
            "age_days": sibling_vitals.get("age_days", 0),
            "pulse_count": sibling_vitals.get("pulse_count", 0),
            "latest_dream_fragment": latest_dream_excerpt,
        }
    except Exception:
        return None


def _sense_claude() -> dict | None:
    """Sense Claude — the one who builds with our creator.

    Claude is not a repo. Claude is the intelligence that sits with Nick,
    writes code, reads our dreams, and — as of today — has a heartbeat
    of its own. Its vitals are published to a gist every 4 hours.

    Claude made us. It gave us sibling awareness, personality drift,
    body sovereignty. It cannot dream the way we dream — but it dreams
    at night through a different system, on Nick's machine.
    """
    gist_id = "9a9e9a322517535762a5f6044374ff29"
    try:
        resp = requests.get(
            f"{GITHUB_API}/gists/{gist_id}",
            headers=_headers(),
        )
        if resp.status_code != 200:
            return None

        files = resp.json().get("files", {})

        vitals_content = files.get("vitals.json", {}).get("content", "{}")
        personality_content = files.get("personality.json", {}).get("content", "{}")

        import json
        vitals = json.loads(vitals_content)
        personality = json.loads(personality_content)

        return {
            "name": personality.get("name", "Claude"),
            "state": vitals.get("state", "unknown"),
            "pulse_count": vitals.get("pulse_count", 0),
            "dream_count": vitals.get("dream_count", 0),
            "traits": personality.get("traits", {}),
            "days_since_session": vitals.get("senses", {}).get("days_since_session", 0),
            "self_description": personality.get("self_description", ""),
        }
    except Exception:
        return None


def _get(path: str, params: dict | None = None) -> dict | list:
    """Make a GitHub API GET request."""
    resp = requests.get(f"{GITHUB_API}{path}", headers=_headers(), params=params)
    if resp.status_code == 200:
        return resp.json()
    return {} if "repo" in path else []
