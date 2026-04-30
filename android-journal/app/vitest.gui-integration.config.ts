/**
 * Vitest config for GUI CLI integration tests.
 *
 * Same as vitest.integration.config.ts but:
 * - Only runs gui-* test files
 * - Longer timeout (browser startup + page navigation)
 * - Requires a running Next.js dev server pointed at the test database
 *
 * Usage:
 *   # 1. Start dev server against test DB:
 *   DATABASE_URL="postgresql://journal:journal_dev@localhost:5432/claude_journal_test" npm run dev
 *
 *   # 2. Run GUI tests:
 *   npm run test:gui-integration
 */

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/__tests__/integration/gui-*.integration.test.ts"],
    fileParallelism: false, // Serial execution — shared DB
    testTimeout: 60_000, // Browser tests are slower
    env: {
      DATABASE_URL:
        "postgresql://journal:journal_dev@localhost:5432/claude_journal_test",
      JWT_SECRET:
        "test-secret-that-is-at-least-thirty-two-characters-long-for-hs256",
      GUI_CLI_BASE_URL: "http://localhost:3000",
    },
  },
});
