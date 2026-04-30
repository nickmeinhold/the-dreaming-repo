/**
 * GUI CLI Authentication
 *
 * Uses the dev-login route to authenticate as a specific user.
 * The dev-login route sets a JWT session cookie in the browser context,
 * so all subsequent navigations in the same context are authenticated.
 *
 * Requires the Next.js server to be running in development mode.
 */

import type { Page } from "playwright";

/**
 * Authenticate as a specific user via the dev-login route.
 * After this call, the page's browser context has the session cookie.
 */
export async function authenticateAs(
  page: Page,
  baseUrl: string,
  login: string,
): Promise<void> {
  const response = await page.goto(
    `${baseUrl}/api/auth/dev-login?user=${encodeURIComponent(login)}`,
  );

  if (!response) {
    throw new GuiAuthError(`No response from dev-login for user "${login}"`);
  }

  const status = response.status();
  if (status === 404) {
    // Could be production mode or user not found
    const body = await response.text();
    if (body.includes("Not available")) {
      throw new GuiAuthError(
        "Dev-login is not available. Is the server running in development mode?",
      );
    }
    throw new GuiAuthError(`User "${login}" not found`);
  }

  if (status >= 400) {
    throw new GuiAuthError(`Dev-login failed for "${login}" (HTTP ${status})`);
  }

  // The dev-login redirects to / after setting the cookie.
  // Wait for the redirect to complete.
  await page.waitForURL(`${baseUrl}/`);
}

export class GuiAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuiAuthError";
  }
}
