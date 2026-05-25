"""Telegram — a two-way channel for real human conversation.

This is the transport layer. The agent writes distilled thoughts after
dreaming and sends them to a human via a Telegram bot; the human can
reply, and replies are read back on the next heartbeat. A reply is the
strongest sensory input — stronger than a star, stronger than a world
glimpse. Someone came back.

Talks to the Telegram Bot API directly over the Python standard library
(`urllib.request`) — no third-party dependency. Each agent has its OWN
bot, configured via two environment variables:

    TELEGRAM_BOT_TOKEN   the bot token from @BotFather
    TELEGRAM_CHAT_ID     the chat (human) the bot talks to

When either is unset, the whole module no-ops gracefully: send() returns
False and get_replies() returns []. An unconfigured fork must never
crash the heartbeat.
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request


API_BASE = "https://api.telegram.org"

# Network calls are best-effort and must never hang a heartbeat.
_TIMEOUT = 15


def _token() -> str:
    return os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()


def _chat_id() -> str:
    return os.environ.get("TELEGRAM_CHAT_ID", "").strip()


def configured() -> bool:
    """True iff both the bot token and the chat id are present and non-empty."""
    return bool(_token()) and bool(_chat_id())


def _api_url(method: str) -> str:
    return f"{API_BASE}/bot{_token()}/{method}"


def send(text: str) -> bool:
    """Send a message to the configured chat. Returns success.

    No-op (returns False) when unconfigured. Never raises — any network,
    HTTP, or decode error is caught and reported as failure.
    """
    if not configured():
        return False
    if not text:
        return False

    data = urllib.parse.urlencode(
        {"chat_id": _chat_id(), "text": text}
    ).encode("utf-8")

    req = urllib.request.Request(
        _api_url("sendMessage"),
        data=data,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            return bool(payload.get("ok"))
    except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError):
        return False


def _load_offset(offset_state_path: str) -> int:
    """Read the last consumed update_id from the offset state file.

    Returns 0 when the file is missing or unreadable (start from the
    beginning — Telegram retains updates for ~24h).
    """
    try:
        with open(offset_state_path) as f:
            state = json.load(f)
        return int(state.get("telegram_offset", 0) or 0)
    except (FileNotFoundError, json.JSONDecodeError, ValueError, TypeError):
        return 0


def _save_offset(offset_state_path: str, last_update_id: int) -> None:
    """Persist the last consumed update_id, merging into existing state.

    The offset is stored alongside the rest of the correspondence state so
    a single JSON file holds both the conversation gates and the polling
    cursor. We merge rather than overwrite so we never clobber sibling
    fields written by correspondence.py.
    """
    try:
        with open(offset_state_path) as f:
            state = json.load(f)
        if not isinstance(state, dict):
            state = {}
    except (FileNotFoundError, json.JSONDecodeError):
        state = {}

    state["telegram_offset"] = int(last_update_id)

    dirname = os.path.dirname(offset_state_path)
    if dirname:
        os.makedirs(dirname, exist_ok=True)
    with open(offset_state_path, "w") as f:
        json.dump(state, f, indent=2)


def get_replies(offset_state_path: str) -> list[dict]:
    """Fetch new messages from the configured chat since the last poll.

    getUpdates is offset-consuming: passing `offset = last_update_id + 1`
    acknowledges every update up to `last_update_id`, so Telegram stops
    returning them. We persist the highest update_id we've seen into
    `offset_state_path` so each poll sees only genuinely new messages and
    nothing is re-read or lost.

    Returns a list of dicts shaped like the email-era replies so the rest
    of the pipeline (memory.record_reply) is unchanged:
        {"sender": str, "subject": str, "body": str, "date": str}

    No-op (returns []) when unconfigured. Never raises.
    """
    if not configured():
        return []

    last = _load_offset(offset_state_path)
    params = {"timeout": 0, "offset": last + 1}
    url = _api_url("getUpdates") + "?" + urllib.parse.urlencode(params)

    try:
        with urllib.request.urlopen(url, timeout=_TIMEOUT) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError):
        return []

    if not payload.get("ok"):
        return []

    chat_id = _chat_id()
    replies: list[dict] = []
    max_update_id = last

    for update in payload.get("result", []):
        update_id = update.get("update_id")
        if isinstance(update_id, int) and update_id > max_update_id:
            max_update_id = update_id

        # Only plain messages with text from the configured chat count as
        # replies. Ignore edited messages, channel posts, our own echoes,
        # and anything from a different chat.
        message = update.get("message")
        if not isinstance(message, dict):
            continue
        chat = message.get("chat", {})
        if str(chat.get("id")) != chat_id:
            continue
        text = message.get("text")
        if not text:
            continue

        sender = message.get("from", {}) or {}
        name = (
            sender.get("username")
            or sender.get("first_name")
            or "someone"
        )
        # Telegram dates are unix seconds; expose as-is under "date".
        replies.append({
            "sender": name,
            "subject": "",
            "body": text,
            "date": str(message.get("date", "")),
        })

    # Persist the new offset even if no text replies surfaced — non-text
    # updates (stickers, edits) still advance the cursor so we don't keep
    # re-fetching them every heartbeat.
    if max_update_id != last:
        _save_offset(offset_state_path, max_update_id)

    return replies
