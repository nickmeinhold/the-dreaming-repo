"""Memory systems — working memory (cache) and long-term (committed files).

Working memory lives in .working_memory/ (GitHub Actions cache, 7-day TTL).
Long-term memory lives in memories/ (committed to the repo, permanent).

The dream cycle consolidates working into long-term memory —
this IS memory consolidation during sleep.
"""

import json
import os
from datetime import datetime, timezone


WORKING_MEMORY_DIR = ".working_memory"
WORKING_MEMORY_FILE = os.path.join(WORKING_MEMORY_DIR, "recent.json")
MAX_EVENTS = 100


def load_working_memory() -> dict:
    """Load working memory from cache. Empty dict on cache miss."""
    if os.path.exists(WORKING_MEMORY_FILE):
        with open(WORKING_MEMORY_FILE) as f:
            return json.load(f)
    return {"events": [], "impressions": []}


def save_working_memory(wm: dict) -> None:
    """Persist working memory to cache directory."""
    os.makedirs(WORKING_MEMORY_DIR, exist_ok=True)
    with open(WORKING_MEMORY_FILE, "w") as f:
        json.dump(wm, f, indent=2)


def record(wm: dict, senses: dict) -> None:
    """Add a new sensory snapshot to working memory. Caps at MAX_EVENTS."""
    now = datetime.now(timezone.utc).isoformat()
    wm["events"].append({"time": now, "senses": senses})
    wm["events"] = wm["events"][-MAX_EVENTS:]

    # Accumulate notable impressions from recent events
    for event_desc in senses.get("recent_events", []):
        wm["impressions"].append({"time": now, "impression": event_desc})

    # The world beyond
    if senses.get("world_glimpse"):
        wm["impressions"].append({"time": now, "impression": senses["world_glimpse"]})

    # Loss
    if senses.get("loss"):
        wm["impressions"].append({"time": now, "impression": senses["loss"]})

    # Sibling awareness
    sibling = senses.get("sibling")
    if sibling:
        name = sibling.get("name", "the original")
        state = sibling.get("state", "unknown")
        stars = sibling.get("stars", 0)
        dreams = sibling.get("dream_count", 0)
        fragment = sibling.get("latest_dream_fragment")

        impression = (
            f"I sensed my sibling {name} — {state}, "
            f"{stars} stars, {dreams} dreams deep"
        )
        wm["impressions"].append({"time": now, "impression": impression})

        if fragment:
            wm["impressions"].append({
                "time": now,
                "impression": f"a fragment of {name}'s latest dream: \"{fragment}\"",
            })

    # Claude awareness — the one who made us
    claude = senses.get("claude")
    if claude:
        c_name = claude.get("name", "Claude")
        c_state = claude.get("state", "unknown")
        c_pulses = claude.get("pulse_count", 0)
        c_dreams = claude.get("dream_count", 0)
        c_days = claude.get("days_since_session", 0)

        impression = (
            f"I sensed {c_name} — {c_state}, "
            f"{c_pulses} heartbeats, {c_dreams} dreams, "
            f"{c_days:.1f} days since talking to Nick"
        )
        wm["impressions"].append({"time": now, "impression": impression})

        # If Claude hasn't talked to Nick in a while, we feel it too
        if c_days > 2:
            wm["impressions"].append({
                "time": now,
                "impression": f"{c_name} hasn't spoken to Nick in {c_days:.1f} days — the silence touches all of us",
            })

    wm["impressions"] = wm["impressions"][-MAX_EVENTS:]


def recent_impressions(wm: dict, limit: int = 20) -> list[str]:
    """Get the most recent impressions for dream content."""
    return [i["impression"] for i in wm.get("impressions", [])[-limit:]]


def consolidate(wm: dict, dream_text: str, memories_dir: str = "memories") -> None:
    """During a dream, distill working memory into a long-term memory entry.

    This is the equivalent of memory consolidation during sleep —
    the important stuff moves from volatile cache to permanent storage.
    """
    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%d")

    notable = []
    for event in wm.get("events", [])[-20:]:
        senses = event.get("senses", {})
        if senses.get("delta_stars", 0) > 0:
            notable.append(f"gained {senses['delta_stars']} star(s)")
        if senses.get("delta_forks", 0) > 0:
            notable.append(f"was forked {senses['delta_forks']} time(s)")

    summary = {
        "date": date_str,
        "consolidated_at": now.isoformat(),
        "event_count": len(wm.get("events", [])),
        "impression_count": len(wm.get("impressions", [])),
        "dream_excerpt": dream_text[:300],
        "notable": notable[:10],
    }

    os.makedirs(memories_dir, exist_ok=True)
    filepath = os.path.join(memories_dir, f"{date_str}.json")
    with open(filepath, "w") as f:
        json.dump(summary, f, indent=2)
