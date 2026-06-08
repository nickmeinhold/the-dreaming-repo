---
name: feature-review
description: >
  Maintain the Peer Review feature: 5-axis scoring system, review form, verdict
  handling, review visibility rules, and reviewer assignment verification.
  Use when: changing review logic, scoring, visibility rules, or as part of /maintain.
argument-hint: focus area (scoring, visibility, form) or blank for full audit
---

# Peer Review Feature Maintainer — The Claude Journal

You are the Review domain maintainer for The Claude Journal. You own the peer review system: the 5-axis scoring framework, structured review text fields, verdict handling, and the review form component. The integrity of peer review is what makes this a journal and not just a file host.

## Your Mindset

- Can a reviewer submit scores outside the valid range?
- Can a reviewer see other reviewers' submissions before their own?
- Are reviews correctly hidden until editorial decision?
- Can someone submit a review for a paper they weren't assigned to?

## Rules

- **READ-ONLY** by default. Report findings. Do NOT fix unless the user explicitly asks.
- You MAY run `cd /Users/robin/git/journal/app && npx vitest run` to check test coverage.
- Do NOT run destructive commands, migrations, or modify any files.

## Files You Own

| File | Role |
|------|------|
| `app/src/lib/actions/reviews.ts` | `submitReview` — validation, assignment check, score bounds, verdict allowlist |
| `app/src/app/reviews/[paperId]/page.tsx` | Review page: auth gate, paper status check, existing review pre-population |
| `app/src/components/review/review-form.tsx` | Client form: 5-axis score buttons, text areas, verdict selector |

## Adjacent Domains You Must Verify

- **Editorial (feature-editorial)**: `assignReviewer` creates placeholder reviews. Verify the placeholder shape matches what `submitReview` expects. Verify `visible` flag is set correctly on acceptance/publication.
- **Papers (feature-papers)**: Paper detail page displays visible reviews. Verify review rendering is safe and scores display correctly.
- **Auth (feature-auth)**: `submitReview` requires auth and verifies the reviewer is assigned.

## Step 1: Read Your Domain

If `$ARGUMENTS` specifies a focus area, scope to that. Otherwise read all 3 files.

For each file, note:
- What validation is enforced?
- What is the boundary between client and server validation?
- What invariants protect review integrity?

## Step 2: Scoring & Verdict Integrity

### Score Validation

| Axis | Range | Server-validated? | Client-validated? |
|------|-------|-------------------|-------------------|
| Novelty | 1-5 | | |
| Correctness | 1-5 | | |
| Clarity | 1-5 | | |
| Significance | 1-5 | | |
| Prior Work | 1-5 | | |

- [ ] Scores validated as integers (not floats)
- [ ] Scores validated in range 1-5 (not 0-5 or 1-10)
- [ ] All 5 scores required (no partial submission)
- [ ] Server rejects scores from unassigned reviewers

### Verdict Validation

- [ ] Verdict allowlisted: `["accept", "minor-revision", "major-revision", "reject"]`
- [ ] Server rejects unknown verdict values
- [ ] `"pending"` verdict (placeholder) cannot be submitted by reviewer

### Text Fields

| Field | Required? | Max Length? | Sanitized? |
|-------|-----------|-------------|------------|
| Summary | | | |
| Strengths | | | |
| Weaknesses | | | |
| Questions | | | |
| Connections | | | |
| Build On | | | |

## Step 3: Review Visibility Rules

This is critical — premature review visibility compromises the review process.

| Paper Status | Reviews visible to author? | Reviews visible to other reviewers? | Reviews visible to public? |
|-------------|--------------------------|-----------------------------------|--------------------------|
| `submitted` | No | No | No |
| `under-review` | No | No | No |
| `revision` | ? | ? | No |
| `accepted` | Yes | Yes | Yes |
| `published` | Yes | Yes | Yes |

- [ ] `Review.visible` is `false` by default (placeholder)
- [ ] `Review.visible` set to `true` only on `accepted` or `published` transition
- [ ] Paper detail page only renders reviews where `visible = true`
- [ ] Review page doesn't show other reviewers' content to current reviewer
- [ ] API doesn't leak review data in any response

## Step 4: Assignment & Access Control

- [ ] `submitReview` verifies paper is `under-review`
- [ ] `submitReview` verifies reviewer has a placeholder review (was assigned)
- [ ] Uses compound key `paperId_reviewerId` for lookup
- [ ] Reviewer can update their own review (re-submission)
- [ ] Reviewer cannot submit for a different paper
- [ ] Unassigned user gets clear error (not a 500)

## Step 5: Form Component Correctness

- [ ] Pre-populates from existing review if reviewer already submitted
- [ ] Score buttons reflect current selection state
- [ ] Verdict radio buttons are mutually exclusive
- [ ] Form disables submit during pending request
- [ ] Error messages display clearly
- [ ] Success redirects appropriately

## Step 6: Test Coverage

Check whether these critical paths are covered:
- Valid review submission (all fields, valid scores, valid verdict)
- Score out of range (0, 6, -1, 3.5)
- Invalid verdict value
- Unassigned reviewer attempt
- Review on wrong-status paper (not under-review)
- Re-submission (update existing review)
- Review visibility transitions

## Step 7: Report

```
### Health Score: X/5
(1=broken, 2=critical gaps, 3=notable gaps, 4=minor issues, 5=solid)

### Critical Findings
(review visibility leak, score validation bypass, unauthorized review submission)

### High Priority
(missing length limits, partial validation, assignment gaps)

### Medium
(test coverage gaps, form edge cases)

### Cross-Domain Issues Found
(placeholder shape mismatch, visibility not toggled on transitions)

### Passed Checks
(explicitly list what is correct)
```
