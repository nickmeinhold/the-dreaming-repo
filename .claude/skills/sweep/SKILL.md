---
name: sweep
description: >
  Two-phase comprehensive codebase audit. Sweep 1: security, production-readiness, dependencies,
  API contracts → test health → architecture review. Sweep 2: edge cases, tech debt, style,
  naming → test health → architecture review. Use when: before shipping, after major features,
  or for periodic deep review. Run with `1` or `2` for a single sweep, or no args for both.
---

# Sweep — Comprehensive Codebase Audit

You are orchestrating a two-phase deep audit of The Claude Journal codebase. Each sweep runs specialised audits in parallel, feeds the findings into a test health assessment, and culminates in an architecture review that synthesises everything.

## Arguments

- No arguments: run both sweeps **in parallel**, then combine final reports
- `1`: run sweep 1 only (infrastructure & contracts)
- `2`: run sweep 2 only (code quality & correctness)

## Sweep 1 — Infrastructure & Contracts

**Theme**: Can we ship this? Is it secure, reliable, and contractually sound?

### Phase 1A: Parallel Audits

Launch **four agents in parallel**, each running one audit skill. Each agent must be briefed with the full context of what it's auditing and instructed to produce a structured report.

1. **Security Audit** (`/security-audit`)
   Focus: OWASP Top 10, auth bypass, injection via tsvector search, path traversal, access control gaps, data exposure of unpublished papers/reviews.

2. **Production Readiness** (`/production-ready`)
   Focus: Observability, reliability, data integrity, performance, concurrency, deployment safety.

3. **Dependency Audit** (`/dependency-audit`)
   Focus: Vulnerabilities, outdated packages, bloat, lock file health, supply chain risk.

4. **API Contract Audit** (`/api-contract-audit`)
   Focus: Response consistency, backward compatibility, idempotency, schema evolution, error contracts.

**Wait for all four to complete.** Collect their reports.

### Phase 1B: Test Health Assessment

Run `/test-health-audit` with the following additional context:

> The following audits have been completed. Use their findings to assess whether the test suite covers the gaps they identified:
>
> - Security audit findings: [summary of critical/high findings from 1A]
> - Production readiness findings: [summary of critical/high findings from 1A]
> - Dependency findings: [summary of findings from 1A]
> - API contract findings: [summary of findings from 1A]
>
> Pay special attention to: Are the security-critical paths tested? Are the production-readiness gaps covered by tests? Are API contracts enforced by contract tests?

### Phase 1C: Architecture Review

Run `/architect` with the following context:

> Synthesise the findings from these completed audits into an architecture assessment:
>
> - Security audit: [key findings]
> - Production readiness: [key findings]
> - Dependency audit: [key findings]
> - API contract audit: [key findings]
> - Test health: [key findings]
>
> Focus on:
> 1. **Structural security**: Are the security gaps architectural (wrong abstraction) or incidental (missing check)?
> 2. **Operational architecture**: Does the system's structure support observability, reliability, and deployment safety?
> 3. **Contract architecture**: Are API boundaries clean? Is the response contract enforced by the type system or just by convention?
> 4. **Test architecture**: Does the test structure match the system structure? Are the right things tested at the right level?
>
> Produce a prioritised remediation plan that addresses architectural root causes, not just symptoms.

### Sweep 1 Deliverable

A single consolidated report:

```
# Sweep 1 — Infrastructure & Contracts

## Executive Summary
One paragraph: ship or no-ship assessment.

## Scorecard

| Audit | Overall | Critical Gaps |
|-------|---------|---------------|
| Security | /5 | ... |
| Production Readiness | /5 | ... |
| Dependencies | /5 | ... |
| API Contracts | /5 | ... |
| Test Coverage (of above) | /5 | ... |

## Architecture Assessment
[From /architect — structural root causes and remediation plan]

## Critical Findings (block shipping)
[Consolidated from all audits — deduplicated]

## High Priority (fix in first sprint)
[Consolidated]

## Remediation Plan
[From /architect — prioritised, grouped by effort]
```

---

## Sweep 2 — Code Quality & Correctness

**Theme**: Is the code correct, clean, and maintainable?

### Phase 2A: Parallel Audits

Launch **four agents in parallel**:

1. **Edge Case Audit** (`/edge-case-audit`)
   Focus: Input validation, paper ID/workflow edge cases, concurrency, data integrity, memory/performance, search/discovery, access control boundaries, external integration failures.

2. **Tech Debt Audit** (`/tech-debt-audit`)
   Focus: Dead code, accidental complexity (especially: are the category-theory patterns earning their keep?), cargo culting, dependency health, TODO/FIXME archaeology, duplication.

3. **Style Review** (`/style-review`)
   Focus: Clarity, obviousness, module depth, repetition, information leaks, coding style.

4. **Naming Audit** (`/naming-audit`)
   Focus: Domain language consistency, mathematical structure name accuracy, function/variable names, file names, error messages.

**Wait for all four to complete.** Collect their reports.

### Phase 2B: Test Health Assessment

Run `/test-health-audit` with the following additional context:

> The following audits have been completed. Use their findings to assess test coverage:
>
> - Edge case findings: [summary — are these edge cases tested?]
> - Tech debt findings: [summary — are the abstractions tested for their claimed properties?]
> - Style findings: [summary — do tests follow the same style standards?]
> - Naming findings: [summary — do test names match the naming conventions?]
>
> Pay special attention to: Do the mathematical law tests (monad, functor, applicative, etc.) actually verify the laws? Are edge cases covered? Is test code subject to the same quality bar as production code?

### Phase 2C: Architecture Review

Run `/architect` with the following context:

> Synthesise the findings from these completed audits into an architecture assessment:
>
> - Edge case audit: [key findings]
> - Tech debt audit: [key findings]
> - Style review: [key findings]
> - Naming audit: [key findings]
> - Test health: [key findings]
>
> Focus on:
> 1. **Abstraction fitness**: Are the category-theory patterns (Result monad, validation applicative, command monoid, event functor, middleware composition) the right abstractions for this system? Where do they help? Where do they hinder?
> 2. **Correctness architecture**: Are the edge cases found symptomatic of a structural problem (missing invariant enforcement) or incidental (missing check)?
> 3. **Naming as architecture**: Do the names reveal or obscure the system's structure? Is the mathematical vocabulary helping contributors or creating a barrier?
> 4. **Maintainability trajectory**: Is this codebase getting easier or harder to change over time?
>
> Produce a prioritised remediation plan focused on structural improvements.

### Sweep 2 Deliverable

```
# Sweep 2 — Code Quality & Correctness

## Executive Summary
One paragraph: quality assessment and trajectory.

## Scorecard

| Audit | Overall | Key Finding |
|-------|---------|-------------|
| Edge Cases | /5 | ... |
| Tech Debt | /5 | ... |
| Style | /5 | ... |
| Naming | /5 | ... |
| Test Coverage (of above) | /5 | ... |

## Architecture Assessment
[From /architect — abstraction fitness, correctness architecture, naming as architecture]

## Category Theory Patterns — Verdict
[Specific assessment: which patterns earn their keep, which are ceremony]

## Critical Findings
[Consolidated — deduplicated]

## Remediation Plan
[Prioritised, grouped by effort]
```

---

## Running Both Sweeps (default)

When no argument is given, launch **sweep 1 and sweep 2 as two parallel agents**. Each agent runs its own three-phase pipeline (4 parallel audits → test health → architect) independently. When both agents return their final reports, combine them into a single executive summary:

```
# Full Sweep — The Claude Journal

## Ship Readiness: [READY / READY WITH CAVEATS / NOT READY]

## Combined Scorecard

| Dimension | Score | Source |
|-----------|-------|--------|
| Security | /5 | Sweep 1 |
| Production Readiness | /5 | Sweep 1 |
| Dependencies | /5 | Sweep 1 |
| API Contracts | /5 | Sweep 1 |
| Edge Cases | /5 | Sweep 2 |
| Tech Debt | /5 | Sweep 2 |
| Style | /5 | Sweep 2 |
| Naming | /5 | Sweep 2 |
| Test Health | /5 | Both |
| Architecture | /5 | Both |

## Top 5 Actions (highest impact, cross-cutting)
1. ...
2. ...
3. ...
4. ...
5. ...

## Detailed Reports
[Link to Sweep 1 and Sweep 2 sections above]
```

## Execution Notes

- **Parallelism is critical.** The four audits in each phase are independent — launch them as parallel agents. Do NOT run them sequentially.
- **Synthesis is the value.** Individual audit reports are useful, but the architecture review that connects findings across audits is where the real insight lives.
- **Deduplication matters.** Multiple audits will find the same issues (e.g., both security and edge-case audits will flag search injection). Deduplicate in the consolidated report.
- **Be honest about scores.** A 3/5 is not a failure — it means "notable gaps, address soon." Inflated scores undermine trust.
