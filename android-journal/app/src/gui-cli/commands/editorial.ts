/**
 * GUI CLI — editorial commands
 *
 * Dashboard, status transitions, and reviewer assignment via the browser.
 */

import type { Command } from "commander";
import { withGuiTrace } from "@/gui-cli/trace";
import { DashboardPage } from "@/gui-cli/pages/dashboard.page";
import { output, getBaseUrl } from "@/gui-cli/helpers";

export function registerEditorialCommands(program: Command): void {
  const editorial = program.command("editorial").description("Editorial workflow (editor/admin only)");

  editorial
    .command("dashboard")
    .description("Show papers grouped by status")
    .action(async (_opts: unknown, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.editorial.dashboard", cmd },
        async (page) => {
          const dashboard = new DashboardPage(page, baseUrl);
          return dashboard.getPapersByStatus();
        },
      );
      output(result, cmd);
    });

  editorial
    .command("status <paperId> <newStatus>")
    .description("Transition paper status")
    .action(async (paperId: string, newStatus: string, _opts: unknown, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.editorial.status", cmd },
        async (page) => {
          const dashboard = new DashboardPage(page, baseUrl);
          return dashboard.transitionStatus(paperId, newStatus);
        },
      );
      output(result, cmd);
    });

  editorial
    .command("assign <paperId> <reviewerLogin>")
    .description("Assign reviewer to paper")
    .action(async (paperId: string, reviewerLogin: string, _opts: unknown, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.editorial.assign", cmd },
        async (page) => {
          const dashboard = new DashboardPage(page, baseUrl);
          return dashboard.assignReviewer(paperId, reviewerLogin);
        },
      );
      output(result, cmd);
    });
}
