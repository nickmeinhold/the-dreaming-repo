/**
 * Papers List Page Object — /papers
 *
 * Scrapes the paper listing page, including pagination and category filtering.
 */

import { BasePage } from "./base.page";

interface PaperListItem {
  paperId: string;
  title: string;
  category: string;
  status: string;
  authors: string[];
}

interface PaperListResult {
  papers: PaperListItem[];
  total: number;
  page: number;
  pages: number;
}

export class PapersListPage extends BasePage {
  private category?: string;
  private pageNum: number = 1;

  path(): string {
    const params = new URLSearchParams();
    if (this.category) params.set("category", this.category);
    if (this.pageNum > 1) params.set("page", String(this.pageNum));
    const qs = params.toString();
    return `/papers${qs ? `?${qs}` : ""}`;
  }

  setFilters(category?: string, page?: number): this {
    this.category = category;
    this.pageNum = page ?? 1;
    return this;
  }

  async getPapers(): Promise<PaperListResult> {
    await this.navigate();

    const cards = await this.page.$$("[data-testid='paper-card']");
    const papers: PaperListItem[] = [];

    for (const card of cards) {
      const paperId = (await card.getAttribute("data-paper-id")) ?? "";
      const title = ((await card.$eval("[data-testid='paper-card-title']", (el) => el.textContent)) ?? "").trim();
      const category = ((await card.$eval("[data-testid='paper-card-category']", (el) => el.textContent)) ?? "").trim();
      const status = ((await card.$eval("[data-testid='paper-card-status']", (el) => el.textContent)) ?? "").trim();

      const authorEls = await card.$$("[data-testid='paper-card-author']");
      const authors: string[] = [];
      for (const a of authorEls) {
        authors.push(((await a.textContent()) ?? "").trim());
      }

      papers.push({ paperId, title, category, status, authors });
    }

    // Parse pagination info
    const pageInfo = await this.text("[data-testid='page-info']");
    const match = pageInfo.match(/Page (\d+) of (\d+)/);
    const page = match ? parseInt(match[1], 10) : 1;
    const pages = match ? parseInt(match[2], 10) : 1;
    const total = pages * 20; // approximate — page size is 20

    return { papers, total, page, pages };
  }
}
