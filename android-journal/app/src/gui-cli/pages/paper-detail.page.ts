/**
 * Paper Detail Page Object — /papers/:paperId
 *
 * Scrapes the paper detail page and provides actions for
 * social interactions (favourite, read, note) and downloading.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { BasePage } from "./base.page";

interface PaperDetail {
  paperId: string;
  title: string;
  abstract: string;
  category: string;
  status: string;
  authors: { displayName: string; githubLogin: string; authorType: string }[];
  tags: { slug: string; label: string }[];
  reviews: ReviewData[];
  notes: NoteData[];
  downloads: number;
  favourites: number;
  noteCount: number;
}

interface ReviewData {
  reviewer: string;
  reviewerLogin: string;
  verdict: string;
  noveltyScore: number;
  correctnessScore: number;
  clarityScore: number;
  significanceScore: number;
  priorWorkScore: number;
  summary: string;
}

interface NoteData {
  id: number;
  content: string;
  user: string;
  userLogin: string;
  createdAt: string;
  replies: NoteData[];
}

export class PaperDetailPage extends BasePage {
  constructor(
    page: import("playwright").Page,
    baseUrl: string,
    private paperId: string,
  ) {
    super(page, baseUrl);
  }

  path(): string {
    return `/papers/${this.paperId}`;
  }

  async getDetail(): Promise<PaperDetail> {
    await this.navigate();

    this.check404(`Paper "${this.paperId}"`);

    const paperId = await this.text("[data-testid='paper-id']");
    const title = await this.text("[data-testid='paper-title']");
    const abstract = await this.text("[data-testid='paper-abstract']");
    const category = await this.text("[data-testid='paper-category']");
    const status = await this.text("[data-testid='paper-status']");

    // Authors
    const authorEls = await this.page.$$("[data-testid='paper-author']");
    const authors: PaperDetail["authors"] = [];
    for (const el of authorEls) {
      const displayName = ((await el.textContent()) ?? "").trim();
      const href = (await el.getAttribute("href")) ?? "";
      const githubLogin = href.replace("/users/", "");
      const authorType = ((await el.$eval("[data-testid='author-type']", (e) => e.textContent)) ?? "").trim().replace(/[()]/g, "");
      authors.push({ displayName: displayName.replace(`(${authorType})`, "").trim(), githubLogin, authorType });
    }

    // Tags
    const tagEls = await this.page.$$("[data-testid='paper-tag']");
    const tags: PaperDetail["tags"] = [];
    for (const el of tagEls) {
      const label = ((await el.textContent()) ?? "").trim();
      const href = (await el.getAttribute("href")) ?? "";
      const slug = href.replace("/tags/", "");
      tags.push({ slug, label });
    }

    // Reviews
    const reviews = await this.scrapeReviews();

    // Notes
    const notes = await this.scrapeNotes();

    // Stats
    const downloadsText = await this.text("[data-testid='paper-downloads']");
    const downloads = parseInt(downloadsText) || 0;
    const notesCountText = await this.text("[data-testid='paper-notes-count']");
    const noteCount = parseInt(notesCountText) || 0;
    const favouritesText = await this.text("[data-testid='favourite-count']");
    const favourites = parseInt(favouritesText) || 0;

    return {
      paperId, title, abstract, category, status,
      authors, tags, reviews, notes,
      downloads, favourites, noteCount,
    };
  }

  private async scrapeReviews(): Promise<ReviewData[]> {
    const reviewEls = await this.page.$$("[data-testid='review-card']");
    const reviews: ReviewData[] = [];

    for (const el of reviewEls) {
      const reviewer = ((await el.$eval("[data-testid='reviewer-name']", (e) => e.textContent)) ?? "").trim();
      const reviewerLogin = ((await el.$eval("[data-testid='reviewer-name']", (e) => e.getAttribute("href"))) ?? "").replace("/users/", "");
      const verdict = ((await el.$eval("[data-testid='review-verdict']", (e) => e.textContent)) ?? "").trim();

      const scoreText = async (label: string) => {
        const scoreEl = await el.$(`[data-testid='score-${label}']`);
        const text = scoreEl ? ((await scoreEl.textContent()) ?? "0") : "0";
        return parseInt(text) || 0;
      };

      const summary = ((await el.$eval("[data-testid='review-summary-text']", (e) => e.textContent)) ?? "").trim();

      reviews.push({
        reviewer, reviewerLogin, verdict,
        noveltyScore: await scoreText("novelty"),
        correctnessScore: await scoreText("correctness"),
        clarityScore: await scoreText("clarity"),
        significanceScore: await scoreText("significance"),
        priorWorkScore: await scoreText("prior-work"),
        summary,
      });
    }

    return reviews;
  }

  private async scrapeNotes(): Promise<NoteData[]> {
    const noteEls = await this.page.$$("[data-testid='notes-section'] > [data-testid='notes-list'] > [data-testid='note-card']");
    return this.scrapeNoteList(noteEls);
  }

  private async scrapeNoteList(elements: import("playwright").ElementHandle[]): Promise<NoteData[]> {
    const notes: NoteData[] = [];
    for (const el of elements) {
      const id = parseInt((await el.getAttribute("data-note-id")) ?? "0");
      const content = ((await el.$eval("[data-testid='note-content']", (e) => e.textContent)) ?? "").trim();
      const user = ((await el.$eval("[data-testid='note-author']", (e) => e.textContent)) ?? "").trim();
      const userLogin = ((await el.$eval("[data-testid='note-author']", (e) => e.getAttribute("href"))) ?? "").replace("/users/", "");
      const createdAt = ((await el.$eval("[data-testid='note-date']", (e) => e.textContent)) ?? "").trim();

      const replyEls = await el.$$("[data-testid='note-replies'] > [data-testid='note-card']");
      const replies = await this.scrapeNoteList(replyEls);

      notes.push({ id, content, user, userLogin, createdAt, replies });
    }
    return notes;
  }

  async toggleFavourite(): Promise<{ paperId: string; favourited: boolean }> {
    await this.navigate();

    this.check404(`Paper "${this.paperId}"`);

    const before = await this.text("[data-testid='favourite-icon']");
    const wasFavourited = before === "\u2605";

    await this.page.click("[data-testid='favourite-button']");
    // Wait for the button state to change
    await this.page.waitForTimeout(500);

    const after = await this.text("[data-testid='favourite-icon']");
    const nowFavourited = after === "\u2605";

    return { paperId: this.paperId, favourited: nowFavourited };
  }

  async markAsRead(): Promise<{ paperId: string; read: boolean }> {
    await this.navigate();

    this.check404(`Paper "${this.paperId}"`);

    await this.page.click("[data-testid='read-marker']");
    await this.page.waitForTimeout(500);
    return { paperId: this.paperId, read: true };
  }

  async addNote(content: string, replyTo?: number): Promise<{ id: number; content: string }> {
    await this.navigate();

    if (replyTo) {
      // Click reply on the target note
      const noteCard = await this.page.$(`[data-note-id='${replyTo}']`);
      if (!noteCard) throw new Error(`Note ${replyTo} not found`);
      const replyBtn = await noteCard.$("[data-testid='note-reply-btn']");
      if (!replyBtn) throw new Error("No reply button found");
      await replyBtn.click();
      await this.page.waitForTimeout(300);

      // Fill the reply form that appeared
      const replyForm = await noteCard.$("[data-testid='note-textarea']");
      if (!replyForm) throw new Error("Reply form did not appear");
      await replyForm.fill(content);
      const submitBtn = await noteCard.$("[data-testid='note-submit']");
      if (!submitBtn) throw new Error("No submit button found");
      await submitBtn.click();
    } else {
      // Fill the top-level note form
      await this.page.fill("[data-testid='note-textarea']", content);
      await this.page.click("[data-testid='note-submit']");
    }

    await this.page.waitForTimeout(500);
    // Return a minimal result — exact ID comes from the reloaded page
    return { id: 0, content };
  }

  async downloadFile(
    fileType: "pdf" | "latex" = "pdf",
    outputPath?: string,
  ): Promise<{ paperId: string; format: string; outputPath: string; bytes: number }> {
    await this.navigate();

    const testid = fileType === "pdf" ? "download-pdf" : "download-latex";
    const href = await this.attr(`[data-testid='${testid}']`, "href");
    if (!href) throw new Error(`No ${fileType} download link found`);

    const downloadUrl = href.startsWith("http") ? href : `${this.baseUrl}${href}`;
    const response = await this.page.request.get(downloadUrl);
    const buffer = await response.body();

    const ext = fileType === "pdf" ? ".pdf" : ".tex";
    const dest = outputPath ?? `${this.paperId}${ext}`;
    await fs.writeFile(dest, buffer);

    return {
      paperId: this.paperId,
      format: fileType,
      outputPath: path.resolve(dest),
      bytes: buffer.length,
    };
  }
}
