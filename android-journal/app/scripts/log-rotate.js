#!/usr/bin/env node
/**
 * Log Rotation & Cleanup
 *
 * Rotates app.log and error.log to dated archives.
 * Deletes archives older than RETENTION_DAYS.
 *
 * Usage:
 *   node scripts/log-rotate.js           # rotate + cleanup
 *   node scripts/log-rotate.js --dry-run # show what would happen
 *
 * Run daily via cron:
 *   0 0 * * * cd /path/to/app && node scripts/log-rotate.js
 *
 * How it works:
 *   1. app.log → app-2026-04-24.log (rename)
 *   2. error.log → error-2026-04-24.log (rename)
 *   3. Delete any *.log files older than RETENTION_DAYS
 *   4. The running Pino process will create new app.log/error.log
 *      on next write (fs.createWriteStream with flags:'a')
 */

const fs = require("fs");
const path = require("path");

const LOG_DIR = process.env.LOG_DIR || "logs";
const RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || "14", 10);
const DRY_RUN = process.argv.includes("--dry-run");
const dir = path.resolve(process.cwd(), LOG_DIR);

if (!fs.existsSync(dir)) {
  console.log(`Log directory does not exist: ${dir}`);
  process.exit(0);
}

const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

// ── Rotate current logs ──────────────────────────────────

for (const name of ["access", "error", "event"]) {
  const src = path.join(dir, `${name}.log`);
  const dst = path.join(dir, `${name}-${today}.log`);

  if (!fs.existsSync(src)) continue;

  const stats = fs.statSync(src);
  if (stats.size === 0) {
    console.log(`  skip ${name}.log (empty)`);
    continue;
  }

  if (fs.existsSync(dst)) {
    // Already rotated today — append instead
    if (DRY_RUN) {
      console.log(`  would append ${name}.log → ${name}-${today}.log`);
    } else {
      fs.appendFileSync(dst, fs.readFileSync(src));
      fs.writeFileSync(src, ""); // truncate
      console.log(`  appended ${name}.log → ${name}-${today}.log`);
    }
  } else {
    if (DRY_RUN) {
      console.log(`  would rotate ${name}.log → ${name}-${today}.log`);
    } else {
      fs.renameSync(src, dst);
      console.log(`  rotated ${name}.log → ${name}-${today}.log`);
    }
  }
}

// ── Clean up old archives ────────────────────────────────

const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
const files = fs.readdirSync(dir);
let deleted = 0;

for (const file of files) {
  // Match dated log files: app-2026-04-10.log, error-2026-04-10.log
  const match = file.match(/^(access|error|event)-(\d{4}-\d{2}-\d{2})\.log$/);
  if (!match) continue;

  const fileDate = new Date(match[2]).getTime();
  if (fileDate < cutoff) {
    const filePath = path.join(dir, file);
    if (DRY_RUN) {
      console.log(`  would delete ${file} (${RETENTION_DAYS}+ days old)`);
    } else {
      fs.unlinkSync(filePath);
      console.log(`  deleted ${file}`);
    }
    deleted++;
  }
}

console.log(`\nDone. Retention: ${RETENTION_DAYS} days. ${deleted ? `${deleted} old file(s) ${DRY_RUN ? "would be " : ""}cleaned.` : "No old files to clean."}`);
