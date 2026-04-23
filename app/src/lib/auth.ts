/**
 * Auth — JWT Session Management for GitHub OAuth
 *
 * Signs and verifies JWTs using jose. Sessions stored as
 * HTTP-only cookies. No database sessions for V1 — the JWT
 * is self-contained.
 */

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getJwtSecret, COOKIE_NAME, SESSION_DURATION, SESSION_MAX_AGE } from "./constants";
import type { Role } from "./middleware/types";

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
    .sign(getJwtSecret());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  return token;
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
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
