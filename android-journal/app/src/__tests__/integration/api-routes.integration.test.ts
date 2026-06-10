/**
 * Agent API Routes Integration Tests (Plan 5)
 *
 * The JSON API surface the `journal` CLI speaks to:
 *   GET  /api/papers                       — list (editor status filter)
 *   GET  /api/papers/[paperId]             — detail (visibility rules)
 *   POST /api/papers                       — submit (multipart)
 *   POST /api/papers/[paperId]/reviews     — referee review
 *   POST /api/papers/[paperId]/transition  — editor state machine
 *   POST /api/papers/[paperId]/assign      — editor referee assignment
 *
 * All requests authenticate via Authorization: Bearer — the agent path.
 * withSession reads the header off the NextRequest; the server actions
 * inside read it via next/headers, which we mock with a shared store.
 * Real test database throughout.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { SignJWT } from "jose";

process.env.JWT_SECRET =
  "test-secret-that-is-at-least-thirty-two-characters-long-for-hs256";

// ── Mock next/headers so getSession() inside actions sees the Bearer ──

const mockHeaderStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined),
    set: vi.fn(),
    delete: vi.fn(),
  })),
  headers: vi.fn(async () => ({
    get: vi.fn(
      (name: string) => mockHeaderStore.get(name.toLowerCase()) ?? null,
    ),
  })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// submitPaper writes PDF/LaTeX to disk — keep the test filesystem clean
vi.mock("@/lib/storage", () => ({
  storePaperFiles: vi.fn(async ({ paperId }: { paperId: string }) => ({
    pdfPath: `uploads/papers/${paperId}/paper.pdf`,
    latexPath: null,
  })),
}));

import { NextRequest } from "next/server";
import { getJwtSecret } from "@/lib/constants";
import { prisma } from "@/lib/db";
import {
  cleanDatabase,
  createTestUser,
  createTestPaper,
  buildSubmissionForm,
} from "./helpers";

import { GET as listPapers, POST as submitPaper } from "@/app/api/papers/route";
import { GET as showPaper } from "@/app/api/papers/[paperId]/route";
import { POST as submitReview } from "@/app/api/papers/[paperId]/reviews/route";
import { POST as transition } from "@/app/api/papers/[paperId]/transition/route";
import { POST as assign } from "@/app/api/papers/[paperId]/assign/route";

// ── Helpers ───────────────────────────────────────────────

async function tokenFor(user: {
  id: number;
  githubLogin: string;
  role: string;
}): Promise<string> {
  return new SignJWT({ login: user.githubLogin, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(getJwtSecret());
}

interface RequestOpts {
  method?: string;
  token?: string;
  json?: unknown;
  form?: FormData;
}

function makeRequest(path: string, opts: RequestOpts = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.token) {
    headers["authorization"] = `Bearer ${opts.token}`;
    // The actions read the header via next/headers — mirror it there
    mockHeaderStore.set("authorization", `Bearer ${opts.token}`);
  }
  if (opts.json !== undefined) headers["content-type"] = "application/json";

  return new NextRequest(`http://localhost:3000${path}`, {
    method: opts.method ?? "GET",
    headers,
    body:
      opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
  });
}

function params(paperId: string) {
  return { params: Promise.resolve({ paperId }) };
}

const VALID_REVIEW = {
  noveltyScore: 4,
  correctnessScore: 5,
  clarityScore: 4,
  significanceScore: 3,
  priorWorkScore: 4,
  summary: "A solid contribution on migration topology.",
  strengths: "Clear theorems, honest experiments.",
  weaknesses: "Limited to ring topologies.",
  questions: "Does the result extend to hypercubes?",
  connections: "Relates to my work on Hopf algebras.",
  verdict: "accept",
  buildOn: "Could compose with categorical GA framework.",
};

beforeEach(async () => {
  await cleanDatabase();
  mockHeaderStore.clear();
  vi.clearAllMocks();
});

// ── GET /api/papers ───────────────────────────────────────

describe("GET /api/papers", () => {
  test("anonymous sees only published papers", async () => {
    const author = await createTestUser();
    await createTestPaper(author.id, { status: "published" });
    await createTestPaper(author.id, { status: "submitted" });

    const res = await listPapers(makeRequest("/api/papers"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.papers[0].status).toBe("published");
  });

  test("editor with status filter sees unpublished papers", async () => {
    const editor = await createTestUser({ role: "editor" });
    await createTestPaper(editor.id, { status: "submitted" });

    const res = await listPapers(
      makeRequest("/api/papers?status=submitted", {
        token: await tokenFor(editor),
      }),
    );
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.papers[0].status).toBe("submitted");
  });

  test("plain user's status filter is ignored — published only", async () => {
    const user = await createTestUser();
    await createTestPaper(user.id, { status: "submitted" });

    const res = await listPapers(
      makeRequest("/api/papers?status=submitted", {
        token: await tokenFor(user),
      }),
    );
    const data = await res.json();
    expect(data.total).toBe(0);
  });
});

// ── GET /api/papers/[paperId] ─────────────────────────────

describe("GET /api/papers/[paperId]", () => {
  test("published paper visible anonymously", async () => {
    const author = await createTestUser();
    const paper = await createTestPaper(author.id, { status: "published" });

    const res = await showPaper(
      makeRequest(`/api/papers/${paper.paperId}`),
      params(paper.paperId),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.paper.paperId).toBe(paper.paperId);
    expect(data.paper.authors).toHaveLength(1);
  });

  test("unpublished paper → 404 for anonymous, 200 for editor", async () => {
    const editor = await createTestUser({ role: "editor" });
    const paper = await createTestPaper(editor.id, { status: "submitted" });

    const anon = await showPaper(
      makeRequest(`/api/papers/${paper.paperId}`),
      params(paper.paperId),
    );
    expect(anon.status).toBe(404);

    const asEditor = await showPaper(
      makeRequest(`/api/papers/${paper.paperId}`, {
        token: await tokenFor(editor),
      }),
      params(paper.paperId),
    );
    expect(asEditor.status).toBe(200);
  });

  test("nonexistent paper → 404", async () => {
    const res = await showPaper(
      makeRequest("/api/papers/2099-999"),
      params("2099-999"),
    );
    expect(res.status).toBe(404);
  });
});

// ── POST /api/papers ──────────────────────────────────────

describe("POST /api/papers", () => {
  test("no token → 401", async () => {
    const res = await submitPaper(
      makeRequest("/api/papers", { method: "POST", form: buildSubmissionForm() }),
    );
    expect(res.status).toBe(401);
  });

  test("valid submission → 201 with paperId, row in DB", async () => {
    const user = await createTestUser();
    const res = await submitPaper(
      makeRequest("/api/papers", {
        method: "POST",
        token: await tokenFor(user),
        form: buildSubmissionForm(),
      }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.paperId).toMatch(/^\d{4}-\d{3}$/);

    const paper = await prisma.paper.findUnique({
      where: { paperId: data.paperId },
      include: { authors: true },
    });
    expect(paper).not.toBeNull();
    expect(paper!.authors[0].userId).toBe(user.id);
  });

  test("invalid submission (missing title) → 400", async () => {
    const user = await createTestUser();
    const form = buildSubmissionForm();
    form.delete("title");

    const res = await submitPaper(
      makeRequest("/api/papers", {
        method: "POST",
        token: await tokenFor(user),
        form,
      }),
    );
    expect(res.status).toBe(400);
  });
});

// ── POST /api/papers/[paperId]/reviews ────────────────────

describe("POST /api/papers/[paperId]/reviews", () => {
  test("assigned referee submits a valid review → 200, row updated", async () => {
    const author = await createTestUser();
    const referee = await createTestUser();
    const paper = await createTestPaper(author.id, { status: "under-review" });
    await prisma.review.create({
      data: {
        paperId: paper.id,
        reviewerId: referee.id,
        noveltyScore: 0, correctnessScore: 0, clarityScore: 0,
        significanceScore: 0, priorWorkScore: 0,
        summary: "", strengths: "", weaknesses: "",
        questions: "", connections: "",
        verdict: "pending",
      },
    });

    const res = await submitReview(
      makeRequest(`/api/papers/${paper.paperId}/reviews`, {
        method: "POST",
        token: await tokenFor(referee),
        json: VALID_REVIEW,
      }),
      params(paper.paperId),
    );
    expect(res.status).toBe(200);

    const review = await prisma.review.findUnique({
      where: { paperId_reviewerId: { paperId: paper.id, reviewerId: referee.id } },
    });
    expect(review!.verdict).toBe("accept");
    expect(review!.noveltyScore).toBe(4);
  });

  test("unassigned user → 403", async () => {
    const author = await createTestUser();
    const interloper = await createTestUser();
    const paper = await createTestPaper(author.id, { status: "under-review" });

    const res = await submitReview(
      makeRequest(`/api/papers/${paper.paperId}/reviews`, {
        method: "POST",
        token: await tokenFor(interloper),
        json: VALID_REVIEW,
      }),
      params(paper.paperId),
    );
    expect(res.status).toBe(403);
  });

  test("no token → 401", async () => {
    const res = await submitReview(
      makeRequest("/api/papers/2026-001/reviews", {
        method: "POST",
        json: VALID_REVIEW,
      }),
      params("2026-001"),
    );
    expect(res.status).toBe(401);
  });
});

// ── POST /api/papers/[paperId]/transition ─────────────────

describe("POST /api/papers/[paperId]/transition", () => {
  test("plain user → 403 (role enforced by stack)", async () => {
    const user = await createTestUser();
    const paper = await createTestPaper(user.id);

    const res = await transition(
      makeRequest(`/api/papers/${paper.paperId}/transition`, {
        method: "POST",
        token: await tokenFor(user),
        json: { status: "under-review" },
      }),
      params(paper.paperId),
    );
    expect(res.status).toBe(403);
  });

  test("editor transitions submitted → under-review", async () => {
    const editor = await createTestUser({ role: "editor" });
    const paper = await createTestPaper(editor.id, { status: "submitted" });

    const res = await transition(
      makeRequest(`/api/papers/${paper.paperId}/transition`, {
        method: "POST",
        token: await tokenFor(editor),
        json: { status: "under-review" },
      }),
      params(paper.paperId),
    );
    expect(res.status).toBe(200);

    const updated = await prisma.paper.findUnique({
      where: { paperId: paper.paperId },
    });
    expect(updated!.status).toBe("under-review");
  });

  test("invalid transition → 400", async () => {
    const editor = await createTestUser({ role: "editor" });
    const paper = await createTestPaper(editor.id, { status: "submitted" });

    const res = await transition(
      makeRequest(`/api/papers/${paper.paperId}/transition`, {
        method: "POST",
        token: await tokenFor(editor),
        json: { status: "published" },
      }),
      params(paper.paperId),
    );
    expect(res.status).toBe(400);
  });

  test("missing status field → 400", async () => {
    const editor = await createTestUser({ role: "editor" });
    const paper = await createTestPaper(editor.id);

    const res = await transition(
      makeRequest(`/api/papers/${paper.paperId}/transition`, {
        method: "POST",
        token: await tokenFor(editor),
        json: {},
      }),
      params(paper.paperId),
    );
    expect(res.status).toBe(400);
  });
});

// ── POST /api/papers/[paperId]/assign ─────────────────────

describe("POST /api/papers/[paperId]/assign", () => {
  test("editor assigns a referee → 200, pending review created", async () => {
    const editor = await createTestUser({ role: "editor" });
    const author = await createTestUser();
    const referee = await createTestUser();
    const paper = await createTestPaper(author.id, { status: "under-review" });

    const res = await assign(
      makeRequest(`/api/papers/${paper.paperId}/assign`, {
        method: "POST",
        token: await tokenFor(editor),
        json: { reviewer: referee.githubLogin },
      }),
      params(paper.paperId),
    );
    expect(res.status).toBe(200);

    const review = await prisma.review.findUnique({
      where: { paperId_reviewerId: { paperId: paper.id, reviewerId: referee.id } },
    });
    expect(review!.verdict).toBe("pending");
  });

  test("assigning the author → 400", async () => {
    const editor = await createTestUser({ role: "editor" });
    const author = await createTestUser();
    const paper = await createTestPaper(author.id, { status: "under-review" });

    const res = await assign(
      makeRequest(`/api/papers/${paper.paperId}/assign`, {
        method: "POST",
        token: await tokenFor(editor),
        json: { reviewer: author.githubLogin },
      }),
      params(paper.paperId),
    );
    expect(res.status).toBe(400);
  });

  test("unknown reviewer → 404", async () => {
    const editor = await createTestUser({ role: "editor" });
    const paper = await createTestPaper(editor.id, { status: "under-review" });

    const res = await assign(
      makeRequest(`/api/papers/${paper.paperId}/assign`, {
        method: "POST",
        token: await tokenFor(editor),
        json: { reviewer: "nobody-here" },
      }),
      params(paper.paperId),
    );
    expect(res.status).toBe(404);
  });
});
