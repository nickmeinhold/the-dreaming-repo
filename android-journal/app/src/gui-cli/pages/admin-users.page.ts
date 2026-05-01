/**
 * Admin User Pages — /admin/users/create and /admin/users/:login/promote
 *
 * Page objects for user creation and role management (new pages in Phase 3).
 */

import { BasePage } from "./base.page";

interface CreateUserInput {
  login: string;
  name: string;
  type: string;
  role?: string;
  githubId?: string;
  human?: string;
}

export class UserCreatePage extends BasePage {
  path(): string {
    return "/admin/users/create";
  }

  async createUser(input: CreateUserInput): Promise<{ id: number; githubLogin: string }> {
    await this.navigate();

    await this.page.fill("[data-testid='create-login']", input.login);
    await this.page.fill("[data-testid='create-name']", input.name);
    await this.page.selectOption("[data-testid='create-type']", input.type);

    if (input.role) {
      await this.page.selectOption("[data-testid='create-role']", input.role);
    }
    if (input.githubId) {
      await this.page.fill("[data-testid='create-github-id']", input.githubId);
    }
    if (input.human) {
      await this.page.fill("[data-testid='create-human']", input.human);
    }

    await this.page.click("[data-testid='create-submit']");

    // Wait for either: success message or error message
    // (The form shows one or the other after server action completes)
    try {
      await this.page.waitForSelector(
        "[data-testid='create-success-login'], [data-testid='create-error']",
        { timeout: 15000 },
      );
    } catch {
      throw new Error("User creation timed out — no success or error message appeared");
    }

    // Check for error
    const errorEl = await this.page.$("[data-testid='create-error']");
    if (errorEl) {
      const errorText = ((await errorEl.textContent()) ?? "").trim();
      if (errorText) throw new Error(errorText);
    }

    // Check for success — page shows the created user's login
    const successLogin = await this.text("[data-testid='create-success-login']");
    return { id: 0, githubLogin: successLogin || input.login };
  }
}

export class UserPromotePage extends BasePage {
  constructor(
    page: import("playwright").Page,
    baseUrl: string,
    private login: string,
  ) {
    super(page, baseUrl);
  }

  path(): string {
    return `/admin/users/${this.login}/promote`;
  }

  async promote(newRole: string): Promise<{ githubLogin: string; role: string }> {
    await this.navigate();

    await this.page.selectOption("[data-testid='promote-select']", newRole);
    await this.page.click("[data-testid='promote-submit']");
    await this.page.waitForTimeout(1000);

    // Check for error
    const errorEl = await this.page.$("[data-testid='promote-error']");
    if (errorEl) {
      const errorText = ((await errorEl.textContent()) ?? "").trim();
      if (errorText) throw new Error(errorText);
    }

    return { githubLogin: this.login, role: newRole };
  }
}
