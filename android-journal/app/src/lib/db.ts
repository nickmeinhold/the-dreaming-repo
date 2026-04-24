import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalForPrisma = globalThis as unknown as { prisma?: any };

const SLOW_QUERY_MS = 100;
const LOG_QUERIES = process.env.LOG_DB_QUERIES === "true"
  || process.env.NODE_ENV === "production";

function logQuery(model: string, operation: string, ms: number) {
  const level = ms > SLOW_QUERY_MS ? 40 : 30;
  console.log(JSON.stringify({
    level,
    time: Date.now(),
    cat: "db",
    msg: `${model}.${operation} ${ms}ms`,
    model,
    operation,
    ms,
  }));
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

  // Log Prisma warnings and errors
  base.$on?.("warn", (e: { message: string }) => {
    console.log(JSON.stringify({
      level: 40, time: Date.now(), cat: "db",
      msg: "prisma:warn", detail: e.message,
    }));
  });

  base.$on?.("error", (e: { message: string }) => {
    console.log(JSON.stringify({
      level: 50, time: Date.now(), cat: "db",
      msg: "prisma:error", detail: e.message,
    }));
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
          console.log(JSON.stringify({
            level: 50, time: Date.now(), cat: "db",
            msg: `${model ?? "$raw"}.${operation} FAILED ${ms}ms`,
            model: model ?? "$raw", operation, ms,
            error: err instanceof Error ? err.message : String(err),
          }));
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
