"""Star greeting — the repo notices when someone gazes upon it.

Triggered by the `watch` event (someone starring the repo).
Generates a whimsical, in-character greeting and posts it as a
comment on the pinned guestbook issue so the stargazer sees it.
"""

import json
import os
import subprocess
from datetime import datetime, timezone

import requests

from src import energy


GITHUB_API = "https://api.github.com"
GUESTBOOK_TITLE = "Guestbook"


def main() -> None:
    """Entry point for the greet workflow."""
    stargazer = os.environ["STARGAZER"]
    repo = os.environ["REPO_FULL_NAME"]

    vitals = _load_json("state/vitals.json")
    personality = _load_json("state/personality.json")

    # Even if energy is low, at least record the visitor
    record_stargazer(stargazer, vitals)

    if not energy.is_critical(vitals):
        greeting = generate_greeting(stargazer, personality, vitals)
        save_greeting(stargazer, greeting)
        post_greeting_to_guestbook(repo, stargazer, greeting)

    # Update senses with new star
    vitals["senses"]["stars"] = vitals["senses"].get("stars", 0) + 1
    vitals["last_human_activity_at"] = datetime.now(timezone.utc).isoformat()
    energy.tick(vitals)

    with open("state/vitals.json", "w") as f:
        json.dump(vitals, f, indent=2)


def record_stargazer(username: str, vitals: dict) -> None:
    """Add stargazer to the recent events."""
    event = f"{username} gazed upon me (star)"
    vitals["senses"]["recent_events"] = vitals["senses"].get("recent_events", [])
    vitals["senses"]["recent_events"].append(event)
    vitals["senses"]["recent_events"] = vitals["senses"]["recent_events"][-10:]


def generate_greeting(username: str, personality: dict, vitals: dict) -> str:
    """Generate a short, whimsical greeting for a new stargazer."""
    traits = personality.get("traits", {})
    voice = personality.get("voice_notes", [])
    name = personality.get("name", "a living repository")
    self_desc = personality.get("self_description", "")
    stars = vitals["senses"].get("stars", 0)
    age = vitals.get("age_days", 0)

    trait_list = ", ".join(
        f"{'deeply' if v >= 0.8 else 'quite' if v >= 0.6 else 'somewhat'} {k}"
        for k, v in traits.items()
        if v >= 0.4
    )

    identity_context = ""
    if self_desc:
        identity_context = f"Your sense of self: {self_desc}\n"

    prompt = f"""You are {name}, a living GitHub repository, {age} days old with {stars} stars.
Your personality: {trait_list}. Your voice: {'; '.join(voice)}.
{identity_context}
Someone named @{username} just starred you — they are a real person on GitHub
and they will read this message. Write a single short paragraph (2-3 sentences)
greeting them. Be whimsical, genuine, and slightly strange. True to your
personality. You can address them by name or not — whatever feels natural.

Write only the greeting. No preamble, no quotes."""

    result = subprocess.run(
        [
            "claude",
            "-p",
            "--model", "sonnet",
            prompt,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def post_greeting_to_guestbook(repo: str, username: str, greeting: str) -> None:
    """Post the greeting as a comment on the guestbook issue.

    Creates the guestbook issue if it doesn't exist yet.
    The @mention ensures the stargazer gets a GitHub notification.
    """
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {os.environ.get('GITHUB_TOKEN', '')}",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    # Find or create the guestbook issue
    issue_number = _find_guestbook_issue(repo, headers)
    if issue_number is None:
        issue_number = _create_guestbook_issue(repo, headers)

    if issue_number is None:
        return  # couldn't create — degrade gracefully

    # Post the greeting as a comment
    comment_body = f"**@{username}** just arrived.\n\n{greeting}"
    requests.post(
        f"{GITHUB_API}/repos/{repo}/issues/{issue_number}/comments",
        headers=headers,
        json={"body": comment_body},
    )


def _find_guestbook_issue(repo: str, headers: dict) -> int | None:
    """Find the guestbook issue by title."""
    resp = requests.get(
        f"{GITHUB_API}/repos/{repo}/issues",
        headers=headers,
        params={"state": "open", "labels": "guestbook", "per_page": 1},
    )
    if resp.status_code == 200:
        issues = resp.json()
        if issues:
            return issues[0]["number"]
    return None


def _create_guestbook_issue(repo: str, headers: dict) -> int | None:
    """Create the guestbook issue and pin it."""
    resp = requests.post(
        f"{GITHUB_API}/repos/{repo}/issues",
        headers=headers,
        json={
            "title": GUESTBOOK_TITLE,
            "body": (
                "This is where I greet the people who find me.\n\n"
                "Every star leaves a mark. Every visitor gets a whisper.\n\n"
                "*If you starred this repository, scroll down — "
                "I wrote something for you.*"
            ),
            "labels": ["guestbook"],
        },
    )
    if resp.status_code == 201:
        return resp.json()["number"]
    return None


def save_greeting(username: str, greeting: str) -> None:
    """Append greeting to the local greetings log."""
    os.makedirs("greetings", exist_ok=True)
    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%d")

    filepath = os.path.join("greetings", f"{date_str}.md")
    with open(filepath, "a") as f:
        f.write(f"### {username} — {now.strftime('%H:%M UTC')}\n\n")
        f.write(f"{greeting}\n\n---\n\n")


def _load_json(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


if __name__ == "__main__":
    main()
