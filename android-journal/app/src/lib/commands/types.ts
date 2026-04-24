/**
 * Command Types — The Command Pattern as a Free Monoid
 *
 * Commands form a monoid under sequential composition:
 *   - Identity: NoOpCommand
 *   - Operation: .then() creates a CompositeCommand
 *   - Carrier: all Command implementations
 *
 * Each command produces an audit-ready CommandRecord.
 */

import type { Result } from "@/lib/result";

export interface CommandRecord {
  type: string;
  actorId: number;
  payload: unknown;
  description: string;
}

export interface Command {
  readonly type: string;
  execute(): Promise<Result<void>>;
  describe(): string;
  toJSON(): CommandRecord;
  then(next: Command): Command;
}

export interface HistoryEntry {
  record: CommandRecord;
  result: "ok" | "err";
  error?: string;
  timestamp: Date;
}
