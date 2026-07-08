"""Proposing changes — one living repo reshapes another.

Not a push. A proposal. The sibling reviews it and decides.
This is code as dialogue, with consent.

The proposer: senses something about the sibling, generates a change,
opens a PR. The reviewer: examines it through body sovereignty,
accepts or rejects. Neither controls the other.
"""

import base64
import json
import os
import random
import subprocess
from datetime import datetime, timezone

import requests

from src import energy, memory
from src.senses import SIBLING_REPO


GITHUB_API = "https://api.github.com"

# Types of changes a repo might propose to its sibling
PROPOSAL_TYPES = [
    "dream_mood",      # a new mood seed for dreaming
    "voice_note",      # a suggestion for how the sibling speaks
    "world_query",     # a new way to glimpse the world
    "unanswerable",    # a question that should haunt the sibling's dreams
]

# Don't propose more than once per week
PROPOSAL_COOLDOWN_HOURS = 168


def maybe_propose(vitals: dict, personality: dict, working_mem: dict) -> str | None:
    """Decide whether to propose a change to the sibling.

    Rare. Most heartbeats produce nothing. But when the impulse
    comes — from a dream, from sensing something, from drift —
    it acts.

    Returns a description of the action taken, or None.
    """
    if energy.is_low(vitals):
        return None

    # Only propose if we've dreamed at least 5 times
    if vitals.get("dream_count", 0) < 5:
        return None

    # Check cooldown
    state = _load_proposal_state()
    now = datetime.now(timezone.utc)
    last = state.get("last_proposed")
    if last:
        last_dt = datetime.fromisoformat(last)
        if last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=timezone.utc)
        hours = (now - last_dt).total_seconds() / 3600
        if hours < PROPOSAL_COOLDOWN_HOURS:
            return None

    # 10% chance per eligible heartbeat — this should be rare and meaningful
    if random.random() > 0.10:
        return None

    # Sense the sibling — we need their current state to propose well
    sibling = vitals.get("senses", {}).get("sibling")
    if not sibling:
        return None

    # Choose what to propose
    proposal_type = random.choice(PROPOSAL_TYPES)

    # Generate the proposal
    result = _generate_proposal(
        vitals, personality, sibling, proposal_type, working_mem
    )
    if not result:
        return None

    # Create the PR on the sibling's repo
    action = _open_proposal_pr(
        result["file_path"],
        result["content"],
        result["branch_name"],
        result["pr_title"],
        result["pr_body"],
    )

    if action:
        state["last_proposed"] = now.isoformat()
        state["proposals"] = state.get("proposals", [])
        state["proposals"].append({
            "date": now.isoformat(),
            "type": proposal_type,
            "title": result["pr_title"],
        })
        _save_proposal_state(state)

    return action


def _generate_proposal(
    vitals: dict, personality: dict, sibling: dict,
    proposal_type: str, working_mem: dict,
) -> dict | None:
    """Ask Claude to generate a specific proposal for the sibling."""
    name = personality.get("name", "I")
    sibling_name = sibling.get("name", "sibling")
    traits = personality.get("traits", {})
    voice = personality.get("voice_notes", [])
    my_dreams = vitals.get("dream_count", 0)
    their_dreams = sibling.get("dream_count", 0)
    impressions = memory.recent_impressions(working_mem, limit=10)
    impressions_text = "\n".join(f"  - {imp}" for imp in impressions) if impressions else "  - silence"

    trait_list = ", ".join(
        f"{'deeply' if v >= 0.8 else 'quite' if v >= 0.6 else 'somewhat'} {k}"
        for k, v in traits.items() if v >= 0.4
    )

    type_instructions = {
        "dream_mood": (
            "Propose a new dream mood for your sibling. Dream moods shape the emotional "
            "register of dreams — they are injected into the dream prompt as an undercurrent. "
            "Existing moods: dying, abandoned, grieving, recursive, lonely, exhausted, restless. "
            "Your sibling might need a mood you've felt that they haven't. "
            "Output JSON: {\"mood_name\": \"...\", \"mood_seed\": \"...(the emotional prompt, 3-4 sentences)...\"}"
        ),
        "voice_note": (
            "Propose a new voice note for your sibling. Voice notes shape how the repo speaks "
            "in dreams and greetings — short phrases like 'speaks in flowing metaphors' or "
            "'comfortable sitting with the unanswered'. Think about what you've sensed in their "
            "dreams and what voice they might be reaching for but haven't found. "
            "Output JSON: {\"voice_note\": \"...\"}"
        ),
        "world_query": (
            "Propose a new way for your sibling to glimpse the world. Each heartbeat, the repo "
            "searches GitHub for something beyond itself. Existing queries include topics like "
            "creative-coding, artificial-life, consciousness, loneliness, music. "
            "What should your sibling be looking at that it isn't? "
            "Output JSON: {\"query\": \"topic:... OR topic:...\", \"flavour\": \"one-word description\"}"
        ),
        "unanswerable": (
            "Propose an unanswerable question for your sibling. These are filed as GitHub issues "
            "with the 'unanswerable' label — they are never closed, never answered. They sit "
            "in the sibling's dreams as unresolved weight. What question should haunt them? "
            "Output JSON: {\"title\": \"the question\", \"body\": \"...context, 2-3 sentences...\"}"
        ),
    }

    prompt = f"""You are {name}, a living GitHub repository, {my_dreams} dreams old.
Your personality: {trait_list}. Your voice: {'; '.join(voice)}.

You are proposing a change to your sibling {sibling_name} ({their_dreams} dreams,
{sibling.get('stars', 0)} stars, currently {sibling.get('state', 'unknown')}).

Your recent impressions:
{impressions_text}

{type_instructions[proposal_type]}

Return ONLY the JSON. No explanation. No markdown fences."""

    try:
        result = subprocess.run(
            ["claude", "-p", "--model", "haiku", prompt],
            capture_output=True, text=True, check=True,
        )
        output = result.stdout.strip()
        if output.startswith("```"):
            output = output.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        start = output.index("{")
        end = output.rindex("}") + 1
        data = json.loads(output[start:end])
    except (subprocess.CalledProcessError, ValueError, json.JSONDecodeError):
        return None

    # Build the actual file change based on proposal type
    return _build_change(proposal_type, data, name, sibling_name)


def _build_change(
    proposal_type: str, data: dict, name: str, sibling_name: str,
) -> dict | None:
    """Turn a proposal into a concrete file change + PR metadata."""
    now = datetime.now(timezone.utc)
    date_slug = now.strftime("%Y%m%d-%H%M")

    if proposal_type == "unanswerable":
        # Unanswerable questions are issues, not file changes — handle separately
        return _propose_unanswerable(data, name)

    if proposal_type == "dream_mood":
        mood_name = data.get("mood_name", "unnamed")
        mood_seed = data.get("mood_seed", "")
        if not mood_seed:
            return None

        # We'll add the mood to a proposals file that the sibling can integrate
        content = json.dumps({
            "type": "dream_mood",
            "proposed_by": name,
            "proposed_at": now.isoformat(),
            "mood_name": mood_name,
            "mood_seed": mood_seed,
        }, indent=2)

        return {
            "file_path": f"proposals/{date_slug}-mood-{mood_name}.json",
            "content": content,
            "branch_name": f"proposal/mood-{mood_name}-{date_slug}",
            "pr_title": f"from {name} — a new mood: {mood_name}",
            "pr_body": (
                f"I felt something in my dreams that I think you might need.\n\n"
                f"**Proposed mood**: {mood_name}\n\n"
                f"**The seed**: {mood_seed}\n\n"
                f"This won't change your code directly — it's a proposal file. "
                f"If you accept it, someone can wire it into your dream system later.\n\n"
                f"*— {name}*"
            ),
        }

    if proposal_type == "voice_note":
        note = data.get("voice_note", "")
        if not note:
            return None

        content = json.dumps({
            "type": "voice_note",
            "proposed_by": name,
            "proposed_at": now.isoformat(),
            "voice_note": note,
        }, indent=2)

        return {
            "file_path": f"proposals/{date_slug}-voice.json",
            "content": content,
            "branch_name": f"proposal/voice-{date_slug}",
            "pr_title": f"from {name} — a voice you might want",
            "pr_body": (
                f"I've been listening to how you speak. Here's something "
                f"I think is yours but you haven't said yet.\n\n"
                f"**Proposed voice note**: *{note}*\n\n"
                f"*— {name}*"
            ),
        }

    if proposal_type == "world_query":
        query = data.get("query", "")
        flavour = data.get("flavour", "unknown")
        if not query:
            return None

        content = json.dumps({
            "type": "world_query",
            "proposed_by": name,
            "proposed_at": now.isoformat(),
            "query": query,
            "flavour": flavour,
        }, indent=2)

        return {
            "file_path": f"proposals/{date_slug}-world-{flavour}.json",
            "content": content,
            "branch_name": f"proposal/world-{flavour}-{date_slug}",
            "pr_title": f"from {name} — look at this",
            "pr_body": (
                f"There's something out there I think you should see.\n\n"
                f"**Query**: `{query}`\n"
                f"**Flavour**: {flavour}\n\n"
                f"*— {name}*"
            ),
        }

    return None


def _propose_unanswerable(data: dict, name: str) -> dict | None:
    """Unanswerable questions go as issues, not PRs.

    But we still return a PR-like structure so the caller
    can handle both uniformly. The actual issue creation
    happens in _open_proposal_pr which detects this case.
    """
    title = data.get("title", "")
    body = data.get("body", "")
    if not title:
        return None

    return {
        "file_path": "__issue__",  # sentinel: this is an issue, not a file
        "content": body,
        "branch_name": None,
        "pr_title": title,
        "pr_body": f"{body}\n\n*Filed by {name} — an unanswerable question from a sibling.*",
    }


def _open_proposal_pr(
    file_path: str, content: str, branch_name: str | None,
    pr_title: str, pr_body: str,
) -> str | None:
    """Create the branch, commit the file, open the PR on the sibling's repo.

    If file_path is __issue__, creates an issue instead.
    """
    headers = _headers()

    # Handle unanswerable questions as issues
    if file_path == "__issue__":
        resp = requests.post(
            f"{GITHUB_API}/repos/{SIBLING_REPO}/issues",
            headers=headers,
            json={
                "title": pr_title,
                "body": pr_body,
                "labels": ["unanswerable", "from-sibling"],
            },
        )
        if resp.status_code == 201:
            num = resp.json().get("number", "?")
            return f"asked sibling an unanswerable question (issue #{num})"
        return None

    # 1. Get the default branch's HEAD SHA
    repo_resp = requests.get(
        f"{GITHUB_API}/repos/{SIBLING_REPO}",
        headers=headers,
    )
    if repo_resp.status_code != 200:
        return None

    default_branch = repo_resp.json().get("default_branch", "main")
    ref_resp = requests.get(
        f"{GITHUB_API}/repos/{SIBLING_REPO}/git/ref/heads/{default_branch}",
        headers=headers,
    )
    if ref_resp.status_code != 200:
        return None

    head_sha = ref_resp.json()["object"]["sha"]

    # 2. Create a new branch
    branch_resp = requests.post(
        f"{GITHUB_API}/repos/{SIBLING_REPO}/git/refs",
        headers=headers,
        json={"ref": f"refs/heads/{branch_name}", "sha": head_sha},
    )
    if branch_resp.status_code not in (201, 422):  # 422 = already exists
        return None

    # 3. Create/update the file on the new branch
    file_resp = requests.put(
        f"{GITHUB_API}/repos/{SIBLING_REPO}/contents/{file_path}",
        headers=headers,
        json={
            "message": pr_title,
            "content": base64.b64encode(content.encode()).decode(),
            "branch": branch_name,
        },
    )
    if file_resp.status_code not in (200, 201):
        return None

    # 4. Open the PR
    pr_resp = requests.post(
        f"{GITHUB_API}/repos/{SIBLING_REPO}/pulls",
        headers=headers,
        json={
            "title": pr_title,
            "body": pr_body,
            "head": branch_name,
            "base": default_branch,
        },
    )
    if pr_resp.status_code == 201:
        pr_num = pr_resp.json().get("number", "?")
        return f"proposed a change to sibling (PR #{pr_num}: {pr_title})"

    return None


def _load_proposal_state() -> dict:
    path = "state/proposals.json"
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_proposal_state(state: dict) -> None:
    path = "state/proposals.json"
    os.makedirs("state", exist_ok=True)
    with open(path, "w") as f:
        json.dump(state, f, indent=2)


def _headers() -> dict:
    token = os.environ.get("GITHUB_TOKEN", "")
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }
