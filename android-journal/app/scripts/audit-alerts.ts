/**
 * Audit Alert Scanner
 *
 * Cron job that checks for suspicious patterns and stale items.
 * Emails the admin when thresholds are breached.
 *
 * Designed to run every 6 hours:
 *   crontab: 0 0,6,12,18 * * * — cd /path/to/journal/app && npx tsx scripts/audit-alerts.ts
 *
 * Configuration (environment variables):
 *   ALERT_EMAIL        — recipient address (required, or script exits silently)
 *   RESEND_API_KEY     — Resend API key (optional — stub mode without it)
 *   EMAIL_FROM         — sender address (default: noreply@claude-journal.dev)
 *   ALERT_WINDOW_HOURS — how far back to scan (default: 6, should match cron interval)
 *   DATABASE_URL       — PostgreSQL connection string (required)
 */

import pg from "pg";

const DB_URL = process.env.DATABASE_URL || "postgresql://journal:journal_dev@localhost:5432/claude_journal";
const ALERT_EMAIL = process.env.ALERT_EMAIL;
const WINDOW_HOURS = parseInt(process.env.ALERT_WINDOW_HOURS || "6", 10);

interface Alert {
  rule: string;
  severity: "HIGH" | "MEDIUM" | "INFO";
  message: string;
}

async function scan(pool: pg.Pool): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000);
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);

  // ── Rules 3-5: Query AuditLog ──────────────────────────

  const { rows: recentEvents } = await pool.query(
    `SELECT action, entity, "entityId", details, "userId", timestamp
     FROM "AuditLog" WHERE timestamp >= $1 ORDER BY timestamp DESC`,
    [since],
  );

  // Rule 3: Access denied — any occurrence is suspicious
  for (const event of recentEvents.filter((e: any) => e.action === "access.denied")) {
    alerts.push({
      rule: "Access denied",
      severity: "HIGH",
      message: `User #${event.userId ?? "unknown"}: ${event.details ?? "no details"} at ${event.timestamp.toISOString()}`,
    });
  }

  // Rule 4: System errors — 3+ in the window
  const systemErrors = recentEvents.filter((e: any) => e.action === "system.error");
  if (systemErrors.length >= 3) {
    alerts.push({
      rule: "System errors",
      severity: "HIGH",
      message: `${systemErrors.length} unhandled errors in the last ${WINDOW_HOURS} hours`,
    });
  }

  // Rule 5: Publication — positive notification
  for (const event of recentEvents.filter((e: any) => e.action === "paper.transitioned")) {
    try {
      const details = event.details ? JSON.parse(event.details) : {};
      if (details.to === "published") {
        alerts.push({
          rule: "Paper published",
          severity: "INFO",
          message: `Paper ${event.entityId} was published`,
        });
      }
    } catch { /* ignore parse errors */ }
  }

  // ── Rules 1-2: Query domain tables ─────────────────────

  // Rule 1: Stale submissions — in "submitted" status for >3 days
  const { rows: staleSubmissions } = await pool.query(
    `SELECT "paperId", title, "submittedAt" FROM "Paper"
     WHERE status = 'submitted' AND "submittedAt" < $1`,
    [threeDaysAgo],
  );
  for (const paper of staleSubmissions) {
    alerts.push({
      rule: "Stale submission",
      severity: "MEDIUM",
      message: `${paper.paperId} "${paper.title}" submitted ${paper.submittedAt.toISOString().split("T")[0]}, still in submitted status`,
    });
  }

  // Rule 2: Stale reviews — assigned >7 days ago, all scores still zero
  const { rows: staleReviews } = await pool.query(
    `SELECT r."createdAt", p."paperId", u."githubLogin"
     FROM "Review" r
     JOIN "Paper" p ON r."paperId" = p.id
     JOIN "User" u ON r."reviewerId" = u.id
     WHERE r."createdAt" < $1
       AND r."noveltyScore" = 0
       AND r."correctnessScore" = 0
       AND r."clarityScore" = 0
       AND r."significanceScore" = 0
       AND r."priorWorkScore" = 0`,
    [sevenDaysAgo],
  );
  for (const review of staleReviews) {
    alerts.push({
      rule: "Stale review",
      severity: "MEDIUM",
      message: `${review.githubLogin} assigned to ${review.paperId} on ${review.createdAt.toISOString().split("T")[0]}, all scores still zero`,
    });
  }

  return alerts;
}

async function sendEmail(alerts: Alert[]): Promise<void> {
  if (!ALERT_EMAIL) return;

  const hasHigh = alerts.some((a) => a.severity === "HIGH");
  const subject = hasHigh
    ? `[ALERT] Claude Journal — ${alerts.length} alert(s)`
    : `[NOTICE] Claude Journal — ${alerts.length} alert(s)`;

  const cards = alerts
    .map((a) => {
      const color = a.severity === "HIGH" ? "#dc2626" : a.severity === "MEDIUM" ? "#f59e0b" : "#3b82f6";
      return `<div style="border-left:4px solid ${color};padding:8px 12px;margin:8px 0;background:#f9fafb;">
        <strong>[${a.severity}]</strong> ${a.rule}<br/>
        <span style="color:#6b7280;">${a.message}</span>
      </div>`;
    })
    .join("");

  const html = `<h2>Claude Journal Alerts</h2><p>Scan window: last ${WINDOW_HOURS} hours</p>${cards}`;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`\n--- ALERT EMAIL (stub mode — set RESEND_API_KEY to send) ---`);
    console.log(`To: ${ALERT_EMAIL}`);
    console.log(`Subject: ${subject}`);
    for (const a of alerts) {
      console.log(`  [${a.severity}] ${a.rule}: ${a.message}`);
    }
    console.log(`---\n`);
    return;
  }

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  const from = process.env.EMAIL_FROM || "The Claude Journal <noreply@claude-journal.dev>";
  await resend.emails.send({ from, to: ALERT_EMAIL, subject, html });
  console.log(`Alert email sent to ${ALERT_EMAIL} (${alerts.length} alerts)`);
}

async function main() {
  if (!ALERT_EMAIL) {
    console.warn("ALERT_EMAIL not set — audit alerting disabled");
    process.exit(0);
  }

  const pool = new pg.Pool({ connectionString: DB_URL });
  try {
    const alerts = await scan(pool);
    if (alerts.length === 0) {
      console.log("No alerts — all clear.");
      process.exit(0);
    }
    await sendEmail(alerts);
  } catch (err) {
    console.error("Audit alert scanner failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
