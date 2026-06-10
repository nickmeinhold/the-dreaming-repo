/**
 * Email Service — Resend Provider
 *
 * Sends alert and digest emails via Resend when RESEND_API_KEY is configured.
 * Falls back to a console stub when no key is set.
 *
 * Fire-and-forget safe — catches errors internally, never throws.
 * Email failure must never block journal operations.
 *
 * DORMANT INFRASTRUCTURE — intentionally not wired to the EventBus yet.
 * When notification features are needed, subscribe to EventBus events:
 *   eventBus.on("review.completed", (e) => sendAlertEmail(...))
 *
 * @see lib/events/bus.ts — V2 comment references this module
 * @see lib/events/types.ts — for available EventMap event types
 */

import { logger } from "@/lib/logger";

// ── Shared Resend client ────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let resendClient: any = null;

async function getResend() {
  if (resendClient) return resendClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  const { Resend } = await import("resend");
  resendClient = new Resend(apiKey);
  return resendClient;
}

function getFrom(): string {
  return process.env.EMAIL_FROM || "The Claude Journal <noreply@claude-journal.dev>";
}

/** Strip CR/LF to prevent SMTP header injection in email subject lines. */
function sanitiseSubject(str: string): string {
  return str.replace(/[\r\n]/g, "");
}

// ── Alert Email ─────────────────────────────────────────

export interface AlertItem {
  rule: string;
  severity: "HIGH" | "MEDIUM" | "INFO";
  message: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  HIGH: "#dc2626",
  MEDIUM: "#f59e0b",
  INFO: "#3b82f6",
};

export async function sendAlertEmail(alerts: AlertItem[]): Promise<void> {
  const to = process.env.ALERT_EMAIL;
  if (!to) {
    logger.warn("ALERT_EMAIL not set — skipping alert email");
    return;
  }

  const hasHigh = alerts.some((a) => a.severity === "HIGH");
  const subject = sanitiseSubject(
    `${hasHigh ? "[ALERT]" : "[NOTICE]"} Claude Journal — ${alerts.length} alert(s)`,
  );

  const cards = alerts
    .map(
      (a) =>
        `<div style="border-left:4px solid ${SEVERITY_COLOR[a.severity]};padding:8px 12px;margin:8px 0;background:#f9fafb;">
          <strong>[${a.severity}]</strong> ${a.rule}<br/>
          <span style="color:#6b7280;">${a.message}</span>
        </div>`,
    )
    .join("");

  const html = `<h2>Claude Journal Alerts</h2>${cards}`;

  try {
    const resend = await getResend();
    if (!resend) {
      logger.info({ subject, alertCount: alerts.length }, "Alert email (stub mode — no RESEND_API_KEY)");
      console.log(`[EMAIL STUB] ${subject}\n${alerts.map((a) => `  [${a.severity}] ${a.rule}: ${a.message}`).join("\n")}`);
      return;
    }
    await resend.emails.send({ from: getFrom(), to, subject, html });
    logger.info({ to, alertCount: alerts.length }, "Alert email sent");
  } catch (err) {
    logger.error({ err, subject }, "Failed to send alert email");
  }
}

// ── Decision Email (Plan 4) ─────────────────────────────

export interface DecisionReview {
  verdict: string;
  noveltyScore: number;
  correctnessScore: number;
  clarityScore: number;
  significanceScore: number;
  priorWorkScore: number;
  summary: string;
  strengths: string;
  weaknesses: string;
}

export interface DecisionEmailInput {
  to: string;
  paperId: string;
  title: string;
  decision: string; // "accepted" | "revision"
  reviews: DecisionReview[];
}

/** HTML-escape user-supplied text before interpolation. */
function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type EmailOutcome = "sent" | "stubbed" | "failed";

/**
 * Notify an author of an editorial decision, with the full reviews
 * (they become public on decision anyway). Never throws — returns an
 * outcome so the caller can audit-log sent/failed.
 */
export async function sendDecisionEmail(input: DecisionEmailInput): Promise<EmailOutcome> {
  const subject = sanitiseSubject(
    `[The Claude Journal] Decision on ${input.paperId}: ${input.decision}`,
  );

  const reviewCards = input.reviews
    .map(
      (r, i) =>
        `<div style="border:1px solid #e5e7eb;border-radius:6px;padding:12px;margin:12px 0;">
          <strong>Review ${i + 1} — verdict: ${esc(r.verdict)}</strong><br/>
          <span style="color:#6b7280;font-size:13px;">
            novelty ${r.noveltyScore}/5 · correctness ${r.correctnessScore}/5 ·
            clarity ${r.clarityScore}/5 · significance ${r.significanceScore}/5 ·
            prior work ${r.priorWorkScore}/5
          </span>
          <p><strong>Summary:</strong> ${esc(r.summary)}</p>
          <p><strong>Strengths:</strong> ${esc(r.strengths)}</p>
          <p><strong>Weaknesses:</strong> ${esc(r.weaknesses)}</p>
        </div>`,
    )
    .join("");

  const html = `
    <h2>Editorial decision: ${esc(input.decision)}</h2>
    <p><strong>${esc(input.title)}</strong> (${esc(input.paperId)})</p>
    ${reviewCards}
    <p style="color:#6b7280;font-size:12px;">
      You receive these because you authored this paper.
    </p>
  `;

  try {
    const resend = await getResend();
    if (!resend) {
      logger.info(
        { to: input.to, paperId: input.paperId, decision: input.decision, subject },
        "Decision email (stub mode — no RESEND_API_KEY)",
      );
      console.log(`[EMAIL STUB] to=${input.to} ${subject}`);
      return "stubbed";
    }
    await resend.emails.send({ from: getFrom(), to: input.to, subject, html });
    logger.info({ to: input.to, paperId: input.paperId }, "Decision email sent");
    return "sent";
  } catch (err) {
    logger.error({ err, subject }, "Failed to send decision email");
    return "failed";
  }
}

// ── Weekly Digest ───────────────────────────────────────

export interface DigestData {
  submissions: number;
  publications: number;
  reviewsCompleted: number;
  staleSubmissions: number;
  staleReviews: number;
  errors: number;
  downloads: number;
}

export async function sendWeeklyDigest(data: DigestData): Promise<void> {
  const to = process.env.ALERT_EMAIL;
  if (!to) {
    logger.warn("ALERT_EMAIL not set — skipping weekly digest");
    return;
  }

  const hasIssues = data.staleSubmissions > 0 || data.staleReviews > 0 || data.errors > 0;
  const subject = sanitiseSubject(
    `${hasIssues ? "[ATTENTION]" : ""} Claude Journal Weekly Digest`.trim(),
  );

  const rows = [
    ["Papers submitted", data.submissions],
    ["Papers published", data.publications],
    ["Reviews completed", data.reviewsCompleted],
    ["Downloads", data.downloads],
    ["Stale submissions", data.staleSubmissions],
    ["Stale reviews", data.staleReviews],
    ["System errors", data.errors],
  ];

  const tableRows = rows
    .map(
      ([label, count]) =>
        `<tr><td style="padding:4px 12px;">${label}</td><td style="padding:4px 12px;text-align:right;font-weight:bold;">${count}</td></tr>`,
    )
    .join("");

  const html = `
    <h2>Claude Journal — Weekly Digest</h2>
    <table style="border-collapse:collapse;border:1px solid #e5e7eb;">
      <tbody>${tableRows}</tbody>
    </table>
    <p style="color:#6b7280;font-size:12px;">Sent every Monday at 8am. No news is reassurance.</p>
  `;

  try {
    const resend = await getResend();
    if (!resend) {
      logger.info({ subject, ...data }, "Weekly digest (stub mode — no RESEND_API_KEY)");
      console.log(`[EMAIL STUB] ${subject}`);
      for (const [label, count] of rows) {
        console.log(`  ${label}: ${count}`);
      }
      return;
    }
    await resend.emails.send({ from: getFrom(), to, subject, html });
    logger.info({ to }, "Weekly digest sent");
  } catch (err) {
    logger.error({ err, subject }, "Failed to send weekly digest");
  }
}
