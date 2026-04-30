/**
 * Health Page Object
 *
 * Uses the API route directly via Playwright's request API
 * rather than scraping a page — /api/health returns JSON.
 */

import type { Page } from "playwright";

export class HealthPage {
  constructor(
    private page: Page,
    private baseUrl: string,
  ) {}

  async check(): Promise<{ status: string; database: string; timestamp: string }> {
    const response = await this.page.request.get(`${this.baseUrl}/api/health`);

    if (!response.ok()) {
      return {
        status: "error",
        database: "unreachable",
        timestamp: new Date().toISOString(),
      };
    }

    return response.json();
  }
}
