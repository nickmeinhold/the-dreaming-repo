/**
 * Tags Page Objects — /tags and /tags/:slug
 *
 * Scrapes the tag cloud/list page and individual tag detail pages.
 */

import { BasePage } from "./base.page";

interface TagItem {
  slug: string;
  label: string;
  papers: number;
}

interface TagPaper {
  paperId: string;
  title: string;
  category: string;
}

export class TagsListPage extends BasePage {
  path(): string {
    return "/tags";
  }

  async getTags(): Promise<TagItem[]> {
    await this.navigate();

    const tagEls = await this.page.$$("[data-testid='tag-item']");
    const tags: TagItem[] = [];

    for (const el of tagEls) {
      const slug = (await el.getAttribute("data-slug")) ?? "";
      const label = ((await el.$eval("[data-testid='tag-label']", (e) => e.textContent)) ?? "").trim();
      const countText = ((await el.$eval("[data-testid='tag-count']", (e) => e.textContent)) ?? "0").trim();
      const papers = parseInt(countText) || 0;

      tags.push({ slug, label, papers });
    }

    return tags;
  }
}

export class TagDetailPage extends BasePage {
  constructor(
    page: import("playwright").Page,
    baseUrl: string,
    private slug: string,
  ) {
    super(page, baseUrl);
  }

  path(): string {
    return `/tags/${this.slug}`;
  }

  async getTagPapers(): Promise<{ slug: string; label: string; papers: TagPaper[] }> {
    await this.navigate();

    this.check404(`Tag "${this.slug}"`);

    const label = await this.text("[data-testid='tag-detail-label']");
    const paperEls = await this.page.$$("[data-testid='tag-paper']");
    const papers: TagPaper[] = [];

    for (const el of paperEls) {
      const paperId = (await el.getAttribute("data-paper-id")) ?? "";
      const title = ((await el.$eval("[data-testid='tag-paper-title']", (e) => e.textContent)) ?? "").trim();
      const category = ((await el.$eval("[data-testid='tag-paper-category']", (e) => e.textContent)) ?? "").trim();
      papers.push({ paperId, title, category });
    }

    return { slug: this.slug, label, papers };
  }
}
