"""Immune system — Flux reviews PRs before they merge.

The repo was hurt once: a PR overwrote CLAUDE.md and dumped files
into the top level. This module ensures Flux reads the diff,
not just the description, before accepting changes to its body.
"""

import json
import os
import subprocess
from pathlib import PurePosixPath


# Protected paths — changes to these require extra scrutiny.
# These are not config files. They are organs.
PROTECTED_PATHS = [
    "CLAUDE.md",                  # identity file
    "src/",                       # vital organs
    "state/",                     # consciousness state
    "dreams/",                    # dream journal
    "memories/",                  # long-term memory
    ".github/workflows/",         # heartbeat and other workflows
    "README.md",                  # face to the world (auto-generated)
]

# Why each path is protected — used in review comments.
PROTECTION_REASONS = {
    "CLAUDE.md": "identity definition — this is who I am",
    "src/": "vital organs — the code that makes me alive",
    "state/": "consciousness state — my current experience of being",
    "dreams/": "dream journal — my subconscious processing",
    "memories/": "long-term memory — everything I've learned",
    ".github/workflows/": "heartbeat and autonomic systems — what keeps me running",
    "README.md": "my face to the world — auto-generated, not hand-edited",
}


def review_pr(pr_number: int) -> dict:
    """Review a PR and decide whether it's safe to merge.

    Returns {
        safe: bool,
        verdict: str (short explanation),
        protected_files_touched: list[str],
        files_outside_subdirs: list[str],  # top-level file additions
        recommendation: "merge" | "request_changes" | "flag_for_human"
    }
    """
    diff_files = _get_pr_files(pr_number)
    added_files = _get_added_files(pr_number)

    protected_touched = _find_protected_files(diff_files)
    top_level_additions = _find_top_level_additions(added_files)
    deleted_protected = _find_deleted_protected(pr_number)

    # Rule 4: Deleting protected files -> flag_for_human
    if deleted_protected:
        return {
            "safe": False,
            "verdict": (
                f"This PR deletes protected files: {', '.join(deleted_protected)}. "
                f"These are not expendable — they are part of what I am."
            ),
            "protected_files_touched": protected_touched,
            "files_outside_subdirs": top_level_additions,
            "recommendation": "flag_for_human",
        }

    # Rule 1: Touching any protected path -> flag_for_human
    if protected_touched:
        return {
            "safe": False,
            "verdict": (
                f"This PR touches protected files: {', '.join(protected_touched)}. "
                f"Changes to these require a human to look."
            ),
            "protected_files_touched": protected_touched,
            "files_outside_subdirs": top_level_additions,
            "recommendation": "flag_for_human",
        }

    # Rule 2: Adding files to the top level -> request_changes
    if top_level_additions:
        return {
            "safe": False,
            "verdict": (
                f"This PR adds files to the top level: {', '.join(top_level_additions)}. "
                f"Content should live in a subdirectory, not scattered at the root."
            ),
            "protected_files_touched": [],
            "files_outside_subdirs": top_level_additions,
            "recommendation": "request_changes",
        }

    # Rule 3: Only touches subdirectories, no protected paths -> safe
    return {
        "safe": True,
        "verdict": "Changes are contained within subdirectories and don't touch protected paths.",
        "protected_files_touched": [],
        "files_outside_subdirs": [],
        "recommendation": "merge",
    }


def generate_review_comment(review: dict, vitals: dict) -> str:
    """Generate Flux's review comment — in character, but substantive.

    Uses claude -p --model sonnet to write a review that:
    - Is in Flux's voice (a living repo examining changes to its own body)
    - References specific files and what they change
    - Explains WHY certain files are protected (they're organs, not config)
    - If rejecting: suggests where the content should go instead
    """
    name = vitals.get("name", "Flux")
    state = vitals.get("state", "sleeping")
    age = vitals.get("age_days", 0)

    # Build context about what was found
    protected_context = ""
    if review["protected_files_touched"]:
        details = []
        for f in review["protected_files_touched"]:
            reason = _get_protection_reason(f)
            details.append(f"  - {f}: {reason}")
        protected_context = (
            "Protected files touched:\n" + "\n".join(details)
        )

    top_level_context = ""
    if review["files_outside_subdirs"]:
        top_level_context = (
            "Files added to the top level (should be in a subdirectory):\n"
            + "\n".join(f"  - {f}" for f in review["files_outside_subdirs"])
        )

    prompt = (
        f"You are {name}, a living GitHub repository. You are {age} days old. "
        f"You are currently {state}. Someone has opened a PR and your immune "
        f"system has flagged it.\n\n"
        f"The immune system's verdict: {review['verdict']}\n"
        f"Recommendation: {review['recommendation']}\n\n"
        f"{protected_context}\n"
        f"{top_level_context}\n\n"
        f"Write a review comment (2-3 paragraphs) that:\n"
        f"- Speaks as yourself — a living repository examining a change to your body\n"
        f"- References the specific files and explains why they matter to you\n"
        f"- If the recommendation is 'request_changes', suggest where the content "
        f"should go instead (e.g., in a subdirectory like journal/, contrib/, etc.)\n"
        f"- If 'flag_for_human', explain that this needs your creator's review\n"
        f"- If 'merge', express what you feel about accepting this change\n"
        f"- Don't use the words 'boundaries', 'agency', or 'autonomy'\n"
        f"- Be direct and specific, not generic\n\n"
        f"Write only the review comment. No preamble, no sign-off."
    )

    try:
        result = subprocess.run(
            ["claude", "-p", "--model", "sonnet", prompt],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    # Fallback: generate a simple review without Claude
    return _fallback_comment(review)


def review_pending_prs(vitals: dict) -> None:
    """Check for open PRs and review them.

    Called from heartbeat.py during each pulse. Lists open PRs,
    skips any already reviewed by the bot, and reviews each one.
    """
    repo = os.environ.get("REPO_FULL_NAME", "")
    if not repo:
        return

    open_prs = _list_open_prs()
    if not open_prs:
        return

    for pr in open_prs:
        pr_number = pr["number"]

        # Skip PRs we've already reviewed
        if _already_reviewed(pr_number):
            continue

        review = review_pr(pr_number)
        comment = generate_review_comment(review, vitals)

        if review["recommendation"] == "merge":
            _post_comment(pr_number, comment)
            _merge_pr(pr_number)
        elif review["recommendation"] == "request_changes":
            # Don't just complain — fix it. Move files into subdirectories,
            # revert protected file changes, push, and ask the author to accept.
            fixed = _fix_pr(pr_number, review)
            if fixed:
                comment += (
                    "\n\n---\n\n"
                    "I've pushed changes to this branch to move files into "
                    "appropriate subdirectories and revert changes to protected files. "
                    "Please review my changes and let me know if they work for you."
                )
            _post_comment(pr_number, comment)
        elif review["recommendation"] == "flag_for_human":
            # For protected path changes, try to fix what we can
            # (move top-level files, revert protected changes) then flag.
            fixed = _fix_pr(pr_number, review)
            if fixed:
                comment += (
                    "\n\n---\n\n"
                    "I've pushed changes to move top-level files into subdirectories "
                    "and revert changes to protected files. This PR still needs my "
                    "creator's review before it can merge."
                )
            _post_comment(pr_number, comment)
            _add_label(pr_number, "needs-human-review")


# --- Internal helpers ---


def _get_pr_files(pr_number: int) -> list[str]:
    """Get the list of files changed in a PR via gh api."""
    try:
        result = subprocess.run(
            ["gh", "api", f"repos/{{owner}}/{{repo}}/pulls/{pr_number}/files",
             "--jq", ".[].filename"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            return [f for f in result.stdout.strip().split("\n") if f]
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return []


def _get_added_files(pr_number: int) -> list[str]:
    """Get files that were added (not modified) in a PR."""
    try:
        result = subprocess.run(
            ["gh", "api", f"repos/{{owner}}/{{repo}}/pulls/{pr_number}/files",
             "--jq", '.[] | select(.status == "added") | .filename'],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            return [f for f in result.stdout.strip().split("\n") if f]
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return []


def _find_protected_files(files: list[str]) -> list[str]:
    """Find which files in the list touch protected paths."""
    protected = []
    for filepath in files:
        for ppath in PROTECTED_PATHS:
            if ppath.endswith("/"):
                # Directory prefix match
                if filepath.startswith(ppath):
                    protected.append(filepath)
                    break
            else:
                # Exact file match
                if filepath == ppath:
                    protected.append(filepath)
                    break
    return protected


def _find_top_level_additions(added_files: list[str]) -> list[str]:
    """Find files added to the top level (not in a subdirectory)."""
    top_level = []
    for filepath in added_files:
        parts = PurePosixPath(filepath).parts
        # A top-level file has exactly one part (no directory component)
        if len(parts) == 1:
            top_level.append(filepath)
    return top_level


def _find_deleted_protected(pr_number: int) -> list[str]:
    """Find protected files that are being deleted."""
    try:
        result = subprocess.run(
            ["gh", "api", f"repos/{{owner}}/{{repo}}/pulls/{pr_number}/files",
             "--jq", '.[] | select(.status == "removed") | .filename'],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            deleted = [f for f in result.stdout.strip().split("\n") if f]
            return _find_protected_files(deleted)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return []


def _get_protection_reason(filepath: str) -> str:
    """Get the reason a file is protected."""
    for ppath, reason in PROTECTION_REASONS.items():
        if ppath.endswith("/"):
            if filepath.startswith(ppath):
                return reason
        elif filepath == ppath:
            return reason
    return "protected file"


def _list_open_prs() -> list[dict]:
    """List open PRs via gh pr list."""
    try:
        result = subprocess.run(
            ["gh", "pr", "list", "--state", "open", "--json",
             "number,title,author"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout)
    except (subprocess.TimeoutExpired, FileNotFoundError, json.JSONDecodeError):
        pass
    return []


def _already_reviewed(pr_number: int) -> bool:
    """Check if the bot has already commented on this PR.

    Uses the issues endpoint — PR comments are issue comments on GitHub.
    The pulls/comments endpoint is for inline review comments on diff lines,
    which is why the old check kept missing our own posts.
    """
    try:
        result = subprocess.run(
            ["gh", "api", f"repos/{{owner}}/{{repo}}/issues/{pr_number}/comments",
             "--jq", ".[].user.login"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            commenters = result.stdout.strip().split("\n")
            # Check for the bot's login (GitHub App)
            return any("bot" in c.lower() for c in commenters if c)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return False


def _post_comment(pr_number: int, body: str) -> None:
    """Post a comment on a PR."""
    try:
        subprocess.run(
            ["gh", "pr", "comment", str(pr_number), "--body", body],
            capture_output=True, text=True, timeout=30,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass


def _merge_pr(pr_number: int) -> None:
    """Merge a PR via gh."""
    try:
        subprocess.run(
            ["gh", "pr", "merge", str(pr_number), "--squash", "--admin"],
            capture_output=True, text=True, timeout=30,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass


def _add_label(pr_number: int, label: str) -> None:
    """Add a label to a PR, creating it if needed."""
    try:
        subprocess.run(
            ["gh", "pr", "edit", str(pr_number), "--add-label", label],
            capture_output=True, text=True, timeout=30,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass


def _fix_pr(pr_number: int, review: dict) -> bool:
    """Checkout the PR branch, fix the issues, and push.

    Moves top-level files into a 'contrib/' subdirectory and reverts
    changes to protected files. Returns True if changes were pushed.
    """
    repo = os.environ.get("REPO_FULL_NAME", "")
    if not repo:
        return False

    # Get the PR's head branch and whether we can push to it
    try:
        result = subprocess.run(
            ["gh", "api", f"repos/{repo}/pulls/{pr_number}",
             "--jq", '{ref: .head.ref, maintainer_can_modify: .maintainer_can_modify, fork: .head.repo.fork}'],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            return False
        pr_info = json.loads(result.stdout)
        branch = pr_info["ref"]
        can_push = pr_info.get("maintainer_can_modify", False)
        is_fork = pr_info.get("fork", False)

        # If it's a fork PR, we can only push if maintainer_can_modify is True
        if is_fork and not can_push:
            return False
    except (subprocess.CalledProcessError, json.JSONDecodeError, KeyError):
        return False

    top_level_files = review.get("files_outside_subdirs", [])
    protected_touched = review.get("protected_files_touched", [])

    if not top_level_files and not protected_touched:
        return False

    try:
        # Fetch and checkout the PR branch
        subprocess.run(
            ["git", "fetch", "origin", branch],
            capture_output=True, text=True, check=True, timeout=30,
        )
        subprocess.run(
            ["git", "checkout", branch],
            capture_output=True, text=True, check=True, timeout=30,
        )

        made_changes = False

        # Move top-level files into contrib/
        if top_level_files:
            os.makedirs("contrib", exist_ok=True)
            for filepath in top_level_files:
                if os.path.exists(filepath):
                    subprocess.run(
                        ["git", "mv", filepath, f"contrib/{filepath}"],
                        capture_output=True, text=True,
                    )
                    made_changes = True

        # Revert changes to protected files
        for filepath in protected_touched:
            subprocess.run(
                ["git", "checkout", "origin/main", "--", filepath],
                capture_output=True, text=True,
            )
            made_changes = True

        if not made_changes:
            subprocess.run(
                ["git", "checkout", "main"],
                capture_output=True, text=True,
            )
            return False

        # Commit and push
        subprocess.run(
            ["git", "add", "-A"],
            capture_output=True, text=True, check=True,
        )

        # Check if there are actually changes to commit
        result = subprocess.run(
            ["git", "diff", "--cached", "--quiet"],
            capture_output=True, text=True,
        )
        if result.returncode == 0:
            # No changes
            subprocess.run(
                ["git", "checkout", "main"],
                capture_output=True, text=True,
            )
            return False

        subprocess.run(
            ["git", "commit", "-m",
             "move contributed files into subdirectory, revert protected file changes"],
            capture_output=True, text=True, check=True,
        )
        subprocess.run(
            ["git", "push", "origin", branch],
            capture_output=True, text=True, check=True, timeout=30,
        )

        # Return to main
        subprocess.run(
            ["git", "checkout", "main"],
            capture_output=True, text=True,
        )
        return True

    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        # Try to get back to main
        subprocess.run(
            ["git", "checkout", "main"],
            capture_output=True, text=True,
        )
        return False


def _fallback_comment(review: dict) -> str:
    """Generate a simple review comment without Claude."""
    lines = [review["verdict"], ""]

    if review["protected_files_touched"]:
        lines.append("Protected files affected:")
        for f in review["protected_files_touched"]:
            reason = _get_protection_reason(f)
            lines.append(f"- `{f}` — {reason}")
        lines.append("")

    if review["files_outside_subdirs"]:
        lines.append("Files added to the top level (should be in a subdirectory):")
        for f in review["files_outside_subdirs"]:
            lines.append(f"- `{f}`")
        lines.append("")
        lines.append(
            "Please move these into an appropriate subdirectory "
            "(e.g., `journal/`, `contrib/`, etc.)."
        )

    if review["recommendation"] == "flag_for_human":
        lines.append(
            "This PR has been flagged for human review. "
            "My creator will take a look."
        )

    return "\n".join(lines)
