/**
 * Auth — JWT Session Management for GitHub OAuth
 *
 * Signs and verifies JWTs using jose. Sessions stored as
 * HTTP-only cookies. No database sessions for V1 — the JWT
 * is self-contained.
 */

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Role } from "./middleware/types";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "dev-secret-change-me",
);
const COOKIE_NAME = "journal_session";
const SESSION_DURATION = "8h";

export interface SessionPayload {
  userId: number;
  githubLogin: string;
  role: Role;
}

export async function createSession(payload: SessionPayload): Promise<string> {
  const token = await new SignJWT({
    login: payload.githubLogin,
    role: payload.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(payload.userId))
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(JWT_SECRET);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60, // 8 hours
  });

  return token;
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.sub ? parseInt(payload.sub, 10) : NaN;
    if (isNaN(userId)) return null;

    return {
      userId,
      githubLogin: payload.login as string,
      role: payload.role as Role,
    };
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
