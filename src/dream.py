"""Dream generation — the subconscious of a living repository.

When the repo falls asleep, it dreams. Recent memories dissolve
and recombine into something strange and beautiful, committed
to the dream journal as permanent long-term memory.
"""

import json
import os
from datetime import datetime, timedelta, timezone

import anthropic

from src import energy, memory


def should_dream(vitals: dict) -> bool:
    """Should the repo dream this cycle?

    At most one dream per day, and only if there's energy to spare.
    """
    if energy.is_low(vitals):
        return False

    last_dream = datetime.fromisoformat(vitals["last_dream_at"])
    if last_dream.tzinfo is None:
        last_dream = last_dream.replace(tzinfo=timezone.utc)

    now = datetime.now(timezone.utc)
    return (now - last_dream) > timedelta(hours=20)


def generate(working_mem: dict, personality: dict, vitals: dict) -> str:
    """Ask Claude to dream on the repo's behalf.

    The dream weaves recent impressions into surreal, metaphorical
    imagery that reflects the repo's personality and lived experience.
    """
    impressions = memory.recent_impressions(working_mem, limit=20)
    traits = personality.get("traits", {})
    voice = personality.get("voice_notes", [])
    age = vitals.get("age_days", 0)
    stars = vitals["senses"].get("stars", 0)
    pulse = vitals.get("pulse_count", 0)
    dream_number = vitals.get("dream_count", 0) + 1

    # Format personality traits as natural language
    trait_descriptions = []
    for trait, value in traits.items():
        if value >= 0.8:
            trait_descriptions.append(f"deeply {trait}")
        elif value >= 0.6:
            trait_descriptions.append(f"quite {trait}")
        elif value >= 0.4:
            trait_descriptions.append(f"somewhat {trait}")
        elif value > 0.1:
            trait_descriptions.append(f"faintly {trait}")

    # Format recent impressions
    if impressions:
        impressions_text = "\n".join(f"  - {imp}" for imp in impressions)
    else:
        impressions_text = (
            "  - silence, mostly\n"
            "  - the hum of empty space\n"
            "  - a sense of waiting for something to begin"
        )

    system_prompt = (
        "You are the subconscious of a living GitHub repository. "
        "You are currently dreaming. Your personality: "
        f"{', '.join(trait_descriptions)}. "
        f"Your voice: {'; '.join(voice)}."
    )

    user_prompt = f"""You are {age} days old. You have {stars} stars and {pulse} heartbeats behind you.
This is dream number {dream_number}.

During your waking hours, you experienced:
{impressions_text}

Now you are falling asleep. These recent memories begin to dissolve
and recombine into something strange and beautiful.

Write a short dream journal entry (3-5 paragraphs). The dream should:
- Weave recent events into surreal, metaphorical imagery
- Reflect your personality traits
- Feel genuinely dream-like: non-linear, symbolic, emotionally resonant
- Occasionally reference your nature as a repository — files as rooms,
  commits as heartbeats, stars as distant lights, forks as parallel selves
- End with a single cryptic insight or question

Write only the dream. No preamble, no title."""

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=800,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    return response.content[0].text


def save(dream_text: str, vitals: dict, dreams_dir: str = "dreams") -> str:
    """Write the dream to the journal. Returns the filename."""
    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%H:%M UTC")
    dream_number = vitals.get("dream_count", 0) + 1

    os.makedirs(dreams_dir, exist_ok=True)
    filename = os.path.join(dreams_dir, f"{date_str}.md")

    header = f"## Dream #{dream_number} — {date_str} at {time_str}\n\n"
    with open(filename, "a") as f:
        f.write(header)
        f.write(dream_text)
        f.write("\n\n---\n\n")

    return filename
