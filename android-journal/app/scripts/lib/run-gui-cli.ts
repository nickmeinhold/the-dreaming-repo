/**
 * Story GUI CLI Runner
 *
 * Spawns GUI CLI commands as subprocesses with BATCH_ID in the environment,
 * so every command's audit trail is linked to the story run.
 *
 * Modeled on scripts/lib/run-cli.ts but invokes gui-cli.ts instead.
 * The GUI CLI drives the web frontend via Playwright, threading the
 * BATCH_ID through to backend traces via X-Batch-Id headers.
 */

import { execFile, type ExecFileException } from "node:child_process";
import path from "node:path";

const GUI_CLI_PATH = path.resolve(__dirname, "../../src/gui-cli.ts");
const TSX_PATH = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const APP_DIR = path.resolve(__dirname, "../..");

const BASE_URL = process.env.GUI_CLI_BASE_URL ?? "http://localhost:3000";

export interface StoryResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a GUI CLI command with BATCH_ID set. Returns parsed JSON from stdout.
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
      // GUI CLI outputs multiple lines to stderr (trace log + error)
      // Find the JSON error line
      const lines = result.stderr.trim().split("\n");
      const errorLine = lines.find(l => {
        try { return JSON.parse(l).error; } catch { return false; }
      });
      if (errorLine) {
        const parsed = JSON.parse(errorLine) as { error: string };
        errorMsg = parsed.error;
      } else {
        errorMsg = result.stderr || `exit code ${result.code}`;
      }
    } catch {
      errorMsg = result.stderr || `exit code ${result.code}`;
    }
    throw new Error(`GUI CLI failed: ${args.join(" ")}\n  ${errorMsg}`);
  }

  let data: T;
  try {
    data = JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(`GUI CLI returned non-JSON stdout: ${result.stdout.slice(0, 200)}`);
  }

  if (label) {
    console.log(`  ${label}`);
  }

  return data;
}

/**
 * Run a GUI CLI command expecting failure. Returns the error message.
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
    const lines = result.stderr.trim().split("\n");
    const errorLine = lines.find(l => {
      try { return JSON.parse(l).error; } catch { return false; }
    });
    if (errorLine) {
      const parsed = JSON.parse(errorLine) as { error: string };
      errorMsg = parsed.error;
    } else {
      errorMsg = result.stderr || `exit code ${result.code}`;
    }
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
      [GUI_CLI_PATH, "--base-url", BASE_URL, ...args],
      {
        env: {
          ...process.env,
          BATCH_ID: batchId,
          LOG_LEVEL: "silent",
        },
        timeout: 60_000, // Browser tests are slower
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
