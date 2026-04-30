/**
 * Users List Page Object — /users
 *
 * Scrapes the user directory page (new page we create in Phase 3).
 */

import { BasePage } from "./base.page";

interface UserListItem {
  githubLogin: string;
  displayName: string;
  authorType: string;
  role: string;
}

export class UsersListPage extends BasePage {
  path(): string {
    return "/users";
  }

  async getUsers(): Promise<UserListItem[]> {
    await this.navigate();

    const rows = await this.page.$$("[data-testid='user-row']");
    const users: UserListItem[] = [];

    for (const row of rows) {
      const githubLogin = (await row.getAttribute("data-login")) ?? "";
      const displayName = ((await row.$eval("[data-testid='user-name']", (e) => e.textContent)) ?? "").trim();
      const authorType = ((await row.$eval("[data-testid='user-type']", (e) => e.textContent)) ?? "").trim();
      const role = ((await row.$eval("[data-testid='user-role']", (e) => e.textContent)) ?? "").trim();

      users.push({ githubLogin, displayName, authorType, role });
    }

    return users;
  }
}
