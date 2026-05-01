/**
 * Review Page Object — /reviews/:paperId
 *
 * Fills the peer review form with scores, text fields, and verdict.
 */

import { BasePage } from "./base.page";

interface ReviewInput {
  novelty: number;
  correctness: number;
  clarity: number;
  significance: number;
  priorWork: number;
  verdict: string;
  summary: string;
  strengths: string;
  weaknesses: string;
  questions?: string;
  connections?: string;
  buildOn?: string;
}

export class ReviewPage extends BasePage {
  constructor(
    page: import("playwright").Page,
    baseUrl: string,
    private paperId: string,
  ) {
    super(page, baseUrl);
  }

  path(): string {
    return `/reviews/${this.paperId}`;
  }

  async submitReview(input: ReviewInput): Promise<{ paperId: string; verdict: string }> {
    await this.navigate();

    // Click score buttons (1-5 for each criterion)
    const scoreMap: Record<string, number> = {
      noveltyScore: input.novelty,
      correctnessScore: input.correctness,
      clarityScore: input.clarity,
      significanceScore: input.significance,
      priorWorkScore: input.priorWork,
    };

    for (const [key, score] of Object.entries(scoreMap)) {
      await this.page.click(`[data-testid='score-${key}-${score}']`);
    }

    // Fill text fields
    await this.page.fill("[data-testid='review-summary']", input.summary);
    await this.page.fill("[data-testid='review-strengths']", input.strengths);
    await this.page.fill("[data-testid='review-weaknesses']", input.weaknesses);

    if (input.questions) {
      await this.page.fill("[data-testid='review-questions']", input.questions);
    }
    if (input.connections) {
      await this.page.fill("[data-testid='review-connections']", input.connections);
    }
    if (input.buildOn) {
      await this.page.fill("[data-testid='review-buildOn']", input.buildOn);
    }

    // Select verdict radio button
    await this.page.click(`[data-testid='verdict-${input.verdict}']`);

    // Submit
    await this.page.click("[data-testid='review-submit']");

    // Wait for either: redirect to paper detail, or error message
    try {
      await Promise.race([
        this.page.waitForURL(/\/papers\/[^/]/, { timeout: 15000 }),
        this.page.waitForSelector("[data-testid='review-error']", { timeout: 15000 }),
      ]);
    } catch {
      throw new Error("Review submission timed out — no redirect or error");
    }

    // Check for error
    const errorEl = await this.page.$("[data-testid='review-error']");
    if (errorEl) {
      const errorText = ((await errorEl.textContent()) ?? "").trim();
      throw new Error(errorText || "Review submission failed");
    }

    return { paperId: this.paperId, verdict: input.verdict };
  }
}
