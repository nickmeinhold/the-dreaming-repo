/**
 * Logger — Pino with Auto-Injected Context + Organized File Output
 *
 * Three log files, three purposes:
 *   logs/access.log  — every HTTP request (the traffic log)
 *   logs/error.log   — warnings and errors only (the 3am file)
 *   logs/event.log   — action traces and business events (what users did)
 *
 * stdout always gets everything (for dev terminal + container capture).
 *
 * File output enabled when LOG_DIR is set or NODE_ENV=production.
 * In tests: stdout only.
 *
 * IMPORTANT: node:fs is NOT imported at the top level because this module
 * is bundled by Turbopack for multiple runtimes. fs is loaded lazily
 * inside buildStream() which only runs in Node.js.
 */

import pino, { type DestinationStream, type Level } from "pino";
import { getCorrelationId, getCurrentUserId } from "@/lib/middleware/async-context";

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
const LOG_DIR = process.env.LOG_DIR
  ?? (process.env.NODE_ENV === "production" ? "logs" : null);

/**
 * Custom stream that routes log lines to the right file based on `cat`:
 *   - cat=request → access.log
 *   - cat=anything else → event.log
 *   - level >= warn → error.log
 *   - everything → stdout
 */
function buildStream(): DestinationStream {
  if (!LOG_DIR) {
    return process.stdout;
  }

  // Lazy-load node:fs — not available in Edge/Turbopack bundle resolution
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");

  const dir = path.join(process.cwd(), LOG_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const accessStream = fs.createWriteStream(path.join(dir, "access.log"), { flags: "a" });
  const errorStream = fs.createWriteStream(path.join(dir, "error.log"), { flags: "a" });
  const eventStream = fs.createWriteStream(path.join(dir, "event.log"), { flags: "a" });

  const router: DestinationStream = {
    write(chunk: string) {
      process.stdout.write(chunk);

      try {
        const parsed = JSON.parse(chunk);

        if (parsed.cat === "request" || (parsed.method && parsed.path)) {
          accessStream.write(chunk);
        }

        if (parsed.level >= 40) {
          errorStream.write(chunk);
        }

        if (parsed.trace || (parsed.cat && parsed.cat !== "request")) {
          eventStream.write(chunk);
        }
      } catch {
        eventStream.write(chunk);
      }

      return true;
    },
  } as DestinationStream;

  return router;
}

export const logger = pino(
  {
    level: LOG_LEVEL as Level,
    mixin() {
      return {
        correlationId: getCorrelationId(),
        userId: getCurrentUserId(),
      };
    },
  },
  buildStream(),
);
