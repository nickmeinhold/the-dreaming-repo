/**
 * Story CLI Runner
 *
 * Spawns CLI commands as subprocesses with BATCH_ID in the environment,
 * so every command's audit trail is linked to the story run.
 *
 * Modeled on src/__tests__/integration/cli-helpers.ts but for the
 * main database (not test DB) and with progress logging.
 */

import { execFile, type ExecFileException } from "node:child_process";
import path from "node:path";

const CLI_PATH = path.resolve(__dirname, "../../src/cli.ts");
const TSX_PATH = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const APP_DIR = path.resolve(__dirname, "../..");

export interface StoryResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a CLI command with BATCH_ID set. Returns parsed JSON from stdout.
 * Throws on non-zero exit code with stderr details.
 */
export async function run<T = unknown>(
  batchId: string,
  args: string[],
  label?: string,
): Promise<T> {
  const result = await exec(batchId, args);

  if (result.code !== 0) {
    let errorMsg: string;
    try {
      const parsed = JSON.parse(result.stderr) as { error: string };
      errorMsg = parsed.error;
    } catch {
      errorMsg = result.stderr || `exit code ${result.code}`;
    }
    throw new Error(`CLI failed: ${args.join(" ")}\n  ${errorMsg}`);
  }

  let data: T;
  try {
    data = JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(`CLI returned non-JSON stdout: ${result.stdout.slice(0, 200)}`);
  }

  if (label) {
    console.log(`  ${label}`);
  }

  return data;
}

/**
 * Run a CLI command expecting failure. Returns the error message.
 * Throws if the command unexpectedly succeeds.
 */
export async function runExpectError(
  batchId: string,
  args: string[],
  label?: string,
): Promise<string> {
  const result = await exec(batchId, args);

  if (result.code === 0) {
    throw new Error(`Expected failure but command succeeded: ${args.join(" ")}`);
  }

  let errorMsg: string;
  try {
    const parsed = JSON.parse(result.stderr) as { error: string };
    errorMsg = parsed.error;
  } catch {
    errorMsg = result.stderr || `exit code ${result.code}`;
  }

  if (label) {
    console.log(`  ✗ ${label} → ${errorMsg}`);
  }

  return errorMsg;
}

function exec(batchId: string, args: string[]): Promise<StoryResult> {
  return new Promise((done) => {
    execFile(
      TSX_PATH,
      [CLI_PATH, ...args],
      {
        env: {
          ...process.env,
          BATCH_ID: batchId,
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
