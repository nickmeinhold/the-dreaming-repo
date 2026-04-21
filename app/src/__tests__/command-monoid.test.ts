/**
 * Command Pattern — Free Monoid Laws
 *
 * CATEGORY THEORY:
 *   Commands form a free monoid under sequential composition:
 *   - Carrier: Command implementations
 *   - Identity: NoOpCommand
 *   - Operation: .then() → CompositeCommand
 *   - The free monoid on a set S is the monoid of lists over S
 *
 *   Monoid laws:
 *     Left identity:  NoOp.then(a) ≡ a
 *     Right identity: a.then(NoOp) ≡ a
 *     Associativity:  (a.then(b)).then(c) ≡ a.then(b.then(c))
 *
 * DESIGN PATTERNS (GoF):
 *   Command — encapsulate actions as objects with execute/describe/toJSON
 *   Composite — CompositeCommand holds a list of commands
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@/lib/result";
import {
  NoOpCommand,
  TransitionCommand,
  AssignReviewerCommand,
  CompositeCommand,
  type WorkflowRepository,
  type ReviewerRepository,
} from "@/lib/commands/editorial";
import { CommandHistory } from "@/lib/commands/history";

// ── Mock repositories ──────────────────────────────────────

function mockWorkflowRepo(opts?: {
  canTransition?: boolean;
  transitionResult?: "ok" | "err";
}): WorkflowRepository {
  return {
    canTransition: () => opts?.canTransition ?? true,
    transition: async () =>
      opts?.transitionResult === "err"
        ? err("transition failed")
        : ok(undefined),
  };
}

function mockReviewerRepo(opts?: {
  isAssigned?: boolean;
  assignResult?: "ok" | "err";
}): ReviewerRepository {
  return {
    isAssigned: async () => opts?.isAssigned ?? false,
    assign: async () =>
      opts?.assignResult === "err"
        ? err("assign failed")
        : ok(undefined),
  };
}

// ── Helper: collect side effects from execution ────────────

const effects: string[] = [];

function trackingTransition(
  label: string,
  repo: WorkflowRepository,
): TransitionCommand {
  const tracking: WorkflowRepository = {
    canTransition: repo.canTransition,
    transition: async (paperId, newStatus) => {
      effects.push(label);
      return repo.transition(paperId, newStatus);
    },
  };
  return new TransitionCommand(1, "2026-001", "submitted", "under-review", tracking);
}

// ═══════════════════════════════════════════════════════════
//  MONOID LAWS
// ═══════════════════════════════════════════════════════════

describe("Monoid Laws", () => {
  it("left identity: NoOp.then(cmd) behaves like cmd", async () => {
    const noop = new NoOpCommand();
    const cmd = new TransitionCommand(
      1, "2026-001", "submitted", "under-review", mockWorkflowRepo(),
    );

    const composed = noop.then(cmd);
    const directResult = await cmd.execute();
    const composedResult = await composed.execute();

    expect(directResult.tag).toBe(composedResult.tag);
  });

  it("right identity: cmd.then(NoOp) behaves like cmd", async () => {
    const cmd = new TransitionCommand(
      1, "2026-001", "submitted", "under-review", mockWorkflowRepo(),
    );
    const noop = new NoOpCommand();

    const composed = cmd.then(noop);
    const directResult = await cmd.execute();
    const composedResult = await composed.execute();

    expect(directResult.tag).toBe(composedResult.tag);
  });

  it("associativity: (a.then(b)).then(c) ≡ a.then(b.then(c))", async () => {
    effects.length = 0;
    const repo = mockWorkflowRepo();
    const a = trackingTransition("A", repo);
    const b = trackingTransition("B", repo);
    const c = trackingTransition("C", repo);

    // Left grouping
    effects.length = 0;
    const left = a.then(b).then(c);
    await left.execute();
    const leftEffects = [...effects];

    // Right grouping
    effects.length = 0;
    const a2 = trackingTransition("A", repo);
    const b2 = trackingTransition("B", repo);
    const c2 = trackingTransition("C", repo);
    const right = a2.then(b2.then(c2));
    await right.execute();
    const rightEffects = [...effects];

    expect(leftEffects).toEqual(rightEffects);
  });
});

// ═══════════════════════════════════════════════════════════
//  COMMAND EXECUTION
// ═══════════════════════════════════════════════════════════

describe("Command Execution", () => {
  it("TransitionCommand executes valid transition → ok", async () => {
    const cmd = new TransitionCommand(
      1, "2026-001", "submitted", "under-review", mockWorkflowRepo(),
    );
    const result = await cmd.execute();
    expect(result.tag).toBe("ok");
  });

  it("TransitionCommand with invalid transition → err", async () => {
    const cmd = new TransitionCommand(
      1, "2026-001", "submitted", "published",
      mockWorkflowRepo({ canTransition: false }),
    );
    const result = await cmd.execute();
    expect(result.tag).toBe("err");
  });

  it("AssignReviewerCommand executes → ok", async () => {
    const cmd = new AssignReviewerCommand(
      1, "2026-001", 42, mockReviewerRepo(),
    );
    const result = await cmd.execute();
    expect(result.tag).toBe("ok");
  });

  it("AssignReviewerCommand duplicate → err", async () => {
    const cmd = new AssignReviewerCommand(
      1, "2026-001", 42, mockReviewerRepo({ isAssigned: true }),
    );
    const result = await cmd.execute();
    expect(result.tag).toBe("err");
  });

  it("describe() returns human-readable string", () => {
    const cmd = new TransitionCommand(
      1, "2026-001", "submitted", "under-review", mockWorkflowRepo(),
    );
    expect(cmd.describe()).toContain("2026-001");
    expect(cmd.describe()).toContain("submitted");
    expect(cmd.describe()).toContain("under-review");
  });
});

// ═══════════════════════════════════════════════════════════
//  SERIALIZATION
// ═══════════════════════════════════════════════════════════

describe("Serialization", () => {
  it("toJSON() round-trips with correct fields", () => {
    const cmd = new TransitionCommand(
      1, "2026-001", "submitted", "under-review", mockWorkflowRepo(),
    );
    const json = cmd.toJSON();

    expect(json.type).toBe("transition");
    expect(json.actorId).toBe(1);
    expect(json.description).toBe(cmd.describe());
    expect(json.payload).toBeDefined();
  });

  it("toJSON() captures type and payload", () => {
    const cmd = new AssignReviewerCommand(
      5, "2026-003", 42, mockReviewerRepo(),
    );
    const json = cmd.toJSON();

    expect(json.type).toBe("assign-reviewer");
    expect(json.payload).toEqual({ paperId: "2026-003", reviewerId: 42 });
  });
});

// ═══════════════════════════════════════════════════════════
//  HISTORY
// ═══════════════════════════════════════════════════════════

describe("Command History", () => {
  it("CommandHistory.execute(cmd) records the command", async () => {
    const history = new CommandHistory();
    const cmd = new TransitionCommand(
      1, "2026-001", "submitted", "under-review", mockWorkflowRepo(),
    );
    await history.execute(cmd);

    expect(history.getLog()).toHaveLength(1);
    expect(history.getLog()[0].record.type).toBe("transition");
  });

  it("history preserves execution order", async () => {
    const history = new CommandHistory();
    await history.execute(new TransitionCommand(
      1, "2026-001", "submitted", "under-review", mockWorkflowRepo(),
    ));
    await history.execute(new AssignReviewerCommand(
      1, "2026-001", 42, mockReviewerRepo(),
    ));

    const types = history.getLog().map((e) => e.record.type);
    expect(types).toEqual(["transition", "assign-reviewer"]);
  });

  it("history records timestamps", async () => {
    const history = new CommandHistory();
    const before = new Date();
    await history.execute(new NoOpCommand());
    const after = new Date();

    const ts = history.getLog()[0].timestamp;
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(ts.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("failed commands recorded with error message", async () => {
    const history = new CommandHistory();
    await history.execute(new TransitionCommand(
      1, "2026-001", "submitted", "published",
      mockWorkflowRepo({ canTransition: false }),
    ));

    const entry = history.getLog()[0];
    expect(entry.result).toBe("err");
    expect(entry.error).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════
//  COMPOSITE
// ═══════════════════════════════════════════════════════════

describe("Composite Command", () => {
  it("CompositeCommand executes all commands in order", async () => {
    effects.length = 0;
    const repo = mockWorkflowRepo();
    const composite = new CompositeCommand([
      trackingTransition("A", repo),
      trackingTransition("B", repo),
      trackingTransition("C", repo),
    ]);
    await composite.execute();
    expect(effects).toEqual(["A", "B", "C"]);
  });

  it("first failure stops the chain (leftmost error wins)", async () => {
    effects.length = 0;
    const failRepo = mockWorkflowRepo({ canTransition: false });
    const okRepo = mockWorkflowRepo();

    const composite = new CompositeCommand([
      trackingTransition("A", okRepo),
      new TransitionCommand(1, "2026-001", "submitted", "published", failRepo),
      trackingTransition("C", okRepo),
    ]);

    const result = await composite.execute();
    expect(result.tag).toBe("err");
    expect(effects).toEqual(["A"]); // C never ran
  });
});
