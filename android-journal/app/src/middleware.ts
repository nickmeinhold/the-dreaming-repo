/**
 * Next.js Edge Middleware — Request Logging, Security Headers, CSRF, Rate Limiting
 *
 * Runs before every request. Logs every request with method, path,
 * status, and duration. Adds security headers to all responses,
 * checks Origin header on mutations, and applies basic rate limiting.
 *
 * Edge runtime: cannot use Pino or Prisma. Uses console.log with
 * structured JSON so log aggregators can parse it.
 */

import { NextRequest, NextResponse } from "next/server";

// ── Security Headers ──────────────────────────────────────

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

const CSP = [
  "default-src 'self'",
  "img-src 'self' github.com *.githubusercontent.com data:",
  "style-src 'self' 'unsafe-inline'",
  process.env.NODE_ENV === "production"
    ? "script-src 'self'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
].join("; ");

// ── Rate Limiting (in-memory, single-instance) ────────────

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = process.env.NODE_ENV === "production" ? 120 : 1000; // per window per IP
const buckets = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  bucket.count++;
  return bucket.count > MAX_REQUESTS;
}

// Periodic cleanup to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(ip);
  }
}, WINDOW_MS);

// ── CSRF Protection ───────────────────────────────────────

function isCsrfSafe(request: NextRequest): boolean {
  const method = request.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  const origin = request.headers.get("origin");
  if (!origin) return false; // No Origin header on mutation = reject

  const url = new URL(request.url);
  return origin === url.origin;
}

// ── Request Logging ───────────────────────────────────────

function logRequest(
  method: string,
  path: string,
  status: number,
  ms: number,
  ip: string,
) {
  // Structured JSON for log aggregators — same shape as Pino but from Edge runtime
  console.log(JSON.stringify({
    level: status >= 500 ? 50 : status >= 400 ? 40 : 30,
    time: Date.now(),
    cat: "request",
    msg: `${method} ${path} ${status} ${ms}ms`,
    method,
    path,
    status,
    ms,
    ip,
  }));
}

// ── Middleware ─────────────────────────────────────────────

export function middleware(request: NextRequest) {
  const start = Date.now();
  const method = request.method;
  const path = request.nextUrl.pathname;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "unknown";

  // Rate limiting
  if (isRateLimited(ip)) {
    logRequest(method, path, 429, Date.now() - start, ip);
    return new NextResponse("Too Many Requests", { status: 429 });
  }

  // CSRF check for non-GET API routes and server actions
  const isApi = path.startsWith("/api/");
  if (isApi && !isCsrfSafe(request)) {
    logRequest(method, path, 403, Date.now() - start, ip);
    return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
  }

  // Proceed with security headers
  const response = NextResponse.next();

  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  response.headers.set("Content-Security-Policy", CSP);

  // HSTS in production only
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  // Edge middleware runs before the route handler and cannot observe the
  // response status it produces. We log status 200 here as a signal that
  // the request was accepted past middleware. Actual error statuses (4xx/5xx)
  // are logged separately by RouteBuilder and withActionTrace at the handler level.
  logRequest(method, path, 200, Date.now() - start, ip);

  return response;
}

export const config = {
  matcher: [
    // Match all routes except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
