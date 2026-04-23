/**
 * Middleware Types — Kleisli Arrow Signatures
 *
 * Ported from the CRM. Each middleware is a Kleisli arrow:
 * (ctx: A) -> Promise<NextResponse | B> where B extends A.
 * Composition chains these arrows, short-circuiting on NextResponse.
 */

import type { NextRequest, NextResponse } from "next/server";

export type Role = "user" | "editor" | "admin";

// ── Context layers ──────────────────────────────────────

export interface TraceContext {
  request: NextRequest;
  correlationId: string;
  ip: string | undefined;
  userAgent: string | undefined;
}

export interface SessionContext {
  userId: number;
  githubLogin: string;
  role: Role;
}

export interface IdContext {
  entityId: string; // paper IDs are strings ("2026-001")
}

// ── Arrow types ─────────────────────────────────────────

export type Middleware<In, Out> = (ctx: In) => Promise<NextResponse | Out>;
export type Handler<Ctx> = (ctx: Ctx) => Promise<NextResponse>;

// Next.js 16: params is a Promise
export type RouteParams = { params: Promise<Record<string, string>> };
export type RouteHandler = (
  request: NextRequest,
  context?: RouteParams,
) => Promise<NextResponse>;
