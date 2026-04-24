/**
 * CLI E2E Test Helpers
 *
 * Spawns the CLI as a child process and captures output.
 * Each invocation is a real `npx tsx src/cli.ts ...` subprocess
 * hitting the test database via DATABASE_URL.
 */

import { execFile, type ExecFileException } from "node:child_process";
import path from "node:path";

const CLI_PATH = path.resolve(__dirname, "../../cli.ts");
const TSX_PATH = path.resolve(__dirname, "../../../node_modules/.bin/tsx");
const APP_DIR = path.resolve(__dirname, "../../..");

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a CLI command and return { code, stdout, stderr }.
 * Never throws — check code for success/failure.
 */
export function runCli(...args: string[]): Promise<CliResult> {
  return new Promise((done) => {
    execFile(
      TSX_PATH,
      [CLI_PATH, ...args],
      {
        env: {
          ...process.env,
          // Use the test database (same as vitest.integration.config.ts)
          DATABASE_URL:
            "postgresql://journal:journal_dev@localhost:5432/claude_journal_test",
          // Silence Pino so trace output doesn't mix with CLI JSON on stdout.
          // Traces still write to AuditLog (DB) — only console output is suppressed.
          LOG_LEVEL: "silent",
        },
        timeout: 30_000,
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

/** Run CLI and parse stdout as JSON. Throws if output isn't valid JSON. */
export async function runCliJson<T = unknown>(...args: string[]): Promise<{ data: T; result: CliResult }> {
  const result = await runCli(...args);
  const data = JSON.parse(result.stdout) as T;
  return { data, result };
}

/** Run CLI expecting failure. Returns parsed error from stderr. */
export async function runCliError(...args: string[]): Promise<{ error: string; result: CliResult }> {
  const result = await runCli(...args);
  const parsed = JSON.parse(result.stderr) as { error: string };
  return { error: parsed.error, result };
}
