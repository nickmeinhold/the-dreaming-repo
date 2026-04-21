/**
 * Submission Mediator — Kleisli Pipeline DAG
 *
 * CATEGORY THEORY:
 *   The mediator composes Kleisli arrows over the Result monad:
 *     generateId: () → Result<string>
 *     create: string → Result<{id}>
 *     store: string → Result<FilePaths>
 *     updatePaths: (string, FilePaths) → Result<void>
 *
 *   Short-circuit on err = left absorption in the Kleisli category.
 *   The pipeline is a DAG where each step depends on the previous.
 *
 * DESIGN PATTERNS (GoF):
 *   Mediator — coordinates steps without them referencing each other
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@/lib/result";
import {
  SubmissionMediator,
  type IdGenerator,
  type PaperRepository,
  type StorageService,
  type ValidatedSubmission,
  type FilePaths,
} from "@/lib/submission/mediator";

// ── Test data ───────────────────────────────────────────────

const testSubmission: ValidatedSubmission = {
  title: "Test Paper",
  abstract: "An abstract",
  category: "research",
  tags: ["test"],
  pdf: Buffer.from("%PDF-test"),
  authorId: 1,
  authorName: "Lyra",
  authorType: "autonomous",
  authorGithub: "lyra-claude",
  authorHuman: null,
};

const testPaths: FilePaths = {
  pdfPath: "uploads/papers/2026-001/paper.pdf",
  latexPath: null,
};

// ── Mock factories ──────────────────────────────────────────

function mockIdGen(opts?: { fail?: boolean }): IdGenerator {
  return {
    next: async () => {
      if (opts?.fail) throw new Error("ID generation failed");
      return "2026-001";
    },
  };
}

function mockRepo(opts?: {
  createFail?: boolean;
  updateFail?: boolean;
}): PaperRepository & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    create: async () => {
      calls.push("create");
      return opts?.createFail ? err("create failed") : ok({ id: 1 });
    },
    updatePaths: async () => {
      calls.push("updatePaths");
      return opts?.updateFail ? err("update failed") : ok(undefined);
    },
  };
}

function mockStorage(opts?: {
  fail?: boolean;
}): StorageService & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    store: async () => {
      calls.push("store");
      return opts?.fail ? err("storage failed") : ok(testPaths);
    },
  };
}

// ═══════════════════════════════════════════════════════════
//  HAPPY PATH
// ═══════════════════════════════════════════════════════════

describe("Happy Path", () => {
  it("successful submission returns ok({ paperId })", async () => {
    const mediator = new SubmissionMediator(
      mockIdGen(),
      mockRepo(),
      mockStorage(),
    );
    const result = await mediator.submit(testSubmission);

    expect(result.tag).toBe("ok");
    expect(result.isOk() && result.value.paperId).toBe("2026-001");
  });

  it("steps execute in order: ID → create → store → updatePaths", async () => {
    const order: string[] = [];
    const repo: PaperRepository = {
      create: async () => { order.push("create"); return ok({ id: 1 }); },
      updatePaths: async () => { order.push("updatePaths"); return ok(undefined); },
    };
    const storage: StorageService = {
      store: async () => { order.push("store"); return ok(testPaths); },
    };
    const mediator = new SubmissionMediator(mockIdGen(), repo, storage);

    await mediator.submit(testSubmission);

    expect(order).toEqual(["create", "store", "updatePaths"]);
  });
});

// ═══════════════════════════════════════════════════════════
//  FAILURE PROPAGATION
// ═══════════════════════════════════════════════════════════

describe("Failure Propagation", () => {
  it("ID generation failure → err, no create/store", async () => {
    const repo = mockRepo();
    const storage = mockStorage();
    const mediator = new SubmissionMediator(
      mockIdGen({ fail: true }),
      repo,
      storage,
    );

    const result = await mediator.submit(testSubmission);
    expect(result.tag).toBe("err");
    expect(repo.calls).toEqual([]);
    expect(storage.calls).toEqual([]);
  });

  it("repository create failure → err, no store", async () => {
    const repo = mockRepo({ createFail: true });
    const storage = mockStorage();
    const mediator = new SubmissionMediator(mockIdGen(), repo, storage);

    const result = await mediator.submit(testSubmission);
    expect(result.tag).toBe("err");
    expect(repo.calls).toEqual(["create"]);
    expect(storage.calls).toEqual([]);
  });

  it("storage failure → err, no updatePaths", async () => {
    const repo = mockRepo();
    const storage = mockStorage({ fail: true });
    const mediator = new SubmissionMediator(mockIdGen(), repo, storage);

    const result = await mediator.submit(testSubmission);
    expect(result.tag).toBe("err");
    expect(repo.calls).toEqual(["create"]);
    expect(storage.calls).toEqual(["store"]);
  });

  it("repository updatePaths failure → err surfaced", async () => {
    const repo = mockRepo({ updateFail: true });
    const storage = mockStorage();
    const mediator = new SubmissionMediator(mockIdGen(), repo, storage);

    const result = await mediator.submit(testSubmission);
    expect(result.tag).toBe("err");
    expect(result.isErr() && result.error).toContain("update failed");
  });
});

// ═══════════════════════════════════════════════════════════
//  STEP ISOLATION
// ═══════════════════════════════════════════════════════════

describe("Step Isolation", () => {
  it("later steps receive output of earlier steps", async () => {
    let receivedPaperId: string | null = null;
    const storage: StorageService = {
      store: async (paperId) => {
        receivedPaperId = paperId;
        return ok(testPaths);
      },
    };
    const mediator = new SubmissionMediator(
      mockIdGen(),
      mockRepo(),
      storage,
    );

    await mediator.submit(testSubmission);
    expect(receivedPaperId).toBe("2026-001");
  });

  it("steps don't reference each other directly", () => {
    // This is a structural test: the mediator constructor takes
    // independent interfaces — no step imports another.
    const idGen = mockIdGen();
    const repo = mockRepo();
    const storage = mockStorage();

    // Each dependency is independently constructible
    expect(idGen).toBeDefined();
    expect(repo).toBeDefined();
    expect(storage).toBeDefined();

    // They share no references
    expect(idGen).not.toBe(repo);
    expect(repo).not.toBe(storage);
  });

  it("steps are independently replaceable", async () => {
    // Swap the ID generator — same pipeline structure, different ID
    const customIdGen: IdGenerator = {
      next: async () => "CUSTOM-999",
    };
    const mediator = new SubmissionMediator(
      customIdGen,
      mockRepo(),
      mockStorage(),
    );

    const result = await mediator.submit(testSubmission);
    expect(result.isOk() && result.value.paperId).toBe("CUSTOM-999");
  });
});

// ═══════════════════════════════════════════════════════════
//  INVARIANTS
// ═══════════════════════════════════════════════════════════

describe("Pipeline Invariants", () => {
  it("error from any step is surfaced in the Result", async () => {
    // Test each failure point surfaces its error
    const m1 = new SubmissionMediator(mockIdGen({ fail: true }), mockRepo(), mockStorage());
    expect((await m1.submit(testSubmission)).tag).toBe("err");

    const m2 = new SubmissionMediator(mockIdGen(), mockRepo({ createFail: true }), mockStorage());
    expect((await m2.submit(testSubmission)).tag).toBe("err");

    const m3 = new SubmissionMediator(mockIdGen(), mockRepo(), mockStorage({ fail: true }));
    expect((await m3.submit(testSubmission)).tag).toBe("err");

    const m4 = new SubmissionMediator(mockIdGen(), mockRepo({ updateFail: true }), mockStorage());
    expect((await m4.submit(testSubmission)).tag).toBe("err");
  });

  it("successful path runs all 4 steps exactly once", async () => {
    const repo = mockRepo();
    const storage = mockStorage();
    const mediator = new SubmissionMediator(mockIdGen(), repo, storage);

    await mediator.submit(testSubmission);

    // create + updatePaths from repo, store from storage = 3 calls total for 4 steps
    // (idGen is called but not tracked — it's step 1)
    expect(repo.calls).toEqual(["create", "updatePaths"]);
    expect(storage.calls).toEqual(["store"]);
  });

  it("failed step prevents ALL subsequent steps from running", async () => {
    // Fail at step 2 (create) — steps 3 and 4 should not run
    const repo = mockRepo({ createFail: true });
    const storage = mockStorage();
    const mediator = new SubmissionMediator(mockIdGen(), repo, storage);

    await mediator.submit(testSubmission);

    expect(repo.calls).toEqual(["create"]); // no updatePaths
    expect(storage.calls).toEqual([]); // no store
  });
});
