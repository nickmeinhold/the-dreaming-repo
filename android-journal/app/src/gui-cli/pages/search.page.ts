/**
 * Search Page Object — /search
 *
 * Fills the search form and scrapes results.
 */

import { BasePage } from "./base.page";

interface SearchResult {
  paperId: string;
  title: string;
  category: string;
  status: string;
  abstract: string;
}

interface SearchResults {
  results: SearchResult[];
  total: number;
  page: number;
  pages: number;
}

export class SearchPage extends BasePage {
  private query: string = "";
  private category?: string;
  private pageNum: number = 1;

  path(): string {
    const params = new URLSearchParams();
    if (this.query) params.set("q", this.query);
    if (this.category) params.set("category", this.category);
    if (this.pageNum > 1) params.set("page", String(this.pageNum));
    const qs = params.toString();
    return `/search${qs ? `?${qs}` : ""}`;
  }

  setQuery(query: string, category?: string, page?: number): this {
    this.query = query;
    this.category = category;
    this.pageNum = page ?? 1;
    return this;
  }

  async search(): Promise<SearchResults> {
    await this.navigate();

    const resultEls = await this.page.$$("[data-testid='search-result']");
    const results: SearchResult[] = [];

    for (const el of resultEls) {
      const paperId = (await el.getAttribute("data-paper-id")) ?? "";
      const title = ((await el.$eval("[data-testid='search-result-title']",
        (e) => e.textContent)) ?? "").trim();
      const category = ((await el.$eval("[data-testid='search-result-category']",
        (e) => e.textContent)) ?? "").trim();
      const status = ((await el.$eval("[data-testid='search-result-status']",
        (e) => e.textContent)) ?? "").trim();
      const abstract = ((await el.$eval("[data-testid='search-result-abstract']",
        (e) => e.textContent)) ?? "").trim();

      results.push({ paperId, title, category, status, abstract });
    }

    // Parse total from the results count text
    const countText = await this.text("[data-testid='search-results-count']");
    const countMatch = countText.match(/(\d+)\s+result/);
    const total = countMatch ? parseInt(countMatch[1], 10) : results.length;

    // Parse pagination
    const pageInfo = await this.text("[data-testid='page-info']");
    const pageMatch = pageInfo.match(/Page (\d+) of (\d+)/);
    const page = pageMatch ? parseInt(pageMatch[1], 10) : 1;
    const pages = pageMatch ? parseInt(pageMatch[2], 10) : 1;

    return { results, total, page, pages };
  }
}
