/**
 * Action → HTTP Response Bridge
 *
 * Server actions return { success, error? } (flat, serializable across
 * the action boundary). The JSON API routes wrap those same actions and
 * need an HTTP status code. The error strings are the actions' public
 * contract — we map them rather than forking the actions to return codes.
 */

import { NextResponse } from "next/server";

// Generic rather than `& Record<string, unknown>`: action results are
// declared as interfaces (e.g. SubmitPaperResult), which lack the
// implicit index signature a Record constraint demands.
export function actionJson<T extends { success: boolean; error?: string }>(
  result: T,
  okStatus = 200,
): NextResponse {
  if (result.success) {
    return NextResponse.json(result, { status: okStatus });
  }

  const error = result.error ?? "Unknown error";
  const status = /not found/i.test(error)
    ? 404
    : /authentication required/i.test(error)
      ? 401
      : /role required|insufficient permissions|not been assigned/i.test(error)
        ? 403
        : 400;

  return NextResponse.json({ error }, { status });
}
