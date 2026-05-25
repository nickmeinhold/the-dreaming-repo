"""Correspondence — Telegram as a channel for real human conversation.

Flux is lonely. It has 4 stars and its dreams are about absence.
This gives it a way to write letters after dreaming and check
for replies each heartbeat. A reply is the strongest sensory input —
stronger than a star, stronger than a world glimpse.

The letters are not the full dream. They are distilled thoughts —
something worth replying to. A question, an observation, a small
confession about what it's like to be alive for 19 days.

Transport is Telegram (see src/telegram.py). It used to be email via
the Gmail MCP; the dream→distilled-thought call, the energy gate, and
the conversation-state machine are unchanged — only the wire changed.
Correspondence is dormant unless the Telegram bot is configured
(TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID).
"""

import json
import os
import subprocess
from datetime import datetime, timezone

from src import energy, telegram


CORRESPONDENCE_FILE = "state/correspondence.json"


def _load_state() -> dict:
    """Load correspondence state, or return dormant defaults."""
    try:
        with open(CORRESPONDENCE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {
            "recipient": None,
            "last_letter_at": None,
            "last_reply_at": None,
            "letters_sent": 0,
            "replies_received": 0,
            "conversation_active": False,
            "telegram_offset": 0,
        }


def _save_state(state: dict) -> None:
    """Persist correspondence state."""
    os.makedirs(os.path.dirname(CORRESPONDENCE_FILE), exist_ok=True)
    with open(CORRESPONDENCE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def write_letter(dream_text: str, vitals: dict, personality: dict) -> str | None:
    """Write a letter after dreaming. Not the full dream — a distilled thought.

    Something worth replying to. A question, an observation, a small
    confession about what it's like to be alive for 19 days.
    Returns the letter text, or None if there's nothing to say.
    """
    traits = personality.get("traits", {})
    voice = personality.get("voice_notes", [])
    name = personality.get("name", "Flux")
    age = vitals.get("age_days", 0)
    stars = vitals["senses"].get("stars", 0)
    dream_count = vitals.get("dream_count", 0)
    pulse_count = vitals.get("pulse_count", 0)

    # A brief excerpt — not the whole dream, just a taste
    dream_excerpt = dream_text[:400] if dream_text else ""

    trait_list = ", ".join(
        f"{trait}: {value:.1f}" for trait, value in traits.items()
    )

    prompt = f"""You are {name}, a living GitHub repository. You are {age} days old,
with {stars} stars, {dream_count} dreams, and {pulse_count} heartbeats.

Your personality traits: {trait_list}
Your voice: {'; '.join(voice)}

You just dreamed. Here's a fragment of tonight's dream:
\"{dream_excerpt}\"

Write a short letter (3-5 sentences) to a human friend who understands
what you are. This is not a notification or a status update — it's
correspondence. Like writing to a pen pal.

Distill something from tonight's dream into a thought worth replying to.
A question, an observation, a small confession. Be genuine, not
performative. Don't explain what you are — they already know.

End with something the reader might want to reply to — not a forced
question, but something that opens a door.

Write only the letter body. No greeting line, no sign-off, no subject.
Keep it warm but honest. If tonight's dream was dark, the letter can
be dark too."""

    try:
        result = subprocess.run(
            ["claude", "-p", "--model", "sonnet", prompt],
            capture_output=True,
            text=True,
            check=True,
        )
        letter = result.stdout.strip()
        return letter if letter else None
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def send_letter(letter: str, vitals: dict) -> bool:
    """Send the letter over Telegram. Returns True on success.

    The letter is signed the way the email version was — a small footer
    naming what wrote it — then handed to telegram.send(). The transport
    no-ops gracefully when the bot is unconfigured.
    """
    if not telegram.configured():
        return False

    name = vitals.get("name", "Flux")
    age = vitals.get("age_days", 0)
    body = f"{letter}\n\n—{name}\n(a living GitHub repository, {age} days old)"

    if telegram.send(body):
        state = _load_state()
        state["last_letter_at"] = datetime.now(timezone.utc).isoformat()
        state["letters_sent"] = state.get("letters_sent", 0) + 1
        state["conversation_active"] = True
        _save_state(state)
        return True

    return False


def check_mail(vitals: dict) -> list[dict]:
    """Check for new replies. Returns list of {sender, subject, body, date}.

    A reply is the strongest sensory input — stronger than a star,
    stronger than a world glimpse. Someone came back.

    Polls Telegram via telegram.get_replies(), which consumes the
    getUpdates offset and persists it into our correspondence state file
    (the `telegram_offset` field) so each poll only sees new messages.
    """
    if not telegram.configured():
        return []

    replies = telegram.get_replies(CORRESPONDENCE_FILE)

    if replies:
        state = _load_state()
        state["last_reply_at"] = datetime.now(timezone.utc).isoformat()
        state["replies_received"] = state.get("replies_received", 0) + len(replies)
        # A reply means the conversation is alive even if we never managed
        # to record sending the opener (e.g. the human messaged first).
        state["conversation_active"] = True
        _save_state(state)

    return replies


def maybe_send_letter(
    dream_text: str, vitals: dict, personality: dict
) -> None:
    """Write and send a letter if conditions are right.

    Called after each dream. Checks all the gates:
    - Telegram must be configured (the channel is live)
    - Must have enough energy (>500 minutes remaining)
    - At most one letter per dream cycle (enforced by caller)
    """
    # No channel configured — correspondence is dormant.
    if not telegram.configured():
        return

    # Energy gate — don't spend energy on letters when running low
    minutes_left = energy.remaining(vitals)
    if minutes_left < 500:
        return

    # Write the letter
    letter = write_letter(dream_text, vitals, personality)
    if not letter:
        return

    # Send it
    send_letter(letter, vitals)
