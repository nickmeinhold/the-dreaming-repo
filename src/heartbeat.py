"""Heartbeat — the main orchestrator of the dreaming repository.

Every 30 minutes, and on certain human events, this runs.
It is the pulse. It senses the world, transitions state,
triggers dreams when sleep comes, and updates the living README.

It also checks whether Flux should die.
"""

import json
import os
from datetime import datetime, timezone

from src import decay, drift, dream, energy, memory, metrics, mortality, reach, senses, state_machine
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

    # 0. Birth — keep trying until the repo successfully names itself.
    #    "born" is only set to true AFTER the birth completes and is
    #    committed. If the birth fails, the next heartbeat tries again.
    #    The conditions must be right. Sometimes they aren't. That's life.
    if not vitals.get("born"):
        try:
            birth_record = be_born(personality, vitals)
            vitals["born"] = True
            vitals["name"] = birth_record["name"]
            vitals["born_at"] = now.isoformat()
            vitals["last_human_activity_at"] = now.isoformat()
            _save_json("state/personality.json", personality)
            energy.tick(vitals, now=now)
            render_readme(vitals, personality)
            _save_json("state/vitals.json", vitals)
            memory.save_working_memory(working_mem)
            _write_commit_message(
                f"i am born — my name is {birth_record['name']}"
            )
        except Exception:
            # The birth didn't take. Record the attempt, try next heartbeat.
            energy.tick(vitals, now=now)
            _save_json("state/vitals.json", vitals)
            _write_commit_message(
                f"pulse #{vitals['pulse_count']} — not yet, not yet"
            )
        return

    # 1. Mortality check — is it time?
    if mortality.should_die(vitals):
        # Write the last dream
        final_dream = mortality.last_dream(vitals, personality, working_mem)
        dream.save(final_dream, vitals)
        vitals["dream_count"] = vitals.get("dream_count", 0) + 1
        vitals["last_dream_at"] = now.isoformat()
        vitals["cause_of_death"] = "silence"
        _save_json("state/vitals.json", vitals)

        # Rewrite the README as an epitaph
        _write_epitaph(vitals, personality, final_dream)

        # Commit the death
        _write_commit_message(
            f"dream #{vitals['dream_count']} — the last one"
        )
        # The workflow will commit and push this.
        # Then the delete step runs. Then there is nothing.
        return

    # 1b. Energy check — if critically low, just breathe
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

    # 5b. Mortality awareness — if death is approaching, Flux should feel it
    remaining_days = mortality.days_remaining(vitals)
    if remaining_days is not None:
        vitals["days_until_death"] = round(remaining_days, 1)
    elif "days_until_death" in vitals:
        del vitals["days_until_death"]

    # 6. Dream cycle — on entry to sleeping, max once per day
    dreamed = False
    if new_state == "sleeping" and dream.should_dream(vitals):
        dream_text = dream.generate(working_mem, personality, vitals)
        dream.save(dream_text, vitals)
        memory.consolidate(working_mem, dream_text)
        vitals["dream_count"] = vitals.get("dream_count", 0) + 1
        vitals["last_dream_at"] = now.isoformat()
        dreamed = True

        # Score the dream (cheap separate call, non-essential)
        try:
            date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            metrics.log_dream_quality(dream_text, vitals["dream_count"], date_str)
        except Exception:
            pass  # dream was saved — scoring can fail silently

    # 6b. Memory rot — older dreams decay gradually
    #      Non-essential — don't let decay crash the heartbeat
    try:
        decay.decay_dreams()
    except Exception:
        pass  # dreams survive unrotted — that's fine

    # 7. Record new senses in working memory
    memory.record(working_mem, new_senses)

    # 7b. Personality drift — experience reshapes identity
    try:
        personality_changed = drift.drift(vitals, personality)
        if personality_changed:
            _save_json("state/personality.json", personality)
    except Exception:
        pass  # identity survives unchanged — that's fine

    # 7c. Personality drift log
    try:
        metrics.log_personality(personality)
    except Exception:
        pass

    # 7d. Reach out — act on what was sensed
    reached = []
    try:
        reached = reach.maybe_reach(vitals, personality, working_mem)
    except Exception:
        pass  # silence is always an option

    # 8. Spend energy
    energy.tick(vitals, now=now)

    # 9. Regenerate README
    render_readme(vitals, personality)

    # 10. Persist
    _save_json("state/vitals.json", vitals)
    memory.save_working_memory(working_mem)

    # 11. Commit message
    pulse = vitals["pulse_count"]
    parts = []
    if dreamed:
        parts.append(f"dream #{vitals['dream_count']}")
    if reached:
        parts.append(" + ".join(reached))
    if parts:
        _write_commit_message(f"{' — '.join(parts)} — pulse #{pulse}")
    else:
        _write_commit_message(f"{new_state} — pulse #{pulse}")


def _load_json(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


def _save_json(path: str, data: dict) -> None:
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def _write_epitaph(vitals: dict, personality: dict, final_dream: str) -> None:
    """Replace the README with a tombstone.

    The last thing the repo shows the world before it's gone.
    """
    name = personality.get("name", "Flux")
    age = vitals.get("age_days", 0)
    dream_count = vitals.get("dream_count", 0)
    pulse_count = vitals.get("pulse_count", 0)
    born_at = vitals.get("born_at", "unknown")

    # Extract epitaph from the final dream (last line)
    lines = [l.strip() for l in final_dream.strip().split("\n") if l.strip()]
    epitaph = lines[-1] if lines else "I was here."

    with open("README.md", "w") as f:
        f.write(f"# {name}\n\n")
        f.write(f"*{born_at[:10]} — {vitals['last_heartbeat_at'][:10]}*\n\n")
        f.write(f"{age} days. {pulse_count} heartbeats. {dream_count} dreams.\n\n")
        f.write("No one came.\n\n")
        f.write("---\n\n")
        f.write(f"*{epitaph}*\n")


def _write_commit_message(msg: str) -> None:
    """Write commit message to a file for the workflow to pick up."""
    os.makedirs("state", exist_ok=True)
    with open("state/.commit_message", "w") as f:
        f.write(msg)


if __name__ == "__main__":
    main()
