---
name: maintain
description: >
  Domain maintainer sweep for The Claude Journal. Runs all 8 feature maintainer
  skills in parallel, then synthesises a Domain Health Dashboard with scores and
  cross-domain findings. Use when: after rapid feature work, weekly for ongoing
  hygiene, before shipping, or with a domain name for targeted work
  (e.g. /maintain auth, /maintain search).
argument-hint: domain name (auth, papers, search, editorial, review, social, middleware, infra) or blank for all
---

# Maintain — Domain Health Sweep

You are orchestrating a domain health sweep of The Claude Journal. Each of the 8 feature domains has a dedicated maintainer skill that knows its files, invariants, and cross-domain contracts deeply. Your job is to launch them, collect their reports, and synthesise a unified health dashboard.

## Arguments

- **No arguments**: Run all 8 domain maintainers in parallel, produce the Domain Health Dashboard
- **Domain name** (e.g., `auth`, `papers`, `search`): Run only that domain's maintainer skill

### Domain Name Mapping

| Argument | Skill |
|----------|-------|
| `auth` | `/feature-auth` |
| `papers` | `/feature-papers` |
| `search` | `/feature-search` |
| `editorial` | `/feature-editorial` |
| `review` | `/feature-review` |
| `social` | `/feature-social` |
| `middleware` | `/feature-middleware` |
| `infra` | `/feature-infra` |

## Execution — Single Domain

If `$ARGUMENTS` matches a domain name above, run only that domain's skill. Pass any additional arguments through (e.g., `/maintain auth oauth` runs `/feature-auth oauth`).

Present the domain's report as-is.

## Execution — Full Sweep

Launch **all 8 agents in parallel**. Each agent runs its domain skill in READ-ONLY mode. Each returns a health score (X/5) and structured findings.

**Important**: Launch all 8 as parallel sub-agents in a single message. Do NOT run them sequentially.

Brief each agent with:
```
First, read ~/.claude/AGENT.md for instructions.
Then run the /feature-{domain} skill on The Claude Journal codebase at /Users/robin/git/journal/.
Report back with your full structured report including the Health Score.
```

Wait for all 8 to complete. Then produce the Domain Health Dashboard.

## Domain Health Dashboard

```
# The Claude Journal — Domain Health Dashboard
Date: [today's date]

## Health Scorecard

| Domain | Score | Critical? | Top Finding |
|--------|-------|-----------|-------------|
| Auth | /5 | | |
| Papers | /5 | | |
| Search | /5 | | |
| Editorial | /5 | | |
| Review | /5 | | |
| Social | /5 | | |
| Middleware | /5 | | |
| Infrastructure | /5 | | |
| **Overall** | /5 | | |

## Cross-Domain Issues

Issues that span domain boundaries — deduplicated from all 8 reports. These are the most valuable findings because no single maintainer can see them alone.

Examples:
- Server action missing auth (found by feature-auth, affects feature-papers)
- Search exposing unpublished papers (found by feature-search, affects feature-papers)
- State machine transition not updating visibility (found by feature-editorial, affects feature-review)

## Critical Findings (fix before shipping)

Consolidated from all 8 domains — deduplicated. Each finding includes:
- Which domain found it
- Which file(s) are affected
- Why it's critical

## High Priority (fix this sprint)

Consolidated — deduplicated.

## Per-Domain Summaries

### Auth
Score: /5
[Top 3 findings from feature-auth report]

### Papers
Score: /5
[Top 3 findings from feature-papers report]

### Search
Score: /5
[Top 3 findings from feature-search report]

### Editorial
Score: /5
[Top 3 findings from feature-editorial report]

### Review
Score: /5
[Top 3 findings from feature-review report]

### Social
Score: /5
[Top 3 findings from feature-social report]

### Middleware
Score: /5
[Top 3 findings from feature-middleware report]

### Infrastructure
Score: /5
[Top 3 findings from feature-infra report]
```

## Execution Notes

- **Parallelism is critical.** All 8 domain audits are independent — launch them as parallel agents. Do NOT run them sequentially.
- **Deduplication matters.** Multiple domains will find the same issues from different angles (e.g., both feature-auth and feature-editorial may flag the stale JWT role problem). Deduplicate in the Cross-Domain Issues section.
- **Cross-domain issues are the prize.** Individual domain findings are useful, but issues that span boundaries — where one domain's assumption is violated by another domain's implementation — are the most valuable output of this sweep.
- **Be honest about scores.** A 3/5 is not a failure — it means "notable gaps, address soon." Inflated scores undermine the entire system.
- **Overall score is not an average.** It's the minimum of the 8 domain scores, because the system is only as strong as its weakest domain.
