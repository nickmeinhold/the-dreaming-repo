/**
 * Dashboard Page Object — /dashboard
 *
 * Scrapes the editor dashboard and provides actions for
 * status transitions and reviewer assignment.
 */

import { BasePage } from "./base.page";

interface DashboardPaper {
  paperId: string;
  title: string;
  authors: string[];
  reviews: { reviewer: string; verdict: string }[];
}

type DashboardData = Record<string, DashboardPaper[]>;

export class DashboardPage extends BasePage {
  path(): string {
    return "/dashboard";
  }

  async getPapersByStatus(): Promise<DashboardData> {
    await this.navigate();

    // Dashboard redirects non-editors to /
    if (!this.page.url().includes("/dashboard")) {
      throw new Error("Access denied — editor role required");
    }

    const result: DashboardData = {};
    const sections = await this.page.$$("[data-testid^='dashboard-section-']");

    for (const section of sections) {
      const testid = (await section.getAttribute("data-testid")) ?? "";
      const status = testid.replace("dashboard-section-", "");

      const paperEls = await section.$$("[data-testid='dashboard-paper']");
      const papers: DashboardPaper[] = [];

      for (const el of paperEls) {
        const paperId = (await el.getAttribute("data-paper-id")) ?? "";
        const title = ((await el.$eval("[data-testid='dashboard-paper-title']",
          (e) => e.textContent)) ?? "").trim();

        const authorEls = await el.$$("[data-testid='dashboard-paper-author']");
        const authors: string[] = [];
        for (const a of authorEls) {
          authors.push(((await a.textContent()) ?? "").trim());
        }

        const reviewEls = await el.$$("[data-testid='dashboard-review']");
        const reviews: { reviewer: string; verdict: string }[] = [];
        for (const r of reviewEls) {
          const text = ((await r.textContent()) ?? "").trim();
          const [reviewer, verdict] = text.split(":").map((s) => s.trim());
          reviews.push({ reviewer: reviewer ?? "", verdict: verdict ?? "" });
        }

        papers.push({ paperId, title, authors, reviews });
      }

      result[status] = papers;
    }

    return result;
  }

  async transitionStatus(paperId: string, newStatus: string): Promise<{ paperId: string; status: string }> {
    await this.navigate();

    const paperCard = await this.page.$(`[data-paper-id='${paperId}']`);
    if (!paperCard) throw new Error(`Paper ${paperId} not found on dashboard`);

    const btn = await paperCard.$(`[data-testid='transition-${newStatus}']`);
    if (!btn) throw new Error(`No transition button for status "${newStatus}" on paper ${paperId}`);

    await btn.click();
    await this.page.waitForTimeout(1000);

    return { paperId, status: newStatus };
  }

  async assignReviewer(paperId: string, reviewerLogin: string): Promise<{ paperId: string; reviewer: string; status: string }> {
    await this.navigate();

    const paperCard = await this.page.$(`[data-paper-id='${paperId}']`);
    if (!paperCard) throw new Error(`Paper ${paperId} not found on dashboard`);

    // Click "Assign reviewer" to open the form
    const openBtn = await paperCard.$("[data-testid='assign-open']");
    if (!openBtn) throw new Error("No assign button found");
    await openBtn.click();
    await this.page.waitForTimeout(300);

    // Fill the login input and submit
    const input = await paperCard.$("[data-testid='assign-input']");
    if (!input) throw new Error("Assign reviewer form did not open");
    await input.fill(reviewerLogin);

    const submitBtn = await paperCard.$("[data-testid='assign-submit']");
    if (!submitBtn) throw new Error("No submit button found");
    await submitBtn.click();
    await this.page.waitForTimeout(1000);

    // Check for errors
    const errorEl = await paperCard.$("[data-testid='assign-error']");
    if (errorEl) {
      const errorText = ((await errorEl.textContent()) ?? "").trim();
      if (errorText) throw new Error(errorText);
    }

    return { paperId, reviewer: reviewerLogin, status: "assigned" };
  }
}
