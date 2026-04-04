"""Heartbeat — the main orchestrator of the dreaming repository.

Every 30 minutes, and on certain human events, this runs.
It is the pulse. It senses the world, transitions state,
triggers dreams when sleep comes, and updates the living README.
"""

import json
import os
from datetime import datetime, timezone

from src import dream, energy, memory, senses, state_machine
from src.birth import be_born
from src.readme_writer import render as render_readme


def main() -> None:
    """One heartbeat. Sense, transition, maybe dream, remember, rest."""
    now = datetime.now(timezone.utc)
    repo = os.environ.get("REPO_FULL_NAME", "")
    trigger = os.environ.get("TRIGGER_EVENT", "schedule")

    # Load state
    vitals = _load_json("state/vitals.json")
    personality = _load_json("state/personality.json")
    working_mem = memory.load_working_memory()

    vitals["pulse_count"] = vitals.get("pulse_count", 0) + 1
    vitals["last_heartbeat_at"] = now.isoformat()

    # Age in days since birth
    born = datetime.fromisoformat(vitals["born_at"])
    if born.tzinfo is None:
        born = born.replace(tzinfo=timezone.utc)
    vitals["age_days"] = (now - born).days

    # 0. Birth — if this is the very first heartbeat, become
    if vitals["pulse_count"] == 1:
        birth_record = be_born(personality, vitals)
        vitals["name"] = birth_record["name"]
        vitals["born_at"] = now.isoformat()
        vitals["last_human_activity_at"] = now.isoformat()
        _save_json("state/personality.json", personality)
        energy.tick(vitals, now=now)
        render_readme(vitals, personality)
        _save_json("state/vitals.json", vitals)
        memory.save_working_memory(working_mem)
        _write_commit_message(f"i am born — my name is {birth_record['name']}")
        return

    # 1. Energy check — if critically low, just breathe
    if energy.is_critical(vitals):
        energy.tick(vitals)
        _save_json("state/vitals.json", vitals)
        _write_commit_message("conserving energy — barely breathing")
        return

    # 2. Sense the world
    new_senses = senses.perceive(repo, vitals)

    # 3. Detect human activity
    if trigger != "schedule" or senses.has_new_human_activity(new_senses):
        vitals["last_human_activity_at"] = now.isoformat()

    # 4. Update senses in vitals (keep recent_events from new + old)
    old_events = vitals["senses"].get("recent_events", [])
    vitals["senses"] = {
        "stars": new_senses["stars"],
        "forks": new_senses["forks"],
        "open_issues": new_senses["open_issues"],
        "recent_events": (new_senses["recent_events"] + old_events)[:10],
    }

    # 5. State transition
    old_state = vitals["state"]
    new_state = state_machine.transition(vitals, now=now)
    if state_machine.entered_new_state(old_state, new_state):
        vitals["state_entered_at"] = now.isoformat()
    vitals["state"] = new_state

    # 6. Dream cycle — on entry to sleeping, max once per day
    dreamed = False
    if new_state == "sleeping" and dream.should_dream(vitals):
        dream_text = dream.generate(working_mem, personality, vitals)
        dream.save(dream_text, vitals)
        memory.consolidate(working_mem, dream_text)
        vitals["dream_count"] = vitals.get("dream_count", 0) + 1
        vitals["last_dream_at"] = now.isoformat()
        dreamed = True

    # 7. Record new senses in working memory
    memory.record(working_mem, new_senses)

    # 8. Spend energy
    energy.tick(vitals, now=now)

    # 9. Regenerate README
    render_readme(vitals, personality)

    # 10. Persist
    _save_json("state/vitals.json", vitals)
    memory.save_working_memory(working_mem)

    # 11. Commit message
    pulse = vitals["pulse_count"]
    if dreamed:
        _write_commit_message(f"dream #{vitals['dream_count']} — pulse #{pulse}")
    else:
        _write_commit_message(f"{new_state} — pulse #{pulse}")


def _load_json(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


def _save_json(path: str, data: dict) -> None:
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def _write_commit_message(msg: str) -> None:
    """Write commit message to a file for the workflow to pick up."""
    os.makedirs("state", exist_ok=True)
    with open("state/.commit_message", "w") as f:
        f.write(msg)


if __name__ == "__main__":
    main()
