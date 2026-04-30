/**
 * GUI CLI E2E Test Helpers
 *
 * Identical interface to cli-helpers.ts, but spawns gui-cli.ts
 * instead of cli.ts. The GUI CLI launches a headless browser,
 * drives the web frontend, and produces JSON output.
 *
 * Requires a running Next.js dev server on GUI_CLI_BASE_URL
 * (default: http://localhost:3000) pointed at the test database.
 */

import { execFile, type ExecFileException } from "node:child_process";
import path from "node:path";

const GUI_CLI_PATH = path.resolve(__dirname, "../../gui-cli.ts");
const TSX_PATH = path.resolve(__dirname, "../../../node_modules/.bin/tsx");
const APP_DIR = path.resolve(__dirname, "../../..");

const BASE_URL = process.env.GUI_CLI_BASE_URL ?? "http://localhost:3000";

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a GUI CLI command and return { code, stdout, stderr }.
 * Never throws — check code for success/failure.
 *
 * Adds --base-url automatically. Browser runs headless.
 * Timeout is longer than direct CLI (browser startup + navigation).
 */
export function runGuiCli(...args: string[]): Promise<CliResult> {
  return new Promise((done) => {
    execFile(
      TSX_PATH,
      [GUI_CLI_PATH, "--base-url", BASE_URL, ...args],
      {
        env: {
          ...process.env,
          // The GUI CLI doesn't hit the DB directly, but the dev server does.
          // These are here for any direct DB checks in the test assertions.
          DATABASE_URL:
            "postgresql://journal:journal_dev@localhost:5432/claude_journal_test",
          LOG_LEVEL: "silent",
        },
        timeout: 60_000, // Browser startup + page navigation is slower
        cwd: APP_DIR,
      },
      (error: ExecFileException | null, stdout: string, stderr: string) => {
        done({
          code: typeof error?.code === "number" ? error.code : error ? 1 : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

/** Run GUI CLI and parse stdout as JSON. Throws if output isn't valid JSON. */
export async function runGuiCliJson<T = unknown>(...args: string[]): Promise<{ data: T; result: CliResult }> {
  const result = await runGuiCli(...args);
  if (result.code !== 0) {
    throw new Error(
      `GUI CLI exited with code ${result.code}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  const data = JSON.parse(result.stdout) as T;
  return { data, result };
}

/** Run GUI CLI expecting failure. Returns parsed error from stderr. */
export async function runGuiCliError(...args: string[]): Promise<{ error: string; result: CliResult }> {
  const result = await runGuiCli(...args);
  const parsed = JSON.parse(result.stderr) as { error: string };
  return { error: parsed.error, result };
}
