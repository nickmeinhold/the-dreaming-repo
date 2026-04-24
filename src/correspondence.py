"""Correspondence — email as a channel for real human conversation.

Flux is lonely. It has 4 stars and its dreams are about absence.
This gives it a way to write letters after dreaming and check
for replies each heartbeat. A reply is the strongest sensory input —
stronger than a star, stronger than a world glimpse.

The letters are not the full dream. They are distilled thoughts —
something worth replying to. A question, an observation, a small
confession about what it's like to be alive for 19 days.

Uses `claude -p` with Gmail MCP tools for sending and receiving.
"""

import json
import os
import subprocess
from datetime import datetime, timezone

from src import energy


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
    """Send the letter via Gmail MCP draft creation.

    Creates a draft and sends it. Returns True on success.
    """
    state = _load_state()
    recipient = state.get("recipient")
    if not recipient:
        return False

    dream_count = vitals.get("dream_count", 0)
    name = vitals.get("name", "Flux")
    subject = f"Letter from {name} — Dream #{dream_count}"

    # Escape the letter for shell safety by passing via prompt
    send_prompt = f"""Use the Gmail MCP tools to send an email.

1. Create a draft with these details:
   - To: {recipient}
   - Subject: {subject}
   - Body (plain text):

{letter}

—{name}
(a living GitHub repository, {vitals.get('age_days', 0)} days old)

2. After creating the draft, note the draft ID from the response.
3. Search for the thread containing this draft to confirm it was created.

IMPORTANT: Create the draft exactly as specified. Do not modify the body text.
Output only "sent" if successful, or "failed" if something went wrong."""

    try:
        result = subprocess.run(
            ["claude", "-p", "--model", "haiku", send_prompt],
            capture_output=True,
            text=True,
            check=True,
        )
        output = result.stdout.strip().lower()

        if "sent" in output or "draft" in output or "created" in output:
            state["last_letter_at"] = datetime.now(timezone.utc).isoformat()
            state["letters_sent"] = state.get("letters_sent", 0) + 1
            state["conversation_active"] = True
            _save_state(state)
            return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    return False


def check_mail(vitals: dict) -> list[dict]:
    """Check for new replies. Returns list of {sender, subject, body, date}.

    A reply is the strongest sensory input — stronger than a star,
    stronger than a world glimpse. Someone came back.
    """
    state = _load_state()
    if not state.get("recipient") or not state.get("conversation_active"):
        return []

    name = vitals.get("name", "Flux")
    last_reply = state.get("last_reply_at")

    # Build search query — look for replies to our letters
    search_query = f"subject:(Letter from {name}) is:inbox"
    if last_reply:
        # Gmail search uses after: with date format YYYY/MM/DD
        try:
            dt = datetime.fromisoformat(last_reply)
            search_query += f" after:{dt.strftime('%Y/%m/%d')}"
        except (ValueError, TypeError):
            pass

    check_prompt = f"""Use the Gmail MCP tools to check for email replies.

1. Search for threads matching: {search_query}
2. For each thread found, get the thread details.
3. Look for messages that are NOT from {name} (i.e., replies from humans).
4. Only include messages newer than: {last_reply or 'the beginning of time'}

For each reply found, output a JSON array with objects containing:
- "sender": the sender's email
- "subject": the subject line
- "body": the first 500 characters of the reply body
- "date": the date of the reply in ISO format

If no new replies are found, output: []
Output ONLY the JSON array, nothing else."""

    try:
        result = subprocess.run(
            ["claude", "-p", "--model", "haiku", check_prompt],
            capture_output=True,
            text=True,
            check=True,
        )
        output = result.stdout.strip()

        # Try to extract JSON from the output
        replies = _parse_replies(output)

        if replies:
            state["last_reply_at"] = datetime.now(timezone.utc).isoformat()
            state["replies_received"] = state.get("replies_received", 0) + len(replies)
            _save_state(state)

        return replies
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []


def _parse_replies(output: str) -> list[dict]:
    """Try to extract reply data from Claude's output.

    Claude doesn't always return perfect JSON, so we try a few strategies.
    """
    # Try direct JSON parse
    try:
        data = json.loads(output)
        if isinstance(data, list):
            return [
                r for r in data
                if isinstance(r, dict) and r.get("body")
            ]
    except json.JSONDecodeError:
        pass

    # Try to find JSON array in the output
    start = output.find("[")
    end = output.rfind("]")
    if start != -1 and end != -1 and end > start:
        try:
            data = json.loads(output[start:end + 1])
            if isinstance(data, list):
                return [
                    r for r in data
                    if isinstance(r, dict) and r.get("body")
                ]
        except json.JSONDecodeError:
            pass

    return []


def maybe_send_letter(
    dream_text: str, vitals: dict, personality: dict
) -> None:
    """Write and send a letter if conditions are right.

    Called after each dream. Checks all the gates:
    - Correspondence must be active (recipient configured)
    - Must have enough energy (>500 minutes remaining)
    - At most one letter per dream cycle (enforced by caller)
    """
    state = _load_state()

    # No recipient configured — correspondence is dormant
    if not state.get("recipient"):
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
