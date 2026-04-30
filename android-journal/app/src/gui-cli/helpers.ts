/**
 * GUI CLI Helpers — Output formatting and error handling
 *
 * Mirrors src/cli/helpers.ts output format so both CLIs produce
 * identical JSON output for downstream consumers.
 */

import type { Command } from "commander";

/** Write data to stdout as JSON or a simple table. */
export function output(data: unknown, cmd: Command): void {
  const format = cmd.optsWithGlobals().format as string;
  if (format === "table" && Array.isArray(data)) {
    if (data.length === 0) {
      console.log("(no results)");
      return;
    }
    console.table(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

/** Write a structured error to stderr as JSON. */
export function outputError(message: string): void {
  console.error(JSON.stringify({ error: message }));
}

/**
 * Thrown for expected failures (validation, not found, auth).
 * Caught by command wrappers and output as structured JSON errors.
 */
export class GuiCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuiCliError";
  }
}

/** Extract --as login from command, throw if missing. */
export function requireLogin(cmd: Command): string {
  const login = cmd.optsWithGlobals().as as string | undefined;
  if (!login) {
    throw new GuiCliError("--as <login> is required for this command");
  }
  return login;
}

/** Get the base URL from command options. */
export function getBaseUrl(cmd: Command): string {
  return (cmd.optsWithGlobals().baseUrl as string) || "http://localhost:3000";
}

/** Get headless setting from command options. */
export function isHeadless(cmd: Command): boolean {
  return !cmd.optsWithGlobals().headed;
}
