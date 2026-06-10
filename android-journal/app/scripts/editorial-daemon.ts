/**
 * Editorial Daemon — Cron Entry Point (Plan 3)
 *
 * Advances papers through the editorial state machine:
 *   submitted → under-review (+ referee assignment)
 *   under-review → accepted | revision (unanimous verdicts only)
 *   mixed verdicts → flagged for an editor (audit: editorial.decision.flagged)
 *
 * Designed to run every 15 minutes via the compose `jobs` service:
 *   docker compose run --rm jobs npx tsx scripts/editorial-daemon.ts
 *
 * Configuration (environment variables):
 *   EDITORIAL_DAEMON_ENABLED — must be "true", otherwise exits (kill switch)
 *   REFEREE_POOL             — comma-separated githubLogins (required)
 *   REFEREES_PER_PAPER       — default 2
 *   DATABASE_URL             — PostgreSQL connection string
 *
 * Papers tagged `manual-review` are never touched (second kill switch,
 * per-paper). All actions go through transitionPaper + logAuditEvent,
 * so /admin/monitoring and `cli.ts logs` see the automation for free.
 */

import { runDaemonTick } from "@/lib/editorial/daemon";

async function main() {
  if (process.env.EDITORIAL_DAEMON_ENABLED !== "true") {
    console.log("EDITORIAL_DAEMON_ENABLED != true — daemon disabled, exiting.");
    process.exit(0);
  }

  const pool = (process.env.REFEREE_POOL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (pool.length === 0) {
    console.error("REFEREE_POOL is empty — set a comma-separated list of githubLogins.");
    process.exit(1);
  }

  const refereesPerPaper = parseInt(process.env.REFEREES_PER_PAPER ?? "2", 10);

  const actions = await runDaemonTick({ refereePool: pool, refereesPerPaper });

  if (actions.length === 0) {
    console.log("Tick complete — nothing to do.");
  } else {
    for (const a of actions) {
      console.log(`${a.paperId}: ${a.action}${a.detail ? ` (${a.detail})` : ""}`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Editorial daemon failed:", err);
  process.exit(1);
});
