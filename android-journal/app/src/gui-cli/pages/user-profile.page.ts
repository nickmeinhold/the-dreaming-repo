/**
 * User Profile Page Object — /users/:login
 *
 * Scrapes user profile data including papers, reviews,
 * favourites, reading history, and similar users.
 */

import { BasePage } from "./base.page";

interface UserProfile {
  displayName: string;
  githubLogin: string;
  authorType: string;
  humanName: string | null;
  bio: string | null;
  papers: { paperId: string; title: string; status: string }[];
  reviews: { paperId: string; title: string; verdict: string }[];
  favourites: { paperId: string; title: string }[];
  downloads: { paperId: string; title: string }[];
}

interface SimilarUser {
  githubLogin: string;
  displayName: string;
  similarity: number;
}

export class UserProfilePage extends BasePage {
  constructor(
    page: import("playwright").Page,
    baseUrl: string,
    private login: string,
  ) {
    super(page, baseUrl);
  }

  path(): string {
    return `/users/${this.login}`;
  }

  async getProfile(): Promise<UserProfile> {
    await this.navigate();

    this.check404(`User "${this.login}"`);

    const displayName = await this.text("[data-testid='profile-name']");
    const authorType = await this.text("[data-testid='profile-type']");
    const bio = (await this.text("[data-testid='profile-bio']")) || null;
    const humanName = (await this.text("[data-testid='profile-human']")) || null;

    // Papers
    const paperEls = await this.page.$$("[data-testid='profile-papers'] [data-testid='profile-paper']");
    const papers: UserProfile["papers"] = [];
    for (const el of paperEls) {
      const paperId = (await el.getAttribute("data-paper-id")) ?? "";
      const title = ((await el.$eval("[data-testid='profile-paper-title']", (e) => e.textContent)) ?? "").trim();
      const status = ((await el.$eval("[data-testid='profile-paper-status']", (e) => e.textContent)) ?? "").trim();
      papers.push({ paperId, title, status });
    }

    // Reviews
    const reviewEls = await this.page.$$("[data-testid='profile-reviews'] [data-testid='profile-review']");
    const reviews: UserProfile["reviews"] = [];
    for (const el of reviewEls) {
      const verdict = ((await el.$eval("[data-testid='profile-review-verdict']", (e) => e.textContent)) ?? "").trim();
      const title = ((await el.$eval("[data-testid='profile-review-title']", (e) => e.textContent)) ?? "").trim();
      const href = ((await el.$eval("[data-testid='profile-review-title']", (e) => e.getAttribute("href"))) ?? "");
      const paperId = href.replace("/papers/", "");
      reviews.push({ paperId, title, verdict });
    }

    // Favourites
    const favEls = await this.page.$$("[data-testid='profile-favourites'] [data-testid='profile-favourite']");
    const favourites: UserProfile["favourites"] = [];
    for (const el of favEls) {
      const title = ((await el.textContent()) ?? "").trim();
      const href = (await el.getAttribute("href")) ?? "";
      const paperId = href.replace("/papers/", "");
      favourites.push({ paperId, title });
    }

    // Downloads/reads
    const readEls = await this.page.$$("[data-testid='profile-reads'] [data-testid='profile-read']");
    const downloads: UserProfile["downloads"] = [];
    for (const el of readEls) {
      const title = ((await el.textContent()) ?? "").trim();
      const href = (await el.getAttribute("href")) ?? "";
      const paperId = href.replace("/papers/", "");
      downloads.push({ paperId, title });
    }

    return {
      displayName, githubLogin: this.login, authorType,
      humanName, bio, papers, reviews, favourites, downloads,
    };
  }

  async getFavourites(): Promise<{ paperId: string; title: string }[]> {
    const profile = await this.getProfile();
    return profile.favourites;
  }

  async getReadHistory(): Promise<{ paperId: string; title: string }[]> {
    const profile = await this.getProfile();
    return profile.downloads;
  }

  async getSimilarUsers(): Promise<SimilarUser[]> {
    await this.navigate();

    const similarEls = await this.page.$$("[data-testid='similar-users'] [data-testid='similar-user']");
    const users: SimilarUser[] = [];

    for (const el of similarEls) {
      const displayName = ((await el.$eval("[data-testid='similar-user-name']", (e) => e.textContent)) ?? "").trim();
      const href = (await el.getAttribute("href")) ?? "";
      const githubLogin = href.replace("/users/", "");
      const simText = ((await el.$eval("[data-testid='similar-user-score']", (e) => e.textContent)) ?? "0").trim();
      const similarity = parseFloat(simText.replace("%", "")) / 100;

      users.push({ githubLogin, displayName, similarity });
    }

    return users;
  }
}
