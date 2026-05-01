/**
 * GUI CLI — logs commands
 *
 * Audit log querying via the admin monitoring pages.
 */

import type { Command } from "commander";
import { withGuiTrace } from "@/gui-cli/trace";
import { MonitoringPage } from "@/gui-cli/pages/monitoring.page";
import { output, getBaseUrl } from "@/gui-cli/helpers";

export function registerLogsCommand(program: Command): void {
  const logs = program.command("logs").description("Audit log queries (via monitoring dashboard)");

  logs
    .command("recent")
    .description("Recent audit events")
    .action(async (_opts: unknown, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.logs.recent", cmd },
        async (page) => {
          const monitoring = new MonitoringPage(page, baseUrl);
          return monitoring.getRecent();
        },
      );
      output(result, cmd);
    });

  logs
    .command("summary")
    .description("Grouped summary of recent activity")
    .action(async (_opts: unknown, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.logs.summary", cmd },
        async (page) => {
          const monitoring = new MonitoringPage(page, baseUrl);
          return monitoring.getSummary();
        },
      );
      output(result, cmd);
    });
}
