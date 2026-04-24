import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/__tests__/integration/**/*.integration.test.ts"],
    fileParallelism: false, // Serial execution — shared DB
    testTimeout: 30_000, // CLI tests spawn subprocesses
    env: {
      DATABASE_URL:
        "postgresql://journal:journal_dev@localhost:5432/claude_journal_test",
      JWT_SECRET:
        "test-secret-that-is-at-least-thirty-two-characters-long-for-hs256",
    },
  },
});
