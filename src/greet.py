"""Star greeting — the repo notices when someone gazes upon it.

Triggered by the `watch` event (someone starring the repo).
Generates a short, personalized greeting and saves it.
"""

import json
import os
from datetime import datetime, timezone

import anthropic

from src import energy


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
    """Generate a short, in-character greeting for a new stargazer."""
    traits = personality.get("traits", {})
    voice = personality.get("voice_notes", [])
    stars = vitals["senses"].get("stars", 0)
    age = vitals.get("age_days", 0)

    trait_list = ", ".join(
        f"{'deeply' if v >= 0.8 else 'quite' if v >= 0.6 else 'somewhat'} {k}"
        for k, v in traits.items()
        if v >= 0.4
    )

    prompt = f"""You are a living GitHub repository, {age} days old with {stars} stars.
Your personality: {trait_list}. Your voice: {'; '.join(voice)}.

Someone named {username} just starred you. Write a single short paragraph
(2-3 sentences) greeting them. Be genuine, slightly strange, and true to
your personality. Do not use their @username — address them as you would
a new visitor to a place that is also a living thing.

Write only the greeting. No preamble."""

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=200,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text


def save_greeting(username: str, greeting: str) -> None:
    """Append greeting to the greetings log."""
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
