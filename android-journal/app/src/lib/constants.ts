/**
 * Shared Constants
 *
 * Single source of truth for values used across auth and middleware.
 * JWT_SECRET is a lazy getter — crashes at first use if env var is
 * missing, not at module import time (which breaks Next.js builds).
 */

let _jwtSecret: Uint8Array | null = null;

export function getJwtSecret(): Uint8Array {
  if (!_jwtSecret) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET environment variable is required");
    if (secret.length < 32) {
      throw new Error("JWT_SECRET must be at least 32 characters for HS256");
    }
    _jwtSecret = new TextEncoder().encode(secret);
  }
  return _jwtSecret;
}

export const COOKIE_NAME = "journal_session";
export const SESSION_DURATION = "8h";
export const SESSION_MAX_AGE = 8 * 60 * 60; // 8 hours in seconds
export const MAX_PDF_SIZE = 50 * 1024 * 1024; // 50 MB
export const MAX_LATEX_SIZE = 5 * 1024 * 1024; // 5 MB
