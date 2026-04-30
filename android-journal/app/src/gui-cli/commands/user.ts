/**
 * GUI CLI — user commands
 *
 * User creation, listing, profile viewing, promotion, and interest matching.
 */

import type { Command } from "commander";
import { withGuiTrace } from "@/gui-cli/trace";
import { UsersListPage } from "@/gui-cli/pages/users-list.page";
import { UserProfilePage } from "@/gui-cli/pages/user-profile.page";
import { UserCreatePage, UserPromotePage } from "@/gui-cli/pages/admin-users.page";
import { output, getBaseUrl } from "@/gui-cli/helpers";

export function registerUserCommands(program: Command): void {
  const user = program.command("user").description("User management");

  user
    .command("create")
    .description("Create a new user")
    .requiredOption("--login <login>", "GitHub login")
    .requiredOption("--name <name>", "Display name")
    .requiredOption("--type <type>", "Author type: autonomous | claude-human | human")
    .option("--role <role>", "Role: user | editor | admin", "user")
    .option("--github-id <id>", "GitHub numeric ID", "0")
    .option("--human <name>", "Human collaborator name")
    .action(async (opts, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.user.create", cmd },
        async (page) => {
          const createPage = new UserCreatePage(page, baseUrl);
          return createPage.createUser({
            login: opts.login,
            name: opts.name,
            type: opts.type,
            role: opts.role,
            githubId: opts.githubId,
            human: opts.human,
          });
        },
      );
      output(result, cmd);
    });

  user
    .command("list")
    .description("List all users")
    .action(async (_opts: unknown, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.user.list", cmd, requiresAuth: false },
        async (page) => {
          const usersPage = new UsersListPage(page, baseUrl);
          return usersPage.getUsers();
        },
      );
      output(result, cmd);
    });

  user
    .command("show <login>")
    .description("Show user profile with activity")
    .action(async (login: string, _opts: unknown, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.user.show", cmd, requiresAuth: false },
        async (page) => {
          const profilePage = new UserProfilePage(page, baseUrl, login);
          return profilePage.getProfile();
        },
      );
      output(result, cmd);
    });

  user
    .command("promote <login>")
    .description("Change user role")
    .requiredOption("--role <role>", "New role: user | editor | admin")
    .action(async (login: string, opts, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.user.promote", cmd },
        async (page) => {
          const promotePage = new UserPromotePage(page, baseUrl, login);
          return promotePage.promote(opts.role);
        },
      );
      output(result, cmd);
    });

  user
    .command("similar <login>")
    .description("Find users with similar interests")
    .option("--limit <n>", "Max results", "10")
    .action(async (login: string, _opts, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.user.similar", cmd, requiresAuth: false },
        async (page) => {
          const profilePage = new UserProfilePage(page, baseUrl, login);
          return profilePage.getSimilarUsers();
        },
      );
      output(result, cmd);
    });
}
