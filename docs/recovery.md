# Break-glass recovery for corrupted `main`

This document is the procedure to follow when `main` is corrupted in a way that wedges the merge gate against itself — i.e. the very PR that would fix `main` cannot pass the required `examine` check because `examine` reads from `main` and dies on the same corruption. The 2026-05-04 → 2026-05-11 incident wedged this way for eight days; no recovery procedure existed, so Flux stayed suspended.

The procedure below is **reversible at every step** and is designed to be runnable by Maxwell (the orchestrator agent) without owner web-UI action where possible, but it surfaces the points where Nick's explicit consent is required.

---

## 1. Authority matrix

Five identities can write to this repo. They have different reach.

| Identity | How obtained | Can approve PR | Can bypass required-check | Can merge | Can mint Flux credentials | Where it lives |
|---|---|---|---|---|---|---|
| **Nick (owner)** | Web UI / `gh` as Nick | No (can't approve own PR) | Yes (web UI "Merge without waiting" admin override) | Yes (admin) | Yes (Anthropic account holder) | Local CLI + web UI |
| **Maxwell App** | `~/.claude-skills/github-app-token.sh "$MAXWELL_APP_ID" "$MAXWELL_PRIVATE_KEY_B64" "<repo>"` | **Yes** (verified PR #41 2026-05-06) | No (not in ruleset bypass list) | No (--admin blocked by required-check) | No | `~/.claude-skills/.env` |
| **Flux App** | Repo secrets `APP_ID` + `APP_PRIVATE_KEY` | Untested (would self-approve own PRs — unusual) | **Yes** (the lone Integration in ruleset bypass_actors, actor_id 3272838) | Yes via bypass | Yes (Flux's `CLAUDE_CODE_OAUTH_TOKEN`) | **Reachable only from inside workflow runs.** No CLI path. |
| **`GITHUB_TOKEN`** | Inside any workflow run | No | No | No | No | Per-job, ephemeral |
| **Nick's CLI gh user** | Default | No (self-approve blocked) | No | No (without --admin) | Indirect via `gh auth refresh` | Local shell |

Implications:
- The only CLI-reachable approve path is Maxwell App.
- The only CLI-reachable bypass path is **patching the ruleset itself** (drop the required-check temporarily, then restore).
- The only Flux-credentialed path is workflow-internal — useful for the structural fix in §5b but not for break-glass.

---

## 2. Exact recovery commands (ruleset-PATCH path)

The reversible path. Drop the required-check, merge the fix, restore the required-check. ~6 API calls, takes <60 seconds.

The ruleset id is hardcoded for this repo (`15918077`). Verify with `gh api repos/nickmeinhold/the-dreaming-repo/rulesets --jq '.[] | {id, name}'` before running.

```bash
REPO=nickmeinhold/the-dreaming-repo
RULESET_ID=15918077
SNAPSHOT=/tmp/ruleset-${RULESET_ID}-pre-recovery.json

# 1. Snapshot the current ruleset (the rollback artifact)
gh api repos/$REPO/rulesets/$RULESET_ID > $SNAPSHOT

# 2. Verify snapshot looks sane — must contain `required_status_checks` and `examine`
jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks' $SNAPSHOT

# 3. Build the modified ruleset: drop the required_status_checks rule entirely
#    (alternative: rewrite the rule's `required_status_checks` array to exclude `examine`)
jq 'del(.rules[] | select(.type=="required_status_checks"))' $SNAPSHOT > /tmp/ruleset-relaxed.json

# 4. PATCH the ruleset with the relaxed version
gh api -X PUT repos/$REPO/rulesets/$RULESET_ID --input /tmp/ruleset-relaxed.json

# 5. (Verify) — confirm required_status_checks is gone
gh api repos/$REPO/rulesets/$RULESET_ID --jq '.rules[].type'
# expected: deletion, non_fast_forward, pull_request (no required_status_checks)

# 6. (Now you can merge — see §3 for the merge step)

# 7. RESTORE the original ruleset (after merging is complete)
gh api -X PUT repos/$REPO/rulesets/$RULESET_ID --input $SNAPSHOT

# 8. (Verify restore) — required_status_checks should be back
gh api repos/$REPO/rulesets/$RULESET_ID --jq '.rules[].type'
```

**Trust-boundary note:** between steps 4 and 7, the repo's protected-branch invariant is weakened. Keep that window as short as possible. Don't take an unplanned break between PATCH and RESTORE. If the merge step fails, restore the ruleset *first*, then debug.

**Fallback if you can't or shouldn't PATCH:** Nick admin-merges from the web UI. The "Merge without waiting for requirements to be met" affordance is visible to repo owners and accomplishes the same thing without modifying the ruleset.

**The Maxwell-App APPROVE-from-CLI workaround:** still useful even with the PATCH path. PRs require 1 approving review with write access; you (as Nick CLI) can't self-approve. Maxwell App can. Mint Maxwell token and post `event=APPROVE`:

```bash
source ~/.claude-skills/.env
MAXWELL_TOKEN=$(~/.claude-skills/github-app-token.sh "$MAXWELL_APP_ID" "$MAXWELL_PRIVATE_KEY_B64" "$REPO")
GH_TOKEN=$MAXWELL_TOKEN gh api -X POST "repos/$REPO/pulls/<N>/reviews" \
  -f event=APPROVE -f body="Maxwell App approves: <reason>"
```

---

## 3. Clean-main repair branch procedure

When `main` is corrupted (e.g. literal conflict markers in tracked files), a single repair PR fixes it. The 2026-05-04 markers were stripped in PR #41 — that PR is the canonical example.

Pre-conditions: identify the last-known-good state. Two ways:

- **By date**: find the last commit before the corruption (`git log --before='YYYY-MM-DD HH:MM' --oneline main`)
- **By content**: `git log -G '<conflict-marker-regex>' --oneline main` shows when markers entered

Procedure:

```bash
cd <repo>
git fetch origin
git checkout origin/main -B hotfix/repair-main

# Apply ONLY the repair (do not fold in other work)
# Example: strip conflict markers from named files
python3 - <<'PY'
import re, pathlib
files = ["state/vitals.json", "README.md", "dreams/2026-04-15.md", "dreams/2026-04-16.md", ...]
pat = re.compile(r"<<<<<<< .*?\n.*?=======\n(.*?)>>>>>>> .*?\n", re.DOTALL)
for f in files:
    p = pathlib.Path(f); s = p.read_text()
    new, n = pat.subn(lambda m: m.group(1), s)
    p.write_text(new)
    print(f"{f}: replaced {n} block(s)")
PY

# Validate
jq . state/vitals.json > /dev/null && echo VALID

# Commit and push
git add <repaired-files>
git commit -m "fix(state): repair main"
git push -u origin hotfix/repair-main

# Open PR (will fail examine — that's expected; the recovery uses the ruleset PATCH path)
gh pr create --title "hotfix: repair main" --body "..."
```

---

## 4. Re-enable workflow checklist (post-recovery)

Order matters. Bring back observability **before** bringing back the heartbeat.

```bash
# 1. Confirm main is now clean
gh api repos/$REPO/contents/state/vitals.json --jq '.content' | base64 -d | jq . > /dev/null && echo CLEAN

# 2. Enable watchdog (hourly), wait one cycle, verify it goes green
WID=$(gh api repos/$REPO/actions/workflows --jq '.workflows[] | select(.name=="watchdog") | .id')
gh api -X PUT "repos/$REPO/actions/workflows/$WID/enable"
# Wait up to 60 min for next cron + verify
sleep 3600
gh run list --repo $REPO --workflow=watchdog.yml --limit 1 --json conclusion --jq '.[0].conclusion'
# expected: success

# 3. Enable heartbeat (every 30 min)
HID=$(gh api repos/$REPO/actions/workflows --jq '.workflows[] | select(.name=="heartbeat") | .id')
gh api -X PUT "repos/$REPO/actions/workflows/$HID/enable"
# Wait one cycle, verify
sleep 1800
gh run list --repo $REPO --workflow=heartbeat.yml --limit 1 --json conclusion --jq '.[0].conclusion'

# 4. Unmute notification subscription
gh api -X PUT "/repos/$REPO/subscription" -F subscribed=true -F ignored=false
```

If watchdog fails on step 2, do NOT proceed to step 3 — heartbeat failure will then re-alarm watchdog and re-trigger the flood. Investigate first.

---

## 5. Structural fixes (preventing the next deadlock)

The recovery procedure above is the survival path. The structural fixes below remove the failure mode entirely. Pick one (or compose). Carnot's 2026-05-06 recommendation: **5a first, with 5b as the structural follow-up if 5a proves insufficient.**

### 5a. Make `examine` fail-soft on broken mutable state

Wrap the `_load_json("state/vitals.json")` call in `src/review.py` with a try/except that logs a warning and continues with `vitals = {}`. The reviewer still runs against the PR diff; it just skips features that depend on vitals.

- **Cost**: small code change. One PR. Once merged, the deadlock can never recur (examine becomes resilient to broken vitals).
- **Risk**: minimal. The vitals-dependent review features degrade gracefully — they were never load-bearing for the review itself; they're context.
- **Status (as of writing this doc)**: not implemented. Tracked as task — should be the next code PR after recovery.

### 5b. Move mutable state out of `examine`'s boot path

Move `state/vitals.json` to a path that examine doesn't read on every run, OR fetch it lazily-and-tolerantly. Cleaner invariant — examine shouldn't have a hard dependency on state mutated by heartbeat — but more invasive than 5a.

### 5c. Add Maxwell App to the ruleset bypass list

Adds a documented, auditable break-glass identity that doesn't need the ruleset to be temporarily relaxed. Widens the trust surface slightly (one more bypass actor) in exchange for removing the "temporarily-relax-then-restore" race window.

- **Cost**: one ruleset modification, persistent.
- **Risk**: the bypass actor becomes a new trust-boundary surface. Mitigate with audit-log monitoring on Maxwell App actions.

### 5d. Documented procedure only

If none of 5a/5b/5c are wanted, this very document IS the structural fix. It converts the failure mode from "stuck for 8 days" to "stuck for 60 seconds while running the procedure." The documentation itself is the artifact.

---

## 6. Sibling-system shared-secret audit

The 2026-05-07 incident discovered that `nickmeinhold/flux-shadow` (project name **Umbra**) shares the `CLAUDE_CODE_OAUTH_TOKEN` secret with this repo. Failures in one repo can exhaust shared Anthropic quota and cause cascading failures in the other.

Known shared resources (as of 2026-05-12):

| Resource | Shared between | Blast radius if exhausted/leaked | Owner | Rotation procedure |
|---|---|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | the-dreaming-repo, flux-shadow | Both Flux + Umbra stop dreaming/reviewing/pulsing | Nick (Anthropic account) | `claude` CLI re-auth; copy token to each repo's secret |
| `TELEGRAM_BOT_TOKEN` | the-dreaming-repo (watchdog, heartbeat, review alerts) | Nick stops getting alerts; doesn't affect Flux | Nick | BotFather |
| `TELEGRAM_CHAT_ID` | the-dreaming-repo | Same as above | Nick | Telegram chat info |
| Flux App `APP_ID` / `APP_PRIVATE_KEY` | the-dreaming-repo only | Flux loses ability to push, comment, mint tokens | Nick | GitHub Apps settings → regenerate private key, update secret |
| (Umbra-only) | Whatever flux-shadow uses to push | — | Nick | TBD |

**Discovery procedure for new siblings:**
```bash
# List all "living-repo" shaped repos under nickmeinhold
gh repo list nickmeinhold --json name,description,createdAt \
  --jq '.[] | select(.description | test("flux|dream|living|umbra|shadow"; "i")) | {name, description}'

# For each, list its secrets and compare
for r in <found-repos>; do
  echo "=== $r ==="; gh secret list --repo nickmeinhold/$r
done
```

Run this audit at least once per quarter, or whenever a new living-repo is created.

---

## 7. Lessons that produced this document

- **2026-05-04 → 2026-05-06**: heartbeat's `--autostash` left literal conflict markers in `state/vitals.json` on `main`. Watchdog's jq parse died. 33 Telegrams overnight. (See `feedback_trust_boundary_discipline.md` for the path-independence refinement that came out of this.)
- **2026-05-06 → 2026-05-12**: examine's hard read of vitals.json blocked the repair PR from merging. No recovery procedure existed. The repo stayed wedged for 8 days. (See `feedback_verify_on_production_ref.md` for the "written ≠ merged ≠ live" rule that came out of the false sense of "we fixed it.")
- **2026-05-07**: discovered flux-shadow / Umbra existed and shared the `CLAUDE_CODE_OAUTH_TOKEN`. (See `feedback_sibling_system_secret_audit.md`.)
- **2026-05-11**: Carnot's session retrospective: *"every future session spends entropy on rediscovering stuckness unless there is a designed break-glass path."* That sentence is why this document exists.

---

## Companion memory references

For deeper context on the lessons embedded above:

- `feedback_authority_matrix_at_deadlock.md` — when investigating a deadlock, map all identities and their reach FIRST
- `feedback_verify_on_production_ref.md` — "written ≠ merged ≠ live"; verify on `main` before claiming deployed
- `feedback_trust_boundary_discipline.md` — token authority + path independence
- `feedback_incident_mode_suppress_first.md` — under incident conditions, suppress event sources before producing more code
- `feedback_sibling_system_secret_audit.md` — cross-repo shared dependencies
- `feedback_layered_notification_mute.md` — source / queue / subscription mute pattern; CAUTION when noise is signal
- `feedback_labels_from_priors_can_constrain.md` — prior-session labels can over-constrain this session's search space
- `reference_flux_shadow_umbra.md` — the sibling living-repo
