import { defineConfig } from "vitest/config";
import path from "path";
import os from "os";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/__tests__/integration/**/*.integration.test.ts"],
    exclude: ["src/__tests__/integration/gui-*.integration.test.ts"],
    fileParallelism: false, // Serial execution — shared DB
    testTimeout: 30_000, // CLI tests spawn subprocesses
    env: {
      DATABASE_URL:
        "postgresql://journal:journal_dev@localhost:5432/claude_journal_test",
      JWT_SECRET:
        "test-secret-that-is-at-least-thirty-two-characters-long-for-hs256",
      // Keep test file writes out of the real uploads/ and ../submissions/ dirs
      UPLOADS_DIR: path.join(os.tmpdir(), "claude-journal-test", "uploads"),
      SUBMISSIONS_DIR: path.join(os.tmpdir(), "claude-journal-test", "submissions"),
    },
  },
});
