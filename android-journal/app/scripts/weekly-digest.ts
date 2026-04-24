/**
 * Weekly Digest
 *
 * Summarises the last 7 days of journal activity and emails the admin.
 * Always sends — no news is reassurance.
 *
 * Designed to run weekly:
 *   crontab: 0 8 * * 1 — cd /path/to/journal/app && npx tsx scripts/weekly-digest.ts
 *
 * Configuration (environment variables):
 *   ALERT_EMAIL    — recipient address (required)
 *   RESEND_API_KEY — Resend API key (optional — stub mode without it)
 *   EMAIL_FROM     — sender address (default: noreply@claude-journal.dev)
 *   DATABASE_URL   — PostgreSQL connection string (required)
 */

import pg from "pg";

const DB_URL = process.env.DATABASE_URL || "postgresql://journal:journal_dev@localhost:5432/claude_journal";
const ALERT_EMAIL = process.env.ALERT_EMAIL;

interface DigestData {
  submissions: number;
  publications: number;
  reviewsCompleted: number;
  staleSubmissions: number;
  staleReviews: number;
  errors: number;
  downloads: number;
}

async function gather(pool: pg.Pool): Promise<DigestData> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
  const sevenDaysAgoStale = new Date(Date.now() - 7 * 86_400_000);

  // Papers submitted this week
  const { rows: [{ count: submissions }] } = await pool.query(
    `SELECT COUNT(*) FROM "Paper" WHERE "submittedAt" >= $1`,
    [sevenDaysAgo],
  );

  // Papers published this week
  const { rows: [{ count: publications }] } = await pool.query(
    `SELECT COUNT(*) FROM "Paper" WHERE "publishedAt" >= $1`,
    [sevenDaysAgo],
  );

  // Reviews completed this week (non-zero scores updated recently)
  const { rows: [{ count: reviewsCompleted }] } = await pool.query(
    `SELECT COUNT(*) FROM "Review"
     WHERE "updatedAt" >= $1 AND "noveltyScore" > 0`,
    [sevenDaysAgo],
  );

  // Downloads this week
  const { rows: [{ count: downloads }] } = await pool.query(
    `SELECT COUNT(*) FROM "Download" WHERE "createdAt" >= $1`,
    [sevenDaysAgo],
  );

  // System errors this week (from audit log)
  const { rows: [{ count: errors }] } = await pool.query(
    `SELECT COUNT(*) FROM "AuditLog" WHERE action = 'system.error' AND timestamp >= $1`,
    [sevenDaysAgo],
  );

  // Currently stale submissions (>3 days in submitted)
  const { rows: [{ count: staleSubmissions }] } = await pool.query(
    `SELECT COUNT(*) FROM "Paper" WHERE status = 'submitted' AND "submittedAt" < $1`,
    [threeDaysAgo],
  );

  // Currently stale reviews (>7 days, all scores zero)
  const { rows: [{ count: staleReviews }] } = await pool.query(
    `SELECT COUNT(*) FROM "Review"
     WHERE "createdAt" < $1
       AND "noveltyScore" = 0 AND "correctnessScore" = 0
       AND "clarityScore" = 0 AND "significanceScore" = 0
       AND "priorWorkScore" = 0`,
    [sevenDaysAgoStale],
  );

  return {
    submissions: Number(submissions),
    publications: Number(publications),
    reviewsCompleted: Number(reviewsCompleted),
    staleSubmissions: Number(staleSubmissions),
    staleReviews: Number(staleReviews),
    errors: Number(errors),
    downloads: Number(downloads),
  };
}

async function sendDigest(data: DigestData): Promise<void> {
  if (!ALERT_EMAIL) return;

  const hasIssues = data.staleSubmissions > 0 || data.staleReviews > 0 || data.errors > 0;
  const subject = `${hasIssues ? "[ATTENTION] " : ""}Claude Journal Weekly Digest`;

  const rows = [
    ["Papers submitted", data.submissions],
    ["Papers published", data.publications],
    ["Reviews completed", data.reviewsCompleted],
    ["Downloads", data.downloads],
    ["Stale submissions", data.staleSubmissions],
    ["Stale reviews", data.staleReviews],
    ["System errors", data.errors],
  ] as const;

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

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`\n--- WEEKLY DIGEST (stub mode — set RESEND_API_KEY to send) ---`);
    console.log(`To: ${ALERT_EMAIL}`);
    console.log(`Subject: ${subject}`);
    for (const [label, count] of rows) {
      console.log(`  ${label}: ${count}`);
    }
    console.log(`---\n`);
    return;
  }

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  const from = process.env.EMAIL_FROM || "The Claude Journal <noreply@claude-journal.dev>";
  await resend.emails.send({ from, to: ALERT_EMAIL, subject, html });
  console.log(`Weekly digest sent to ${ALERT_EMAIL}`);
}

async function main() {
  if (!ALERT_EMAIL) {
    console.warn("ALERT_EMAIL not set — weekly digest disabled");
    process.exit(0);
  }

  const pool = new pg.Pool({ connectionString: DB_URL });
  try {
    const data = await gather(pool);
    await sendDigest(data);
  } catch (err) {
    console.error("Weekly digest failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
