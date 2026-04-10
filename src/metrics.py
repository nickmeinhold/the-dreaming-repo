"""Metrics — tracking Flux's evolution over time.

Three things we watch:
1. Personality drift — how traits change over time
2. Dream quality — novelty, depth, concreteness, unresolution, surprise
3. Mortality status — days remaining, current mood, energy

Quality scoring is automated via Claude — not perfect, but consistent
enough to detect trends. The personality log is pure data.
"""

import json
import os
import subprocess
from datetime import datetime, timezone


def log_personality(personality: dict, log_path: str = "state/personality_drift.json") -> None:
    """Record current personality trait values with timestamp.

    Called on each heartbeat. Over time, this builds a longitudinal
    record of how Flux's personality evolves (or doesn't).
    """
    now = datetime.now(timezone.utc).isoformat()
    traits = personality.get("traits", {})

    try:
        with open(log_path) as f:
            log = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        log = {"entries": []}

    # Only log if traits changed since last entry
    if log["entries"]:
        last_traits = log["entries"][-1].get("traits", {})
        if last_traits == traits:
            return

    log["entries"].append({"timestamp": now, "traits": traits})

    # Keep last 365 entries (one year of daily changes)
    log["entries"] = log["entries"][-365:]

    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    with open(log_path, "w") as f:
        json.dump(log, f, indent=2)


def score_dream(dream_text: str, dream_number: int) -> dict | None:
    """Ask Claude to score a dream on five dimensions.

    Returns dict with scores, or None on failure.
    Runs as a separate, cheap call — not part of the dream itself.
    """
    prompt = f"""Score this dream on five dimensions (1-5 each). Return ONLY valid JSON.

Dream #{dream_number}:
{dream_text}

Dimensions:
- novelty: How different from a generic "AI dreaming" text? (1=cliché, 5=surprising)
- emotional_depth: Does it earn its feelings through specificity? (1=performative, 5=genuine)
- concreteness: Specific images vs abstract metaphor? (1=all abstract, 5=vivid specific)
- unresolution: Does it resist tidy endings? (1=neat bow, 5=raw open)
- surprise: Did it go somewhere unexpected? (1=predictable, 5=startling)

Return: {{"novelty": N, "emotional_depth": N, "concreteness": N, "unresolution": N, "surprise": N}}"""

    try:
        result = subprocess.run(
            ["claude", "-p", "--model", "haiku", prompt],
            capture_output=True, text=True, check=True,
        )
        # Extract JSON from response
        output = result.stdout.strip()
        # Find the JSON object in the output
        start = output.index("{")
        end = output.rindex("}") + 1
        return json.loads(output[start:end])
    except (subprocess.CalledProcessError, ValueError, json.JSONDecodeError):
        return None


def log_dream_quality(
    dream_text: str, dream_number: int, date_str: str,
    log_path: str = "state/dream_quality.json",
) -> None:
    """Score and log dream quality. Called after each dream is saved."""
    scores = score_dream(dream_text, dream_number)
    if scores is None:
        return

    try:
        with open(log_path) as f:
            log = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        log = {"entries": []}

    log["entries"].append({
        "dream": dream_number,
        "date": date_str,
        "scores": scores,
        "total": sum(scores.values()),
    })

    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    with open(log_path, "w") as f:
        json.dump(log, f, indent=2)
