/**
 * Next.js Instrumentation
 *
 * Runs once when the server starts. Logs startup context (Node version,
 * environment, DB connectivity), registers process-level exception
 * handlers, and validates critical env vars in production.
 */

import { logger } from "@/lib/logger";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // ── Startup Context ──────────────────────────────────
    logger.info({
      cat: "system",
      node: process.version,
      env: process.env.NODE_ENV ?? "development",
      pid: process.pid,
      platform: process.platform,
      logLevel: process.env.LOG_LEVEL ?? "info",
    }, "server starting");

    // ── Process Error Handlers ───────────────────────────
    process.on("uncaughtException", (err) => {
      logger.fatal({ cat: "system", err }, "FATAL uncaughtException");
      process.exit(1);
    });

    process.on("unhandledRejection", (reason) => {
      logger.fatal({ cat: "system", reason }, "FATAL unhandledRejection");
      process.exit(1);
    });

    process.on("SIGTERM", () => {
      logger.info("SIGTERM received, draining connections...");
      import("@/lib/db").then(({ prisma }) =>
        Promise.race([
          prisma.$disconnect(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("disconnect timeout")), 5000)),
        ])
      ).catch(() => {}).finally(() => process.exit(0));
    });

    process.on("SIGINT", () => {
      logger.info("SIGINT received, shutting down...");
      process.exit(0);
    });

    // ── DB Connectivity Check ────────────────────────────
    try {
      const { prisma } = await import("@/lib/db");
      await prisma.$queryRawUnsafe("SELECT 1");
      logger.info({ cat: "db" }, "database connected");
    } catch (err) {
      logger.error({ cat: "db", err }, "database connection failed on startup");
      // Don't exit — DB might come up later (e.g. Docker Compose ordering)
    }

    // ── Production Env Guards ────────────────────────────
    if (process.env.NODE_ENV === "production") {
      if (!process.env.JWT_SECRET) {
        logger.error("JWT_SECRET not set — refusing to start without session signing key in production");
        process.exit(1);
      }
      if (process.env.JWT_SECRET.length < 32) {
        logger.error("JWT_SECRET is too short — must be at least 32 characters");
        process.exit(1);
      }
      if (!process.env.DATABASE_URL) {
        logger.error("DATABASE_URL not set — refusing to start without database connection in production");
        process.exit(1);
      }
      if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
        logger.warn("GitHub OAuth not configured — login will fail");
      }
      if (!process.env.RESEND_API_KEY) {
        logger.warn("RESEND_API_KEY not set — alert emails will be logged to console only");
      }

      logger.info("production env checks passed");
    } else {
      if (!process.env.RESEND_API_KEY) {
        logger.warn("RESEND_API_KEY not set — alert emails will be logged to console only");
      }
    }

    logger.info("instrumentation complete");
  }
}
