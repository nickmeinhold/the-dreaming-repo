"""State machine for the dreaming repository.

Pure function. No side effects. Determines consciousness state
based on time since last human interaction.

States:
    awake    — recent human activity (< 30 min idle)
    drowsy   — quiet period (30-90 min idle)
    sleeping — deep quiet (> 90 min idle), dreams may occur on entry
"""

from datetime import datetime, timedelta, timezone


# How long without human contact before state transitions
AWAKE_THRESHOLD = timedelta(minutes=30)
DROWSY_THRESHOLD = timedelta(minutes=90)


def transition(vitals: dict, now: datetime | None = None) -> str:
    """Determine the next consciousness state.

    Args:
        vitals: Current vitals dict with 'last_human_activity_at' timestamp.
        now: Current time. Defaults to UTC now.

    Returns:
        New state string: 'awake', 'drowsy', or 'sleeping'.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    last_activity = datetime.fromisoformat(vitals["last_human_activity_at"])
    if last_activity.tzinfo is None:
        last_activity = last_activity.replace(tzinfo=timezone.utc)

    idle = now - last_activity

    if idle < AWAKE_THRESHOLD:
        return "awake"
    if idle < DROWSY_THRESHOLD:
        return "drowsy"
    return "sleeping"


def entered_new_state(old_state: str, new_state: str) -> bool:
    """Did we just transition into a different state?"""
    return old_state != new_state
