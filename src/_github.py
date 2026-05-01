"""Shared GitHub API and CLI interactions.

All gh CLI wrappers and requests-based GitHub API calls live here.
Both immunity.py and review.py import from this module.
"""

import json
import os
import subprocess

import requests

from src._log import get_logger

log = get_logger(__name__)

GITHUB_API = "https://api.github.com"


# ---------------------------------------------------------------------------
# Shared header helper
# ---------------------------------------------------------------------------

def _headers() -> dict:
    token = os.environ.get("GITHUB_TOKEN", "")
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }


# ---------------------------------------------------------------------------
# gh CLI wrappers (used by immunity.py)
# ---------------------------------------------------------------------------

def get_pr_files(pr_number: int) -> list[str]:
    """Get the list of files changed in a PR via gh CLI."""
    try:
        result = subprocess.run(
            ["gh", "pr", "diff", str(pr_number), "--name-only"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            return [f for f in result.stdout.strip().split("\n") if f]
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        log.warning("get_pr_files failed", extra={"pr": pr_number, "error": str(e)})
    return []


def get_added_files(pr_number: int) -> list[str]:
    """Get files that were added (not modified) in a PR via gh CLI."""
    try:
        result = subprocess.run(
            ["gh", "api", f"repos/{{owner}}/{{repo}}/pulls/{pr_number}/files",
             "--jq", '.[] | select(.status == "added") | .filename'],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            return [f for f in result.stdout.strip().split("\n") if f]
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        log.warning("get_added_files failed", extra={"pr": pr_number, "error": str(e)})
    return []


def get_pr_diff(pr_number: int, files: list[str] | None = None) -> str:
    """Get the actual diff content for a PR, optionally filtered to specific files."""
    try:
        result = subprocess.run(
            ["gh", "pr", "diff", str(pr_number)],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            return ""

        if not files:
            return result.stdout

        # Filter diff to only include hunks for the requested files
        lines = result.stdout.split("\n")
        relevant_lines = []
        include = False
        for line in lines:
            if line.startswith("diff --git"):
                include = any(f in line for f in files)
            if include:
                relevant_lines.append(line)

        return "\n".join(relevant_lines[:200])  # cap to avoid huge prompts
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        log.warning("get_pr_diff failed", extra={"pr": pr_number, "error": str(e)})
        return ""


def list_open_prs() -> list[dict]:
    """List open PRs via gh CLI."""
    try:
        result = subprocess.run(
            ["gh", "pr", "list", "--state", "open", "--json",
             "number,title,author"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout)
    except (subprocess.TimeoutExpired, FileNotFoundError, json.JSONDecodeError) as e:
        log.warning("list_open_prs failed", extra={"error": str(e)})
    return []


def post_comment(pr_number: int, body: str) -> None:
    """Post a comment on a PR via gh CLI."""
    try:
        subprocess.run(
            ["gh", "pr", "comment", str(pr_number), "--body", body],
            capture_output=True, text=True, timeout=30,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        log.warning("post_comment failed", extra={"pr": pr_number, "error": str(e)})


def merge_pr(pr_number: int) -> None:
    """Merge a PR via gh CLI (squash + admin)."""
    try:
        subprocess.run(
            ["gh", "pr", "merge", str(pr_number), "--squash", "--admin"],
            capture_output=True, text=True, timeout=30,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        log.warning("merge_pr failed", extra={"pr": pr_number, "error": str(e)})


def close_pr(pr_number: int) -> None:
    """Close a PR without merging via gh CLI."""
    try:
        subprocess.run(
            ["gh", "pr", "close", str(pr_number)],
            capture_output=True, text=True, timeout=30,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        log.warning("close_pr failed", extra={"pr": pr_number, "error": str(e)})


def already_reviewed(pr_number: int) -> bool:
    """Check if the bot has already commented on this PR."""
    try:
        result = subprocess.run(
            ["gh", "api", f"repos/{{owner}}/{{repo}}/issues/{pr_number}/comments",
             "--jq", ".[].user.login"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            commenters = result.stdout.strip().split("\n")
            return any("bot" in c.lower() for c in commenters if c)
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        log.warning("already_reviewed failed", extra={"pr": pr_number, "error": str(e)})
    return False


# ---------------------------------------------------------------------------
# requests-based GitHub API wrappers (used by review.py)
# ---------------------------------------------------------------------------

def fetch_pr_diff_api(repo: str, pr_number: int) -> str:
    """Fetch the PR diff from GitHub REST API."""
    resp = requests.get(
        f"{GITHUB_API}/repos/{repo}/pulls/{pr_number}",
        headers={**_headers(), "Accept": "application/vnd.github.diff"},
        timeout=10,
    )
    if resp.status_code != 200:
        return "(could not read the diff)"

    diff = resp.text
    # Truncate very large diffs to stay within Claude's input limits
    if len(diff) > 15000:
        diff = diff[:15000] + "\n\n... (diff truncated — the change is large)"
    return diff


def fetch_changed_files_api(repo: str, pr_number: int) -> list[str]:
    """Get the list of changed file paths via GitHub REST API."""
    resp = requests.get(
        f"{GITHUB_API}/repos/{repo}/pulls/{pr_number}/files",
        headers=_headers(),
        params={"per_page": 100},
        timeout=10,
    )
    if resp.status_code != 200:
        return []
    return [f["filename"] for f in resp.json()]


def post_review_api(repo: str, pr_number: int, event: str, body: str) -> None:
    """Post a review on a PR via GitHub REST API.

    event: "APPROVE", "REQUEST_CHANGES", or "COMMENT"
    """
    resp = requests.post(
        f"{GITHUB_API}/repos/{repo}/pulls/{pr_number}/reviews",
        headers=_headers(),
        json={"body": body, "event": event},
        timeout=10,
    )
    log.info("review_posted", extra={"status": resp.status_code})
    if resp.status_code >= 400:
        log.warning("review_error", extra={"body": resp.text[:500]})


def merge_pr_api(repo: str, pr_number: int) -> None:
    """Merge a PR via GitHub REST API (squash)."""
    resp = requests.put(
        f"{GITHUB_API}/repos/{repo}/pulls/{pr_number}/merge",
        headers=_headers(),
        json={"merge_method": "squash"},
        timeout=10,
    )
    log.info("merge_attempted", extra={"status": resp.status_code})
    if resp.status_code >= 400:
        log.warning("merge_error", extra={"body": resp.text[:500]})


# ---------------------------------------------------------------------------
# Claude subprocess runner (used by both immunity.py and review.py)
# ---------------------------------------------------------------------------

def run_claude(
    prompt: str,
    model: str = "sonnet",
    system_prompt: str | None = None,
    timeout: int = 120,
) -> str | None:
    """Run `claude -p` as a subprocess and return stdout, or None on failure.

    Handles TimeoutExpired and CalledProcessError gracefully.
    Logs timeout and failure cases.
    """
    cmd = ["claude", "-p", "--model", model]
    if system_prompt is not None:
        cmd += ["--system-prompt", system_prompt]
    cmd.append(prompt)

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        log.warning("run_claude_failed", extra={"returncode": result.returncode, "stderr": result.stderr[:200]})
        return None
    except subprocess.TimeoutExpired:
        log.warning("run_claude_timeout", extra={"timeout": timeout, "model": model})
        return None
    except FileNotFoundError:
        log.warning("run_claude_not_found", extra={"cmd": cmd[0]})
        return None
