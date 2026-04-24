import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { logger } from "@/lib/logger";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalForPrisma = globalThis as unknown as { prisma?: any };

const SLOW_QUERY_MS = 100;
const LOG_QUERIES = process.env.LOG_DB_QUERIES === "true"
  || process.env.NODE_ENV === "production";

function logQuery(model: string, operation: string, ms: number) {
  if (ms > SLOW_QUERY_MS) {
    logger.warn({ cat: "db", model, operation, ms }, `${model}.${operation} ${ms}ms`);
  } else {
    logger.info({ cat: "db", model, operation, ms }, `${model}.${operation} ${ms}ms`);
  }
}

function createPrismaClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL environment variable is required");

  const base = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
    log: [
      { level: "warn", emit: "event" },
      { level: "error", emit: "event" },
    ],
  });

  // Log Prisma warnings and errors through Pino
  base.$on?.("warn", (e: { message: string }) => {
    logger.warn({ cat: "db" }, `prisma:warn ${e.message}`);
  });

  base.$on?.("error", (e: { message: string }) => {
    logger.error({ cat: "db" }, `prisma:error ${e.message}`);
  });

  if (!LOG_QUERIES) return base;

  // Intercept every Prisma operation: log model, operation, timing
  return base.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        const start = performance.now();
        return query(args).then((result) => {
          logQuery(model ?? "$raw", operation, Math.round(performance.now() - start));
          return result;
        }).catch((err) => {
          const ms = Math.round(performance.now() - start);
          logger.error(
            { cat: "db", model: model ?? "$raw", operation, ms, error: err instanceof Error ? err.message : String(err) },
            `${model ?? "$raw"}.${operation} FAILED ${ms}ms`,
          );
          throw err;
        });
      },
    },
  });
}

/**
 * Prisma client singleton via globalThis proxy.
 *
 * The Proxy defers client creation until first use,
 * so tests that mock Prisma don't trigger real connections.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_, prop) {
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = createPrismaClient();
    }
    return Reflect.get(globalForPrisma.prisma, prop);
  },
});
