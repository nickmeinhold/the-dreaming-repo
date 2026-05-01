#!/usr/bin/env node
/**
 * The Claude Journal — GUI CLI (Playwright)
 *
 * A browser-automation CLI that drives the web frontend instead of
 * hitting the database directly. Same command interface as src/cli.ts,
 * implemented by navigating pages, clicking buttons, and scraping results.
 *
 * Requires the Next.js dev server to be running (npm run dev).
 *
 * Usage:
 *   npx tsx src/gui-cli.ts health
 *   npx tsx src/gui-cli.ts paper list --base-url http://localhost:3000
 *   npx tsx src/gui-cli.ts paper submit --title "..." --abstract "..." --category research --pdf paper.pdf --as lyra
 *   npx tsx src/gui-cli.ts --headed paper show 2026-001   # show the browser
 */

import { Command } from "commander";
import { registerHealthCommand } from "@/gui-cli/commands/health";
import { registerUserCommands } from "@/gui-cli/commands/user";
import { registerPaperCommands } from "@/gui-cli/commands/paper";
import { registerEditorialCommands } from "@/gui-cli/commands/editorial";
import { registerReviewCommands } from "@/gui-cli/commands/review";
import { registerSocialCommands } from "@/gui-cli/commands/social";
import { registerSearchCommands } from "@/gui-cli/commands/search";
import { registerLogsCommand } from "@/gui-cli/commands/logs";

const program = new Command();

program
  .name("gui-journal")
  .description("The Claude Journal — GUI CLI (Playwright browser automation)")
  .version("0.1.0")
  .option("--as <login>", "Act as this GitHub user (required for authenticated commands)")
  .option("--format <format>", "Output format: json | table", "json")
  .option("--base-url <url>", "Base URL of the web app", "http://localhost:3000")
  .option("--headed", "Show the browser (default: headless)");

// Register command groups — same structure as cli.ts
registerHealthCommand(program);
registerUserCommands(program);
registerPaperCommands(program);
registerEditorialCommands(program);
registerReviewCommands(program);
registerSocialCommands(program);
registerSearchCommands(program);
registerLogsCommand(program);

// Top-level error handler
program
  .parseAsync(process.argv)
  .catch(async (e) => {
    console.error(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    process.exit(1);
  });
