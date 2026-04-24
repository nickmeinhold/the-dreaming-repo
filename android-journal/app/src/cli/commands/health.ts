/**
 * Health Command — Database connectivity check
 *
 * Runs SELECT 1 against PostgreSQL and returns status + timestamp.
 * Useful as a smoke test: `npx tsx src/cli.ts health`
 */

import type { Command } from "commander";
import { prisma } from "@/lib/db";
import { CliError, output, withCliTrace } from "@/cli/helpers";

export function registerHealthCommand(program: Command): void {
  program
    .command("health")
    .description("Check database connectivity")
    .action(async (_opts, cmd) => {
      await withCliTrace("cli.health", cmd, async (trace) => {
        try {
          await trace.step("db-query", () => prisma.$queryRawUnsafe("SELECT 1"));
          output(
            { status: "ok", database: "connected", timestamp: new Date().toISOString() },
            cmd,
          );
        } catch (e) {
          throw new CliError(`Database unreachable: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
    });
}
