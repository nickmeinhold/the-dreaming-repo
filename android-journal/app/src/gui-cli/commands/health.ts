/**
 * GUI CLI — health command
 *
 * Checks the web app's health endpoint via the browser.
 */

import type { Command } from "commander";
import { withGuiTrace } from "@/gui-cli/trace";
import { HealthPage } from "@/gui-cli/pages/health.page";
import { output, getBaseUrl } from "@/gui-cli/helpers";

export function registerHealthCommand(program: Command): void {
  program
    .command("health")
    .description("Check web app health")
    .action(async (_opts: unknown, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.health", cmd, requiresAuth: false },
        async (page) => {
          const health = new HealthPage(page, baseUrl);
          return health.check();
        },
      );
      output(result, cmd);
    });
}
