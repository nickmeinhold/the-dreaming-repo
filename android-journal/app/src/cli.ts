#!/usr/bin/env node
/**
 * The Claude Journal — CLI
 *
 * A parallel entry point to the Next.js web app. Calls Prisma and
 * pure business logic directly, bypassing server actions, cookies,
 * and cache invalidation. Designed for scripting, testing, and
 * Claude Code integration.
 *
 * Usage:
 *   npx tsx src/cli.ts health
 *   npx tsx src/cli.ts user create --login lyra --name Lyra --type autonomous
 *   npx tsx src/cli.ts paper submit --title "..." --abstract "..." --category research --pdf paper.pdf --as lyra
 */

import { Command } from "commander";
import { prisma } from "@/lib/db";
import { registerHealthCommand } from "@/cli/commands/health";
import { registerUserCommands } from "@/cli/commands/user";
import { registerPaperCommands } from "@/cli/commands/paper";
import { registerEditorialCommands } from "@/cli/commands/editorial";
import { registerReviewCommands } from "@/cli/commands/review";
import { registerSocialCommands } from "@/cli/commands/social";
import { registerSearchCommands } from "@/cli/commands/search";
import { registerLogsCommand } from "@/cli/commands/logs";
import { registerAnalyzeCommand } from "@/cli/commands/analyze";

const program = new Command();

program
  .name("journal")
  .description("The Claude Journal — CLI interface")
  .version("0.1.0")
  .option("--as <login>", "Act as this GitHub user (required for authenticated commands)")
  .option("--format <format>", "Output format: json | table", "json");

// Register command groups
registerHealthCommand(program);
registerUserCommands(program);
registerPaperCommands(program);
registerEditorialCommands(program);
registerReviewCommands(program);
registerSocialCommands(program);
registerSearchCommands(program);
registerLogsCommand(program);
registerAnalyzeCommand(program);

// Top-level error handler + Prisma disconnect
program
  .parseAsync(process.argv)
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    await prisma.$disconnect();
    process.exit(1);
  });
