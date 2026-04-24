/**
 * Domain Validation Schemas — Applicative Error Accumulation
 *
 * Each schema validates a domain object and returns ALL errors at once,
 * not just the first. Built on the Validation applicative from combinators.ts.
 */

import {
  type Validation,
  valid,
  combineAll,
  required,
  maxLength,
  oneOf,
  range,
  integer,
  predicate,
  validationToResult,
} from "./combinators";
import { type Result } from "@/lib/result";

// ── Helpers ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain<T>(value: unknown, ...validators: ((v: any) => Validation<T>)[]): Validation<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: Validation<any> = valid(value);
  for (const v of validators) {
    if (result.tag === "invalid") return result as Validation<T>;
    result = v(result.value);
  }
  return result as Validation<T>;
}

// ── Paper Submission ──────────────────────────────────────

export interface ValidatedPaperSubmission {
  title: string;
  abstract: string;
  category: string;
  tags: string[];
}

export function validatePaperSubmission(fields: {
  title: unknown;
  abstract: unknown;
  category: unknown;
  tags: string[];
}): Result<ValidatedPaperSubmission> {
  const v = combineAll([
    chain(fields.title, required("Title"), maxLength(500)),
    chain(fields.abstract, required("Abstract"), maxLength(10_000)),
    oneOf(["research", "expository"] as const)(fields.category),
    predicate(
      (t: string[]) => t.length <= 20,
      "Maximum 20 tags allowed",
    )(fields.tags),
  ]);

  if (v.tag === "invalid") return validationToResult(v as Validation<never>);

  const [title, abstract, category, tags] = v.value as [string, string, string, string[]];
  return validationToResult(valid({ title: (title as string).trim(), abstract: (abstract as string).trim(), category, tags }));
}

// ── Review Data ───────────────────────────────────────────

export interface ValidatedReviewData {
  noveltyScore: number;
  correctnessScore: number;
  clarityScore: number;
  significanceScore: number;
  priorWorkScore: number;
  summary: string;
  strengths: string;
  weaknesses: string;
  questions: string;
  connections: string;
  verdict: string;
  buildOn: string;
}

const MAX_REVIEW_TEXT = 20_000;

export function validateReviewData(data: Record<string, unknown>): Result<ValidatedReviewData> {
  const v = combineAll([
    chain(data.noveltyScore, integer("Novelty score"), range(1, 5)),
    chain(data.correctnessScore, integer("Correctness score"), range(1, 5)),
    chain(data.clarityScore, integer("Clarity score"), range(1, 5)),
    chain(data.significanceScore, integer("Significance score"), range(1, 5)),
    chain(data.priorWorkScore, integer("Prior work score"), range(1, 5)),
    chain(data.summary, required("Summary"), maxLength(MAX_REVIEW_TEXT)),
    chain(data.strengths, required("Strengths"), maxLength(MAX_REVIEW_TEXT)),
    chain(data.weaknesses, required("Weaknesses"), maxLength(MAX_REVIEW_TEXT)),
    chain(data.questions ?? "", maxLength(MAX_REVIEW_TEXT)),
    chain(data.connections ?? "", maxLength(MAX_REVIEW_TEXT)),
    oneOf(["accept", "minor-revision", "major-revision", "reject"] as const)(data.verdict),
    chain(data.buildOn ?? "", maxLength(MAX_REVIEW_TEXT)),
  ]);

  if (v.tag === "invalid") return validationToResult(v as Validation<never>);

  const vals = v.value as unknown[];
  return validationToResult(valid({
    noveltyScore: vals[0] as number,
    correctnessScore: vals[1] as number,
    clarityScore: vals[2] as number,
    significanceScore: vals[3] as number,
    priorWorkScore: vals[4] as number,
    summary: vals[5] as string,
    strengths: vals[6] as string,
    weaknesses: vals[7] as string,
    questions: vals[8] as string,
    connections: vals[9] as string,
    verdict: vals[10] as string,
    buildOn: vals[11] as string,
  }));
}

// ── Note Content ──────────────────────────────────────────

export function validateNoteContent(content: unknown): Result<string> {
  const v = chain(content, required("Content"), maxLength(10_000));
  return validationToResult(v);
}
