"""Energy system — tracks GitHub Actions minutes budget.

The repo has 2000 free minutes/month. Every workflow run costs at least 1.
When energy is low, the repo conserves by skipping non-essential actions.
When critical, it does nothing but breathe.
"""

from datetime import datetime, timezone


BUDGET = 2000

# (threshold, label) — checked in order, first match wins
LEVELS = [
    (0.90, "critical"),   # >90% used — barely breathing
    (0.75, "low"),        # >75% used — conserving
    (0.50, "comfortable"),  # >50% used — normal rhythm
    (0.00, "full"),       # <50% used — abundant energy
]


def tick(vitals: dict, now: datetime | None = None) -> None:
    """Record one minute of energy expenditure. Reset on new month."""
    if now is None:
        now = datetime.now(timezone.utc)

    current_month = now.strftime("%Y-%m")
    energy = vitals["energy"]

    if energy["month"] != current_month:
        energy["minutes_used_estimate"] = 0
        energy["month"] = current_month

    energy["minutes_used_estimate"] += 1
    ratio = energy["minutes_used_estimate"] / BUDGET
    energy["level"] = next(label for threshold, label in LEVELS if ratio >= threshold)


def is_critical(vitals: dict) -> bool:
    """Should the repo do nothing but exist?"""
    return vitals["energy"]["level"] == "critical"


def is_low(vitals: dict) -> bool:
    """Should the repo skip non-essential actions like dreaming?"""
    return vitals["energy"]["level"] in ("critical", "low")


def remaining(vitals: dict) -> int:
    """Estimated minutes remaining this month."""
    return BUDGET - vitals["energy"]["minutes_used_estimate"]
