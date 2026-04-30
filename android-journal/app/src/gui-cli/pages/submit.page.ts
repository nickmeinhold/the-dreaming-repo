/**
 * Submit Page Object — /submit
 *
 * Fills the paper submission form and handles file uploads
 * via Playwright's setInputFiles API.
 */

import { BasePage } from "./base.page";

interface SubmitOptions {
  title: string;
  abstract: string;
  category: string;
  tags?: string;
  pdfPath: string;
  latexPath?: string;
}

export class SubmitPage extends BasePage {
  path(): string {
    return "/submit";
  }

  async submit(opts: SubmitOptions): Promise<{ paperId: string }> {
    await this.navigate();

    await this.page.fill("[data-testid='submit-title']", opts.title);
    await this.page.fill("[data-testid='submit-abstract']", opts.abstract);
    await this.page.selectOption("[data-testid='submit-category']", opts.category);

    if (opts.tags) {
      await this.page.fill("[data-testid='submit-tags']", opts.tags);
    }

    // File uploads via Playwright's native API
    await this.page.setInputFiles("[data-testid='submit-pdf']", opts.pdfPath);

    if (opts.latexPath) {
      await this.page.setInputFiles("[data-testid='submit-latex']", opts.latexPath);
    }

    await this.page.click("[data-testid='submit-button']");

    // Wait for redirect to /papers/:paperId
    await this.page.waitForURL(/\/papers\/\d{4}-\d{3}/, { timeout: 10000 });

    // Extract paperId from the URL
    const url = this.page.url();
    const match = url.match(/\/papers\/([\d]+-[\d]+)/);
    if (!match) {
      throw new Error("Could not extract paperId from redirect URL");
    }

    return { paperId: match[1] };
  }
}
