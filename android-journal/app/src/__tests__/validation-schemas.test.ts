/**
 * Domain Validation Schemas — Applicative Error Accumulation
 *
 * The combinators (valid, invalid, combineAll) are tested in
 * validation-applicative.test.ts for their algebraic laws.
 * These tests verify the DOMAIN SCHEMAS built on top — that each
 * schema rejects invalid input and accumulates all errors.
 */

import { describe, test, expect } from "vitest";
import {
  validatePaperSubmission,
  validateReviewData,
  validateNoteContent,
} from "@/lib/validation/schemas";

// ═══════════════════════════════════════════════════════════
//  Paper Submission
// ═══════════════════════════════════════════════════════════

describe("validatePaperSubmission", () => {
  const valid = {
    title: "Categorical Composition of GAs",
    abstract: "We prove that migration topology determines diversity.",
    category: "research",
    tags: ["category-theory", "genetic-algorithms"],
  };

  test("accepts valid submission", () => {
    const result = validatePaperSubmission(valid);
    expect(result.isOk()).toBe(true);
  });

  test("trims title and abstract whitespace", () => {
    const result = validatePaperSubmission({
      ...valid,
      title: "  Spaces  ",
      abstract: "  Trimmed  ",
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.title).toBe("Spaces");
      expect(result.value.abstract).toBe("Trimmed");
    }
  });

  test("rejects empty title", () => {
    const result = validatePaperSubmission({ ...valid, title: "" });
    expect(result.isErr()).toBe(true);
  });

  test("rejects title > 500 chars", () => {
    const result = validatePaperSubmission({
      ...valid,
      title: "x".repeat(501),
    });
    expect(result.isErr()).toBe(true);
  });

  test("rejects empty abstract", () => {
    const result = validatePaperSubmission({ ...valid, abstract: "" });
    expect(result.isErr()).toBe(true);
  });

  test("rejects abstract > 10,000 chars", () => {
    const result = validatePaperSubmission({
      ...valid,
      abstract: "x".repeat(10_001),
    });
    expect(result.isErr()).toBe(true);
  });

  test("rejects invalid category", () => {
    const result = validatePaperSubmission({ ...valid, category: "opinion" });
    expect(result.isErr()).toBe(true);
  });

  test("accepts both valid categories", () => {
    for (const category of ["research", "expository"]) {
      const result = validatePaperSubmission({ ...valid, category });
      expect(result.isOk(), `category "${category}" should be valid`).toBe(true);
    }
  });

  test("rejects > 20 tags", () => {
    const result = validatePaperSubmission({
      ...valid,
      tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`),
    });
    expect(result.isErr()).toBe(true);
  });

  test("accepts exactly 20 tags", () => {
    const result = validatePaperSubmission({
      ...valid,
      tags: Array.from({ length: 20 }, (_, i) => `tag-${i}`),
    });
    expect(result.isOk()).toBe(true);
  });

  test("accumulates multiple errors", () => {
    const result = validatePaperSubmission({
      title: "",
      abstract: "",
      category: "invalid",
      tags: Array.from({ length: 21 }, (_, i) => `t${i}`),
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      // Should have at least 3 errors (title, abstract, category)
      // Tags might be a 4th depending on accumulation
      expect(result.error.length).toBeGreaterThanOrEqual(3);
    }
  });
});

// ═══════════════════════════════════════════════════════════
//  Review Data
// ═══════════════════════════════════════════════════════════

describe("validateReviewData", () => {
  const valid = {
    noveltyScore: 4,
    correctnessScore: 5,
    clarityScore: 3,
    significanceScore: 4,
    priorWorkScore: 4,
    summary: "Strong paper with novel approach",
    strengths: "Clear exposition, rigorous proofs",
    weaknesses: "Limited experiments",
    questions: "",
    connections: "",
    verdict: "accept",
    buildOn: "",
  };

  test("accepts valid review", () => {
    const result = validateReviewData(valid);
    expect(result.isOk()).toBe(true);
  });

  test("rejects score below 1", () => {
    const result = validateReviewData({ ...valid, noveltyScore: 0 });
    expect(result.isErr()).toBe(true);
  });

  test("rejects score above 5", () => {
    const result = validateReviewData({ ...valid, clarityScore: 6 });
    expect(result.isErr()).toBe(true);
  });

  test("rejects non-integer score", () => {
    const result = validateReviewData({ ...valid, noveltyScore: 3.5 });
    expect(result.isErr()).toBe(true);
  });

  test("rejects empty summary", () => {
    const result = validateReviewData({ ...valid, summary: "" });
    expect(result.isErr()).toBe(true);
  });

  test("rejects invalid verdict", () => {
    const result = validateReviewData({ ...valid, verdict: "maybe" });
    expect(result.isErr()).toBe(true);
  });

  test("accepts all valid verdicts", () => {
    for (const verdict of ["accept", "minor-revision", "major-revision", "reject"]) {
      const result = validateReviewData({ ...valid, verdict });
      expect(result.isOk(), `verdict "${verdict}" should be valid`).toBe(true);
    }
  });

  test("optional fields default when missing", () => {
    const { questions, connections, buildOn, ...required } = valid;
    const result = validateReviewData(required);
    expect(result.isOk()).toBe(true);
  });

  test("accumulates multiple score errors", () => {
    const result = validateReviewData({
      ...valid,
      noveltyScore: 0,
      correctnessScore: 6,
      clarityScore: -1,
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.length).toBeGreaterThanOrEqual(3);
    }
  });
});

// ═══════════════════════════════════════════════════════════
//  Note Content
// ═══════════════════════════════════════════════════════════

describe("validateNoteContent", () => {
  test("accepts valid content", () => {
    const result = validateNoteContent("Great paper!");
    expect(result.isOk()).toBe(true);
  });

  test("rejects empty content", () => {
    const result = validateNoteContent("");
    expect(result.isErr()).toBe(true);
  });

  test("rejects content > 10,000 chars", () => {
    const result = validateNoteContent("x".repeat(10_001));
    expect(result.isErr()).toBe(true);
  });

  test("accepts content at exactly 10,000 chars", () => {
    const result = validateNoteContent("x".repeat(10_000));
    expect(result.isOk()).toBe(true);
  });
});
