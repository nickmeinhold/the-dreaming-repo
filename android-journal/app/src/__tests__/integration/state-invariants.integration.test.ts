/**
 * State Invariants — Property-Based Integration Tests
 *
 * CATEGORY THEORY:
 *   The paper workflow is an algebra (A, α: A × W → A) where A is the
 *   set of database states and W is the monoid of valid operations.
 *   Each status defines an equivalence class: two histories that reach
 *   the same status should be observationally indistinguishable.
 *
 *   These tests verify that STATE INVARIANTS hold at every step of
 *   every valid path through the state machine — not just the happy
 *   path. This is the Myhill-Nerode criterion: the equivalence classes
 *   (statuses) have well-defined observable properties regardless of
 *   which path landed us there.
 *
 *   The generator produces random valid walks through the transition
 *   graph, including revision cycles of arbitrary depth. The invariant
 *   checker runs at every intermediate state, catching side effects
 *   that fire on one path but not another.
 */

import { describe, expect, beforeEach, vi, test } from "vitest";
import { test as fcTest, fc } from "@fast-check/vitest";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { transitionPaper } from "@/lib/paper-workflow";
import { cleanDatabase, createTestUser, createTestPaper } from "./helpers";

// ═══════════════════════════════════════════════════════════
//  AUDIT HELPERS
// ═══════════════════════════════════════════════════════════

async function countAuditEvents(entityId: string, action: string): Promise<number> {
  return prisma.auditLog.count({ where: { action, entityId } });
}

async function lastAuditEvent(entityId: string, action: string) {
  return prisma.auditLog.findFirst({
    where: { action, entityId },
    orderBy: { timestamp: "desc" },
  });
}

// ═══════════════════════════════════════════════════════════
//  STATE MACHINE DEFINITION
// ═══════════════════════════════════════════════════════════

const VALID_TRANSITIONS: Record<string, string[]> = {
  submitted: ["under-review"],
  "under-review": ["revision", "accepted"],
  revision: ["under-review"],
  accepted: ["published"],
  published: [],
};

const ALL_STATUSES = Object.keys(VALID_TRANSITIONS);

/**
 * Generate a random valid path through the state machine starting
 * from "submitted". The revision cycle (under-review ↔ revision)
 * can repeat up to maxRevisions times.
 *
 * Returns the sequence of transitions (target statuses), not states.
 * e.g. ["under-review", "revision", "under-review", "accepted", "published"]
 */
function arbValidPath(maxRevisions: number = 3): fc.Arbitrary<string[]> {
  return fc.integer({ min: 0, max: maxRevisions }).chain((revisionCycles) => {
    // Build the deterministic path with the chosen number of revision cycles
    const path: string[] = [];

    // submitted → under-review (only option)
    path.push("under-review");

    // revision cycles: under-review → revision → under-review (repeated)
    for (let i = 0; i < revisionCycles; i++) {
      path.push("revision");
      path.push("under-review");
    }

    // Choose whether to stop here, go to accepted, or go all the way
    return fc.integer({ min: 0, max: 2 }).map((endpoint) => {
      if (endpoint === 0) return path; // stop at under-review
      path.push("accepted");
      if (endpoint === 1) return path; // stop at accepted
      path.push("published");
      return path;
    });
  });
}

// ═══════════════════════════════════════════════════════════
//  INVARIANT DEFINITIONS
// ═══════════════════════════════════════════════════════════

interface PaperState {
  status: string;
  publishedAt: Date | null;
  reviews: { verdict: string; visible: boolean }[];
}

async function loadPaperState(paperId: string): Promise<PaperState> {
  const paper = await prisma.paper.findUniqueOrThrow({
    where: { paperId },
    select: {
      status: true,
      publishedAt: true,
      reviews: {
        select: { verdict: true, visible: true },
      },
    },
  });
  return paper;
}

/**
 * State invariants — properties that must hold at each status
 * regardless of which path brought us there.
 */
function checkInvariant(state: PaperState): string[] {
  const violations: string[] = [];
  const { status, publishedAt, reviews } = state;
  const completedReviews = reviews.filter((r) => r.verdict !== "pending");
  const pendingReviews = reviews.filter((r) => r.verdict === "pending");

  // ── publishedAt invariants ──────────────────────────────
  if (status === "published") {
    if (!publishedAt) {
      violations.push("published paper must have publishedAt set");
    }
  } else {
    if (publishedAt) {
      violations.push(`non-published paper (${status}) must not have publishedAt`);
    }
  }

  // ── Review visibility invariants ────────────────────────
  if (status === "accepted" || status === "published") {
    for (const r of completedReviews) {
      if (!r.visible) {
        violations.push(
          `completed review (${r.verdict}) must be visible when paper is ${status}`,
        );
      }
    }
  }

  if (status === "submitted" || status === "under-review" || status === "revision") {
    for (const r of completedReviews) {
      if (r.visible) {
        violations.push(
          `completed review (${r.verdict}) must NOT be visible when paper is ${status}`,
        );
      }
    }
  }

  // Pending reviews should never be visible regardless of state
  for (const r of pendingReviews) {
    if (r.visible) {
      violations.push("pending review must never be visible");
    }
  }

  return violations;
}

// ═══════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════

beforeEach(async () => {
  await cleanDatabase();
  vi.clearAllMocks();
});

describe("State Invariants — all valid paths", () => {
  fcTest.prop([arbValidPath(4)], { numRuns: 15 })(
    "invariants hold at every step of a random valid path",
    async (path) => {
      // Clean between fast-check iterations (beforeEach only runs once per test)
      await cleanDatabase();

      // Setup: author, reviewer, and a submitted paper
      const author = await createTestUser();
      const reviewer = await createTestUser();
      const paper = await createTestPaper(author.id);

      // Add a completed review (will become visible on acceptance)
      await prisma.review.create({
        data: {
          paperId: paper.id,
          reviewerId: reviewer.id,
          noveltyScore: 4,
          correctnessScore: 4,
          clarityScore: 4,
          significanceScore: 4,
          priorWorkScore: 4,
          summary: "Solid work",
          strengths: "Novel approach",
          weaknesses: "Minor gaps",
          questions: "",
          connections: "",
          verdict: "accept",
          visible: false,
        },
      });

      // Also add a pending review placeholder (should never become visible)
      const pendingReviewer = await createTestUser();
      await prisma.review.create({
        data: {
          paperId: paper.id,
          reviewerId: pendingReviewer.id,
          noveltyScore: 0,
          correctnessScore: 0,
          clarityScore: 0,
          significanceScore: 0,
          priorWorkScore: 0,
          summary: "",
          strengths: "",
          weaknesses: "",
          questions: "",
          connections: "",
          verdict: "pending",
          visible: false,
        },
      });

      // Check invariant at initial state
      let state = await loadPaperState(paper.paperId);
      let violations = checkInvariant(state);
      expect(violations, `initial state (submitted)`).toEqual([]);

      // Walk the path, checking invariants AND audit events at every step
      let prevStatus = "submitted";
      for (let i = 0; i < path.length; i++) {
        const target = path[i];
        const result = await transitionPaper(prisma, paper.paperId, target);
        expect(
          result.success,
          `step ${i}: transition to "${target}" failed: ${result.error}`,
        ).toBe(true);

        state = await loadPaperState(paper.paperId);
        violations = checkInvariant(state);
        expect(
          violations,
          `step ${i}: invariant violated at "${target}" (path: submitted → ${path.slice(0, i + 1).join(" → ")})`,
        ).toEqual([]);

        // ── Audit invariant: paper.transitioned must record from/to ──
        const lastTransition = await lastAuditEvent(paper.paperId, "paper.transitioned");
        expect(lastTransition, `step ${i}: paper.transitioned audit missing`).not.toBeNull();
        const tDetails = JSON.parse(lastTransition!.details!);
        expect(tDetails.from, `step ${i}: audit from`).toBe(prevStatus);
        expect(tDetails.to, `step ${i}: audit to`).toBe(target);

        // ── Audit invariant: reviews.revealed fires on acceptance ──
        if (target === "accepted") {
          const revealed = await lastAuditEvent(paper.paperId, "reviews.revealed");
          expect(revealed, "reviews.revealed must fire on acceptance").not.toBeNull();
          expect(JSON.parse(revealed!.details!).trigger).toBe("accepted");
        }

        prevStatus = target;
      }

      // ── Post-walk audit counts ──
      const transitionCount = await countAuditEvents(paper.paperId, "paper.transitioned");
      expect(transitionCount, "audit count must equal transition count").toBe(path.length);

      if (path[path.length - 1] === "published") {
        const publishedCount = await countAuditEvents(paper.paperId, "paper.published");
        expect(publishedCount, "paper.published must fire exactly once").toBe(1);
      }
    },
    60_000,
  );

  fcTest.prop([arbValidPath(3), fc.integer({ min: 0, max: ALL_STATUSES.length - 1 })], { numRuns: 20 })(
    "invalid transitions are rejected at every intermediate state",
    async (path, statusIdx) => {
      await cleanDatabase();

      const author = await createTestUser();
      const paper = await createTestPaper(author.id);

      // Walk to an intermediate state
      for (const target of path) {
        await transitionPaper(prisma, paper.paperId, target);
      }

      // Determine current status
      const currentStatus = path.length === 0 ? "submitted" : path[path.length - 1];
      const validNext = VALID_TRANSITIONS[currentStatus] ?? [];

      // Try a random status — if it's not in validNext, it should fail
      const attemptedStatus = ALL_STATUSES[statusIdx];
      if (!validNext.includes(attemptedStatus)) {
        const result = await transitionPaper(prisma, paper.paperId, attemptedStatus);
        expect(
          result.success,
          `"${currentStatus}" → "${attemptedStatus}" should be rejected`,
        ).toBe(false);

        // ── Audit invariant: transition.rejected must fire ──
        const rejected = await lastAuditEvent(paper.paperId, "transition.rejected");
        expect(rejected, "transition.rejected must fire for invalid transition").not.toBeNull();
        const rDetails = JSON.parse(rejected!.details!);
        expect(rDetails.attempted).toBe(attemptedStatus);
      }
    },
    60_000,
  );
});

describe("State Invariants — revision cycle accumulation", () => {
  fcTest.prop([fc.integer({ min: 1, max: 4 })], { numRuns: 10 })(
    "all reviews visible after acceptance regardless of revision count",
    async (revisionCycles) => {
      await cleanDatabase();

      const author = await createTestUser();
      const paper = await createTestPaper(author.id);
      const reviewers: number[] = [];

      // submitted → under-review
      await transitionPaper(prisma, paper.paperId, "under-review");

      // Each revision cycle adds a new reviewer with a completed review
      for (let round = 0; round < revisionCycles; round++) {
        const rev = await createTestUser();
        reviewers.push(rev.id);

        await prisma.review.create({
          data: {
            paperId: paper.id,
            reviewerId: rev.id,
            noveltyScore: 3,
            correctnessScore: 3,
            clarityScore: 3,
            significanceScore: 3,
            priorWorkScore: 3,
            summary: `Round ${round + 1} review`,
            strengths: "Good",
            weaknesses: "Needs work",
            questions: "",
            connections: "",
            verdict: round < revisionCycles - 1 ? "major-revision" : "accept",
            visible: false,
          },
        });

        // Cycle through revision unless this is the last round
        if (round < revisionCycles - 1) {
          await transitionPaper(prisma, paper.paperId, "revision");
          await transitionPaper(prisma, paper.paperId, "under-review");
        }
      }

      // Accept — all completed reviews from all rounds should become visible
      await transitionPaper(prisma, paper.paperId, "accepted");

      const state = await loadPaperState(paper.paperId);
      const visibleCompleted = state.reviews.filter(
        (r) => r.verdict !== "pending" && r.visible,
      );
      expect(visibleCompleted).toHaveLength(revisionCycles);

      // Full invariant check
      const violations = checkInvariant(state);
      expect(violations, "invariant violated after acceptance").toEqual([]);
    },
    60_000,
  );
});

describe("State Invariants — concurrent transitions", () => {
  test("concurrent transitions on same paper: exactly one succeeds", async () => {
    const author = await createTestUser();
    const paper = await createTestPaper(author.id);
    await transitionPaper(prisma, paper.paperId, "under-review");

    // Two concurrent attempts to transition from under-review
    const [result1, result2] = await Promise.all([
      transitionPaper(prisma, paper.paperId, "accepted"),
      transitionPaper(prisma, paper.paperId, "revision"),
    ]);

    // Exactly one should succeed, the other should fail gracefully
    const successes = [result1, result2].filter((r) => r.success);
    const failures = [result1, result2].filter((r) => !r.success);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // Invariants must hold regardless of which transition won
    const state = await loadPaperState(paper.paperId);
    const violations = checkInvariant(state);
    expect(violations, "invariant violated after concurrent transition").toEqual([]);
  });

  test("concurrent duplicate transitions: only one takes effect", async () => {
    const author = await createTestUser();
    const paper = await createTestPaper(author.id);
    await transitionPaper(prisma, paper.paperId, "under-review");

    // Both try the same transition
    const [result1, result2] = await Promise.all([
      transitionPaper(prisma, paper.paperId, "accepted"),
      transitionPaper(prisma, paper.paperId, "accepted"),
    ]);

    const successes = [result1, result2].filter((r) => r.success);
    expect(successes).toHaveLength(1);

    // Paper should be accepted exactly once, not in some half-state
    const state = await loadPaperState(paper.paperId);
    expect(state.status).toBe("accepted");
    const violations = checkInvariant(state);
    expect(violations).toEqual([]);
  });
});
