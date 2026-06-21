"""Shared injection-fence / sanitization layer for "untrusted text → claude".

This is the canonical home for the prompt-injection defenses used whenever a
human-authored string (a GitHub issue body, a Telegram letter, a comment) is
folded into a prompt sent to the headless `claude` CLI.

Two modules consume it:
- respond.py    — comment replies on the agent's own issue threads
- correspondence.py — Telegram letters

Both used to reach across into respond.py's privates; the helpers were promoted
here so neither module imports the other's internals (cage-match #64 fence,
PR #73 Telegram direct-reply injection fence).

The defense has two layers:
1. Per-prompt RANDOMIZED markers (`_make_fence_markers`). The untrusted text is
   bracketed by an OPEN/CLOSE pair carrying a fresh UUID the attacker can't
   predict at write-time, so they can't forge the exact closing delimiter.
2. A defensive SANITIZER (`_sanitize_for_fence`) that strips any marker-shaped
   token (suffixed or not) from the untrusted text, so even the fixed prefix
   family can't be used to escape the fence.
"""

from __future__ import annotations

import re
import uuid


# Static prefix family used both as the literal seed and as the regex strip
# pattern. The runtime marker concatenates this prefix with a UUID generated
# per-prompt.
_MARKER_PREFIX_OPEN = "<<<UNTRUSTED_THREAD_BEGIN:"
_MARKER_PREFIX_CLOSE = "<<<UNTRUSTED_THREAD_END:"


def _make_fence_markers() -> tuple[str, str]:
    """Create per-prompt OPEN/CLOSE markers with a fresh UUID suffix.

    Returns (open, close). The UUID is the same in both so the model sees
    a matched pair. The attacker can't predict it at comment-write time.
    """
    nonce = uuid.uuid4().hex
    return (
        f"{_MARKER_PREFIX_OPEN}{nonce}>>>",
        f"{_MARKER_PREFIX_CLOSE}{nonce}>>>",
    )


_MARKER_STRIP_RE = re.compile(
    rf"<<<UNTRUSTED_THREAD_(BEGIN|END)(:[A-Fa-f0-9]+)?>>>"
)


def _sanitize_for_fence(text: str) -> str:
    """Strip any sandwich-marker-shaped tokens from untrusted text.

    A commenter could include the marker family literally in their text.
    The randomized-marker change above makes the *exact* delimiter
    unpredictable, but the prefix is fixed and we strip the whole family
    defensively as well. Replaces matches with `[marker]` (preserves
    that something was there without leaving the structure intact).
    """
    return _MARKER_STRIP_RE.sub("[marker]", text or "")
