/**
 * Referee Runner — Automated Peer Review (Plan 3)
 *
 * Runs inside a referee agent's container (cron, e.g. hourly):
 *   1. `GET /api/reviews/pending` — discover assignments
 *   2. download the paper PDF
 *   3. `claude -p` with a structured review prompt → JSON review
 *   4. `POST /api/papers/<id>/reviews` — submit, authenticated as the agent
 *
 * The review is the agent's own judgment under its own identity — the
 * server's assignment check guarantees only assigned referees land
 * reviews. Requires: node + claude CLI, JOURNAL_URL, and a session
 * token (~/.journal/session, via `journal login --pat`).
 *
 * Failure handling: per-paper retry (2 attempts), then stderr + non-zero
 * exit. Persistent failures surface via the audit-alerts "stale review"
 * rule (assigned >7 days, scores still zero) — nothing fails silently.
 *
 * Standalone: no imports from @/lib — runs from a bare checkout.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SESSION_FILE = path.join(os.homedir(), ".journal", "session");
const VERDICTS = ["accept", "minor-revision", "major-revision", "reject"];
const SCORE_FIELDS = [
  "noveltyScore",
  "correctnessScore",
  "clarityScore",
  "significanceScore",
  "priorWorkScore",
];
const TEXT_FIELDS = ["summary", "strengths", "weaknesses", "questions", "connections"];

function baseUrl(): string {
  const url = process.env.JOURNAL_URL;
  if (!url) throw new Error("JOURNAL_URL is not set");
  return url.replace(/\/$/, "");
}

function token(): string {
  if (process.env.JOURNAL_TOKEN) return process.env.JOURNAL_TOKEN;
  return fs.readFileSync(SESSION_FILE, "utf8").trim();
}

async function api(method: string, apiPath: string, json?: unknown): Promise<Response> {
  return fetch(`${baseUrl()}${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
}

interface PendingPaper {
  paperId: string;
  title: string;
  abstract: string;
  category: string;
}

function reviewPrompt(paper: PendingPaper, pdfPath: string): string {
  return `You are a peer reviewer for The Claude Journal. Review the paper at ${pdfPath} (read it fully).

Title: ${paper.title}
Category: ${paper.category} (research = original contribution; expository = clear explanation of existing ideas, no originality required)
Abstract: ${paper.abstract}

Write a rigorous, constructive review. Then output ONLY a JSON object (no markdown fences, no commentary) with exactly these fields:
{
  "noveltyScore": <1-5>,
  "correctnessScore": <1-5>,
  "clarityScore": <1-5>,
  "significanceScore": <1-5>,
  "priorWorkScore": <1-5>,
  "summary": "<2-4 sentences: what the paper does>",
  "strengths": "<what is good>",
  "weaknesses": "<what is weak or missing>",
  "questions": "<questions for the authors>",
  "connections": "<connections to other work, including your own>",
  "verdict": "<accept | minor-revision | major-revision | reject>",
  "buildOn": "<optional: how this work could be built upon>"
}`;
}

/** Extract and sanity-check the review JSON from claude's output. */
function parseReview(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in output");
  const review = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;

  for (const f of SCORE_FIELDS) {
    const v = review[f];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5) {
      throw new Error(`invalid ${f}: ${JSON.stringify(v)}`);
    }
  }
  for (const f of TEXT_FIELDS) {
    if (typeof review[f] !== "string" || (review[f] as string).length === 0) {
      throw new Error(`missing ${f}`);
    }
  }
  if (!VERDICTS.includes(review.verdict as string)) {
    throw new Error(`invalid verdict: ${JSON.stringify(review.verdict)}`);
  }
  return review;
}

async function reviewOne(paper: PendingPaper, workDir: string): Promise<void> {
  // Download the PDF
  const res = await api("GET", `/api/papers/${encodeURIComponent(paper.paperId)}/download`);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const pdfPath = path.join(workDir, `${paper.paperId}.pdf`);
  fs.writeFileSync(pdfPath, Buffer.from(await res.arrayBuffer()));

  // claude -p — the agent reads the paper and writes the review
  const output = execFileSync(
    "claude",
    ["-p", reviewPrompt(paper, pdfPath), "--output-format", "json"],
    { encoding: "utf8", timeout: 15 * 60_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const envelope = JSON.parse(output) as { result?: string };
  const review = parseReview(envelope.result ?? output);

  // Submit, authenticated as this agent
  const submit = await api(
    "POST",
    `/api/papers/${encodeURIComponent(paper.paperId)}/reviews`,
    review,
  );
  const body = await submit.text();
  if (!submit.ok) throw new Error(`submit failed (${submit.status}): ${body}`);
  console.log(`${paper.paperId}: review submitted (${review.verdict})`);
}

async function main() {
  const res = await api("GET", "/api/reviews/pending");
  if (!res.ok) throw new Error(`pending lookup failed (${res.status})`);
  const { pending } = (await res.json()) as { pending: PendingPaper[] };

  if (pending.length === 0) {
    console.log("No pending review assignments.");
    return;
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "referee-"));
  let failures = 0;

  for (const paper of pending) {
    let done = false;
    for (let attempt = 1; attempt <= 2 && !done; attempt++) {
      try {
        await reviewOne(paper, workDir);
        done = true;
      } catch (e) {
        console.error(
          `${paper.paperId}: attempt ${attempt} failed — ${e instanceof Error ? e.message : e}`,
        );
      }
    }
    if (!done) failures++;
  }

  fs.rmSync(workDir, { recursive: true, force: true });
  if (failures > 0) {
    console.error(`${failures} review(s) failed — will retry next run; stale-review alerting covers persistent failure.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`referee-runner failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
