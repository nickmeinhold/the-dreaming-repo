/**
 * Editorial Commands — Concrete Command Implementations
 *
 * TransitionCommand: paper status transitions
 * AssignReviewerCommand: reviewer assignment
 * NoOpCommand: monoid identity
 * CompositeCommand: monoid composition (free monoid = list)
 */

import { ok, err, type Result } from "@/lib/result";
import type { Command, CommandRecord } from "./types";

// ── Repository interface (for testability) ─────────────────

export interface WorkflowRepository {
  canTransition(from: string, to: string): boolean;
  transition(paperId: string, newStatus: string): Promise<Result<void>>;
}

export interface ReviewerRepository {
  isAssigned(paperId: string, reviewerId: number): Promise<boolean>;
  assign(paperId: string, reviewerId: number): Promise<Result<void>>;
}

// ── NoOp (identity element) ────────────────────────────────

export class NoOpCommand implements Command {
  readonly type = "noop";
  constructor(private readonly actorId: number = 0) {}

  async execute(): Promise<Result<void>> {
    return ok(undefined);
  }

  describe(): string {
    return "No operation";
  }

  toJSON(): CommandRecord {
    return {
      type: this.type,
      actorId: this.actorId,
      payload: null,
      description: this.describe(),
    };
  }

  then(next: Command): Command {
    return next; // identity: e ⊗ a = a
  }
}

// ── Transition Command ─────────────────────────────────────

export class TransitionCommand implements Command {
  readonly type = "transition";

  constructor(
    private readonly actorId: number,
    private readonly paperId: string,
    private readonly from: string,
    private readonly to: string,
    private readonly repo: WorkflowRepository,
  ) {}

  async execute(): Promise<Result<void>> {
    if (!this.repo.canTransition(this.from, this.to)) {
      return err(`Cannot transition from "${this.from}" to "${this.to}"`);
    }
    return this.repo.transition(this.paperId, this.to);
  }

  describe(): string {
    return `Transition ${this.paperId} from ${this.from} to ${this.to}`;
  }

  toJSON(): CommandRecord {
    return {
      type: this.type,
      actorId: this.actorId,
      payload: { paperId: this.paperId, from: this.from, to: this.to },
      description: this.describe(),
    };
  }

  then(next: Command): Command {
    return new CompositeCommand([this, next]);
  }
}

// ── Assign Reviewer Command ────────────────────────────────

export class AssignReviewerCommand implements Command {
  readonly type = "assign-reviewer";

  constructor(
    private readonly actorId: number,
    private readonly paperId: string,
    private readonly reviewerId: number,
    private readonly repo: ReviewerRepository,
  ) {}

  async execute(): Promise<Result<void>> {
    const alreadyAssigned = await this.repo.isAssigned(
      this.paperId,
      this.reviewerId,
    );
    if (alreadyAssigned) {
      return err("Reviewer already assigned");
    }
    return this.repo.assign(this.paperId, this.reviewerId);
  }

  describe(): string {
    return `Assign reviewer ${this.reviewerId} to ${this.paperId}`;
  }

  toJSON(): CommandRecord {
    return {
      type: this.type,
      actorId: this.actorId,
      payload: { paperId: this.paperId, reviewerId: this.reviewerId },
      description: this.describe(),
    };
  }

  then(next: Command): Command {
    return new CompositeCommand([this, next]);
  }
}

// ── Composite Command (free monoid = list) ─────────────────

export class CompositeCommand implements Command {
  readonly type = "composite";
  readonly commands: readonly Command[];

  constructor(commands: Command[]) {
    // Flatten nested composites for associativity
    this.commands = commands.flatMap((c) =>
      c instanceof CompositeCommand ? c.commands : [c],
    );
  }

  async execute(): Promise<Result<void>> {
    for (const cmd of this.commands) {
      const result = await cmd.execute();
      if (result.isErr()) return result;
    }
    return ok(undefined);
  }

  describe(): string {
    return this.commands.map((c) => c.describe()).join(" → ");
  }

  toJSON(): CommandRecord {
    return {
      type: this.type,
      actorId: 0,
      payload: { commands: this.commands.map((c) => c.toJSON()) },
      description: this.describe(),
    };
  }

  then(next: Command): Command {
    return new CompositeCommand([...this.commands, next]);
  }
}
