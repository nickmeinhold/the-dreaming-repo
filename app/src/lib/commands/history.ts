/**
 * Command History — Audit Trail
 *
 * Records every executed command with its result and timestamp.
 * The history is append-only — commands are never removed.
 */

import type { Command, HistoryEntry } from "./types";

export class CommandHistory {
  private entries: HistoryEntry[] = [];

  async execute(cmd: Command): Promise<HistoryEntry> {
    const record = cmd.toJSON();
    const timestamp = new Date();

    const result = await cmd.execute();
    const entry: HistoryEntry = result.isOk()
      ? { record, result: "ok", timestamp }
      : { record, result: "err", error: result.error, timestamp };

    this.entries.push(entry);
    return entry;
  }

  getLog(): ReadonlyArray<HistoryEntry> {
    return this.entries;
  }
}
