/**
 * Editorial Daemon — Tick Logic (Plan 3)
 *
 * The Paper status field IS the queue. Each tick:
 *   - submitted     → transition to under-review + assign N referees
 *   - under-review  → when all verdicts are in, apply the decision rule
 *
 * Decision rule (deliberately conservative): the daemon auto-decides
 * only unambiguous cases — unanimous accept → accepted, unanimous
 * reject → revision. Mixed verdicts are *flagged* for an editor, not
 * decided: peer review's value is judgment, not vote-counting.
 *
 * Idempotent by construction: state is re-read every tick, and
 * transitionPaper's optimistic lock rejects races. Papers tagged
 * `manual-review` are never touched.
 */

import { prisma } from "@/lib/db";
import { transitionPaper } from "@/lib/paper-workflow";
import { logAuditEvent } from "@/lib/audit";

export const MANUAL_REVIEW_TAG = "manual-review";

export interface DaemonConfig {
  refereePool: string[]; // githubLogins of candidate referees
  refereesPerPaper: number;
}

export interface TickAction {
  paperId: string;
  action: string;
  detail?: string;
}

// ── Decision rule (pure) ──────────────────────────────────

export type Decision = "accepted" | "revision" | "flag" | "wait";

export function decideVerdicts(
  verdicts: string[],
  required: number,
): Decision {
  const decided = verdicts.filter((v) => v !== "pending");
  if (decided.length < required) return "wait";

  if (decided.every((v) => v === "accept")) return "accepted";
  if (decided.every((v) => v === "reject")) return "revision";
  // Mixed (incl. minor/major-revision verdicts): editor judgment required
  return "flag";
}

// ── Referee selection (pure) ──────────────────────────────

/**
 * Pool members who are not authors of the paper, shuffled for fairness.
 */
export function selectReferees(
  pool: string[],
  authorLogins: string[],
  count: number,
): string[] {
  const authors = new Set(authorLogins);
  const eligible = pool.filter((login) => !authors.has(login));
  // Fisher–Yates shuffle
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  return eligible.slice(0, count);
}

// ── Tick: submitted → under-review + assignments ──────────

export async function tickSubmitted(config: DaemonConfig): Promise<TickAction[]> {
  const actions: TickAction[] = [];

  const papers = await prisma.paper.findMany({
    where: {
      status: "submitted",
      tags: { none: { tag: { slug: MANUAL_REVIEW_TAG } } },
    },
    select: {
      id: true,
      paperId: true,
      authors: { select: { user: { select: { githubLogin: true } } } },
    },
  });

  for (const paper of papers) {
    const authorLogins = paper.authors.map((a) => a.user.githubLogin);
    const refereeLogins = selectReferees(
      config.refereePool,
      authorLogins,
      config.refereesPerPaper,
    );

    if (refereeLogins.length < config.refereesPerPaper) {
      await logAuditEvent({
        action: "editorial.daemon.skipped",
        entity: "paper",
        entityId: paper.paperId,
        details: JSON.stringify({
          reason: "insufficient eligible referees",
          eligible: refereeLogins.length,
          required: config.refereesPerPaper,
        }),
      });
      actions.push({
        paperId: paper.paperId,
        action: "skipped",
        detail: "insufficient eligible referees",
      });
      continue;
    }

    const referees = await prisma.user.findMany({
      where: { githubLogin: { in: refereeLogins } },
      select: { id: true, githubLogin: true },
    });
    if (referees.length < config.refereesPerPaper) {
      await logAuditEvent({
        action: "editorial.daemon.skipped",
        entity: "paper",
        entityId: paper.paperId,
        details: JSON.stringify({
          reason: "referee accounts missing",
          found: referees.map((r) => r.githubLogin),
          wanted: refereeLogins,
        }),
      });
      actions.push({
        paperId: paper.paperId,
        action: "skipped",
        detail: "referee accounts missing",
      });
      continue;
    }

    const result = await transitionPaper(prisma, paper.paperId, "under-review");
    if (!result.success) {
      actions.push({
        paperId: paper.paperId,
        action: "transition-failed",
        detail: result.error,
      });
      continue;
    }

    for (const referee of referees) {
      await prisma.review.create({
        data: {
          paperId: paper.id,
          reviewerId: referee.id,
          noveltyScore: 0, correctnessScore: 0, clarityScore: 0,
          significanceScore: 0, priorWorkScore: 0,
          summary: "", strengths: "", weaknesses: "",
          questions: "", connections: "",
          verdict: "pending",
        },
      });
      await logAuditEvent({
        action: "review.assigned",
        entity: "review",
        entityId: paper.paperId,
        details: JSON.stringify({ reviewer: referee.githubLogin, assignedBy: "daemon" }),
      });
    }

    actions.push({
      paperId: paper.paperId,
      action: "under-review",
      detail: `assigned ${referees.map((r) => r.githubLogin).join(", ")}`,
    });
  }

  return actions;
}

// ── Tick: under-review → decision ─────────────────────────

export async function tickUnderReview(config: DaemonConfig): Promise<TickAction[]> {
  const actions: TickAction[] = [];

  const papers = await prisma.paper.findMany({
    where: {
      status: "under-review",
      tags: { none: { tag: { slug: MANUAL_REVIEW_TAG } } },
    },
    select: {
      paperId: true,
      reviews: { select: { verdict: true } },
    },
  });

  for (const paper of papers) {
    const verdicts = paper.reviews.map((r) => r.verdict);
    const decision = decideVerdicts(verdicts, config.refereesPerPaper);

    if (decision === "wait") continue;

    if (decision === "flag") {
      // Flag exactly once per paper — the editor reads the reviews and decides
      const alreadyFlagged = await prisma.auditLog.findFirst({
        where: { action: "editorial.decision.flagged", entityId: paper.paperId },
      });
      if (!alreadyFlagged) {
        await logAuditEvent({
          action: "editorial.decision.flagged",
          entity: "paper",
          entityId: paper.paperId,
          details: JSON.stringify({ verdicts, reason: "mixed verdicts — editor judgment required" }),
        });
        actions.push({ paperId: paper.paperId, action: "flagged", detail: verdicts.join(", ") });
      }
      continue;
    }

    const result = await transitionPaper(prisma, paper.paperId, decision);
    if (result.success) {
      await logAuditEvent({
        action: "editorial.decision.auto",
        entity: "paper",
        entityId: paper.paperId,
        details: JSON.stringify({ verdicts, decision, decidedBy: "daemon" }),
      });
    }
    actions.push({
      paperId: paper.paperId,
      action: result.success ? decision : "transition-failed",
      detail: result.success ? verdicts.join(", ") : result.error,
    });
  }

  return actions;
}

// ── Full tick ─────────────────────────────────────────────

export async function runDaemonTick(config: DaemonConfig): Promise<TickAction[]> {
  const submitted = await tickSubmitted(config);
  const underReview = await tickUnderReview(config);
  return [...submitted, ...underReview];
}
