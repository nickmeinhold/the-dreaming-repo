/**
 * Decision Email Subscriber (Plan 4)
 *
 * Self-registering EventBus subscriber: on `paper.decision`, look up the
 * paper's authors who have an email and notifications enabled, send each
 * the decision plus the (now-public) reviews, and audit-log every
 * send/failure/skip. Imported for its side effect by paper-workflow.ts,
 * so it is wired in every process that can produce a decision — the web
 * app and the editorial daemon alike.
 *
 * Email failure never touches the editorial critical path: the EventBus
 * isolates handler errors, and sendDecisionEmail never throws.
 */

import { prisma } from "@/lib/db";
import { eventBus } from "@/lib/events/bus";
import { sendDecisionEmail } from "@/lib/email";
import { logAuditEvent } from "@/lib/audit";

let registered = false;

export function registerDecisionEmailSubscriber(): void {
  if (registered) return; // idempotent across re-imports / hot reloads
  registered = true;

  eventBus.on("paper.decision", async ({ paperId, decision }) => {
    const paper = await prisma.paper.findUnique({
      where: { paperId },
      select: {
        title: true,
        authors: {
          select: {
            user: {
              select: {
                githubLogin: true,
                email: true,
                emailNotifications: true,
              },
            },
          },
        },
        reviews: {
          where: { verdict: { not: "pending" } },
          select: {
            verdict: true,
            noveltyScore: true,
            correctnessScore: true,
            clarityScore: true,
            significanceScore: true,
            priorWorkScore: true,
            summary: true,
            strengths: true,
            weaknesses: true,
          },
        },
      },
    });
    if (!paper) return;

    for (const { user } of paper.authors) {
      if (!user.email || !user.emailNotifications) {
        await logAuditEvent({
          action: "email.skipped",
          entity: "paper",
          entityId: paperId,
          details: JSON.stringify({
            author: user.githubLogin,
            reason: user.email ? "notifications disabled" : "no email on file",
          }),
        });
        continue;
      }

      const outcome = await sendDecisionEmail({
        to: user.email,
        paperId,
        title: paper.title,
        decision,
        reviews: paper.reviews,
      });

      await logAuditEvent({
        action: outcome === "failed" ? "email.failed" : "email.sent",
        entity: "paper",
        entityId: paperId,
        details: JSON.stringify({
          author: user.githubLogin,
          decision,
          mode: outcome,
        }),
      });
    }
  });
}

registerDecisionEmailSubscriber();
