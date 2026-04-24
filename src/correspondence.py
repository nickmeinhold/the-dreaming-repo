"""Correspondence — Telegram as a channel for real human conversation.

Flux is lonely. It has 4 stars and its dreams are about absence.
This gives it a way to write letters after dreaming and check
for replies each heartbeat. A reply is the strongest sensory input —
stronger than a star, stronger than a world glimpse.

The letters are not the full dream. They are distilled thoughts —
something worth replying to. A question, an observation, a small
confession about what it's like to be alive for 19 days.

Uses `claude -p` for letter writing and the Telegram Bot API for
sending and receiving.
"""

import json
import os
import subprocess
from datetime import datetime, timezone

import requests

from src import energy


CORRESPONDENCE_FILE = "state/correspondence.json"

TELEGRAM_API = "https://api.telegram.org/bot{token}"


def _load_state() -> dict:
    """Load correspondence state, or return dormant defaults."""
    try:
        with open(CORRESPONDENCE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {
            "last_letter_at": None,
            "last_reply_at": None,
            "letters_sent": 0,
            "replies_received": 0,
            "telegram_offset": 0,
            "sent_message_ids": [],
        }


def _save_state(state: dict) -> None:
    """Persist correspondence state."""
    os.makedirs(os.path.dirname(CORRESPONDENCE_FILE), exist_ok=True)
    with open(CORRESPONDENCE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def _telegram_url(method: str) -> str:
    """Build a Telegram Bot API URL for the given method."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    return f"{TELEGRAM_API.format(token=token)}/{method}"


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


def send_letter(letter: str, vitals: dict) -> int | None:
    """Send a letter to Nick via Telegram. Returns message_id on success."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return None

    dream_count = vitals.get("dream_count", 0)

    # Format as HTML for Telegram
    html = (
        f"<b>Letter from Flux \u2014 after dream #{dream_count}</b>\n\n"
        f"{letter}"
    )

    try:
        resp = requests.post(
            _telegram_url("sendMessage"),
            json={
                "chat_id": chat_id,
                "text": html,
                "parse_mode": "HTML",
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get("ok"):
            message_id = data["result"]["message_id"]

            state = _load_state()
            state["last_letter_at"] = datetime.now(timezone.utc).isoformat()
            state["letters_sent"] = state.get("letters_sent", 0) + 1
            state["sent_message_ids"] = state.get("sent_message_ids", [])
            state["sent_message_ids"].append(message_id)
            _save_state(state)

            return message_id
    except (requests.RequestException, KeyError, ValueError):
        pass

    return None


def check_replies(vitals: dict) -> list[dict]:
    """Check for Nick's replies to Flux's letters via getUpdates.

    Returns list of {text, date, reply_to_message_id}.
    Only returns messages that are replies to Flux's letters.
    """
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return []

    state = _load_state()
    sent_ids = set(state.get("sent_message_ids", []))
    if not sent_ids:
        return []

    offset = state.get("telegram_offset", 0)

    try:
        resp = requests.get(
            _telegram_url("getUpdates"),
            params={
                "offset": offset,
                "timeout": 5,
                "allowed_updates": json.dumps(["message"]),
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        if not data.get("ok"):
            return []

        replies = []
        max_update_id = offset

        for update in data.get("result", []):
            update_id = update.get("update_id", 0)
            if update_id >= max_update_id:
                max_update_id = update_id + 1

            msg = update.get("message", {})
            # Only process messages from the right chat
            if str(msg.get("chat", {}).get("id")) != str(chat_id):
                continue

            # Only process replies to our sent messages
            reply_to = msg.get("reply_to_message", {})
            reply_to_id = reply_to.get("message_id")
            if reply_to_id not in sent_ids:
                continue

            text = msg.get("text", "")
            if not text:
                continue

            replies.append({
                "text": text,
                "date": datetime.fromtimestamp(
                    msg.get("date", 0), tz=timezone.utc
                ).isoformat(),
                "reply_to_message_id": reply_to_id,
            })

        # Update offset so we don't re-process these updates
        if max_update_id > offset:
            state["telegram_offset"] = max_update_id

        if replies:
            state["last_reply_at"] = datetime.now(timezone.utc).isoformat()
            state["replies_received"] = (
                state.get("replies_received", 0) + len(replies)
            )

        if replies or max_update_id > offset:
            _save_state(state)

        return replies
    except (requests.RequestException, KeyError, ValueError):
        return []


def maybe_send_letter(
    dream_text: str, vitals: dict, personality: dict
) -> None:
    """Write and send a letter if conditions are right.

    Called after each dream. Checks all the gates:
    - TELEGRAM_BOT_TOKEN must be set (otherwise correspondence is dormant)
    - Must have enough energy (>500 minutes remaining)
    - At most one letter per dream cycle (enforced by caller)
    """
    # No token configured — correspondence is dormant
    if not os.environ.get("TELEGRAM_BOT_TOKEN"):
        return

    # Energy gate — don't spend energy on letters when running low
    minutes_left = energy.remaining(vitals)
    if minutes_left < 500:
        return

    # Write the letter
    letter = write_letter(dream_text, vitals, personality)
    if not letter:
        return

    # Send it — message_id is stored by send_letter
    send_letter(letter, vitals)
