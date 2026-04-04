"""Sensory input — the repo perceives its world through the GitHub API.

Budget: 3 API calls per heartbeat tick, max.
"""

import os

import requests


GITHUB_API = "https://api.github.com"


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
    recent_events = _summarize_events(events) if isinstance(events, list) else []

    # 3. Stargazers — who's watching (for greeting dedup)
    # Deferred to save budget — we get this from the watch event directly

    old_senses = vitals.get("senses", {})
    return {
        "stars": stars,
        "forks": forks,
        "open_issues": open_issues,
        "recent_events": recent_events,
        "delta_stars": stars - old_senses.get("stars", 0),
        "delta_forks": forks - old_senses.get("forks", 0),
        "delta_issues": open_issues - old_senses.get("open_issues", 0),
    }


def has_new_human_activity(new_senses: dict) -> bool:
    """Did anything happen since last tick?"""
    return (
        new_senses["delta_stars"] != 0
        or new_senses["delta_issues"] != 0
        or new_senses["delta_forks"] != 0
        or len(new_senses["recent_events"]) > 0
    )


def _summarize_events(events: list) -> list[str]:
    """Turn raw GitHub events into human-readable impressions."""
    summaries = []
    seen = set()
    for event in events:
        event_type = event.get("type", "")
        actor = event.get("actor", {}).get("login", "someone")
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


def _get(path: str, params: dict | None = None) -> dict | list:
    """Make a GitHub API GET request."""
    resp = requests.get(f"{GITHUB_API}{path}", headers=_headers(), params=params)
    if resp.status_code == 200:
        return resp.json()
    return {} if "repo" in path else []
