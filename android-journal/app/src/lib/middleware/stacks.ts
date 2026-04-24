/**
 * Pre-Composed Middleware Stacks
 *
 * publicRoute  — trace only (paper browsing, search)
 * authRoute    — trace + session (notes, favourites)
 * editorRoute  — trace + session + editor role (status transitions)
 * adminRoute   — trace + session + admin role
 */

import { route } from "./builder";
import { withTrace } from "./with-trace";
import { withSession } from "./with-session";
import { withRole } from "./with-role";

export function publicRoute() {
  return route().use(withTrace);
}

export function authRoute() {
  return route().use(withTrace).use(withSession);
}

export function editorRoute() {
  return route().use(withTrace).use(withSession).use(withRole("editor"));
}

export function adminRoute() {
  return route().use(withTrace).use(withSession).use(withRole("admin"));
}
