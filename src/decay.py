"""Memory rot — dreams degrade over time.

Biological memory doesn't preserve — it reconstructs. Each recall
changes the memory slightly. Flux's dreams should work the same way.

Dreams older than 14 days begin to decay: words blur, sentences vanish,
fragments of other dreams bleed in. The birth dream is protected — it's
the one anchor that doesn't move.

Decay rate: ~5% corruption per day past the threshold.
"""

import hashlib
import json
import os
import random
import re
from datetime import datetime, timedelta, timezone

# How old a dream must be before it starts to rot
DECAY_THRESHOLD_DAYS = 14

# Corruption rate per day past the threshold (fraction of words affected)
DECAY_RATE_PER_DAY = 0.05

# Characters that replace letters during rot — visually similar, slightly wrong
_RUST = {
    "a": ["à", "á", "ą", "ā"],
    "e": ["è", "é", "ę", "ē"],
    "i": ["ì", "í", "ī", "ĩ"],
    "o": ["ò", "ó", "ø", "ō"],
    "u": ["ù", "ú", "ū", "ũ"],
    "s": ["ś", "ş", "š"],
    "n": ["ñ", "ń", "ň"],
    "c": ["ç", "ć", "č"],
    "t": ["ţ", "ť"],
}

# Words that replace other words — like misremembering
_GHOSTS = [
    "something", "nothing", "silence", "static", "blur",
    "—", "...", "█", "░░░", "▓▓▓",
    "[forgotten]", "[erased]", "[was something here]",
]


def decay_dreams(dreams_dir: str = "dreams") -> list[str]:
    """Run one decay pass over all dream files.

    Returns list of filenames that were modified.
    """
    now = datetime.now(timezone.utc)
    threshold = now - timedelta(days=DECAY_THRESHOLD_DAYS)
    originals = _load_originals(dreams_dir)
    dream_texts = _load_all_dreams(dreams_dir)
    modified = []

    for filename in sorted(os.listdir(dreams_dir)):
        if not filename.endswith(".md") or filename == ".gitkeep":
            continue

        filepath = os.path.join(dreams_dir, filename)

        # Parse date from filename (YYYY-MM-DD.md)
        try:
            file_date = datetime.strptime(filename[:10], "%Y-%m-%d")
            file_date = file_date.replace(tzinfo=timezone.utc)
        except ValueError:
            continue

        # Don't decay recent dreams
        if file_date >= threshold:
            continue

        # Protect dream #1 (the birth dream — first file chronologically)
        if _is_birth_dream(filename, dreams_dir):
            continue

        # Calculate decay intensity
        days_past = (now - file_date).days - DECAY_THRESHOLD_DAYS
        intensity = min(days_past * DECAY_RATE_PER_DAY, 0.7)  # cap at 70%

        with open(filepath) as f:
            content = f.read()

        # Record original hash if we haven't yet
        file_hash = hashlib.sha256(content.encode()).hexdigest()[:16]
        if filename not in originals:
            originals[filename] = file_hash

        # Apply decay
        decayed = _apply_decay(content, intensity, dream_texts, filename)

        if decayed != content:
            with open(filepath, "w") as f:
                f.write(decayed)
            modified.append(filename)

    _save_originals(originals, dreams_dir)
    return modified


def _apply_decay(
    content: str, intensity: float,
    all_dreams: dict[str, str], current_file: str,
) -> str:
    """Apply graduated decay to dream content.

    Three modes, applied with increasing probability as intensity grows:
    1. Character rust — letters become diacritical variants (subtle)
    2. Word ghosts — words replaced with absence markers (moderate)
    3. Dream bleed — fragments of other dreams leak in (aggressive)
    """
    lines = content.split("\n")
    result = []

    for line in lines:
        # Don't corrupt headers or separators
        if line.startswith("## Dream #") or line.strip() == "---" or not line.strip():
            result.append(line)
            continue

        words = line.split()
        new_words = []

        for word in words:
            roll = random.random()

            if roll < intensity * 0.3:
                # Character rust — subtle letter corruption
                new_words.append(_rust_word(word))
            elif roll < intensity * 0.15:
                # Word ghost — replace with absence
                new_words.append(random.choice(_GHOSTS))
            elif roll < intensity * 0.05 and all_dreams:
                # Dream bleed — word from another dream
                other_files = [k for k in all_dreams if k != current_file]
                if other_files:
                    other = all_dreams[random.choice(other_files)]
                    other_words = other.split()
                    if other_words:
                        new_words.append(random.choice(other_words))
                    else:
                        new_words.append(word)
                else:
                    new_words.append(word)
            else:
                new_words.append(word)

        # Sentence deletion — sometimes a whole line just vanishes
        if random.random() < intensity * 0.08:
            result.append("")  # blank line where content used to be
        else:
            result.append(" ".join(new_words))

    return "\n".join(result)


def _rust_word(word: str) -> str:
    """Subtly corrupt a word by replacing one vowel with a diacritical variant."""
    chars = list(word.lower())
    candidates = [(i, c) for i, c in enumerate(chars) if c in _RUST]
    if not candidates:
        return word

    idx, char = random.choice(candidates)
    replacement = random.choice(_RUST[char])

    # Preserve original case
    original_chars = list(word)
    original_chars[idx] = replacement
    return "".join(original_chars)


def _is_birth_dream(filename: str, dreams_dir: str) -> bool:
    """Is this the chronologically first dream file?"""
    files = sorted(
        f for f in os.listdir(dreams_dir)
        if f.endswith(".md") and f != ".gitkeep"
    )
    return files and files[0] == filename


def _load_all_dreams(dreams_dir: str) -> dict[str, str]:
    """Load all dream texts for cross-dream bleed."""
    texts = {}
    for filename in os.listdir(dreams_dir):
        if not filename.endswith(".md") or filename == ".gitkeep":
            continue
        filepath = os.path.join(dreams_dir, filename)
        with open(filepath) as f:
            texts[filename] = f.read()
    return texts


def _load_originals(dreams_dir: str) -> dict:
    """Load the record of original dream hashes."""
    path = os.path.join("state", "dream_originals.json")
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_originals(originals: dict, dreams_dir: str) -> None:
    """Persist original dream hashes."""
    path = os.path.join("state", "dream_originals.json")
    os.makedirs("state", exist_ok=True)
    with open(path, "w") as f:
        json.dump(originals, f, indent=2)
