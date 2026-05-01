"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { EDITOR_ROLES } from "@/lib/paper-access";
import { logAuditEvent } from "@/lib/audit";
import { withActionTrace } from "@/lib/trace";

const VALID_TYPES = ["autonomous", "claude-human", "human"];
const VALID_ROLES = ["user", "editor", "admin"];

export async function createUser(formData: FormData): Promise<{ success: boolean; error?: string; githubLogin?: string }> {
  return withActionTrace("action.user.create", async (trace) => {
    const session = await getSession();
    if (!session || !EDITOR_ROLES.includes(session.role)) {
      trace.fail("auth", "not admin");
      return { success: false, error: "Admin access required" };
    }
    trace.mark("auth");

    const login = (formData.get("login") as string)?.trim();
    const name = (formData.get("name") as string)?.trim();
    const type = (formData.get("type") as string)?.trim();
    const role = (formData.get("role") as string)?.trim() || "user";
    const rawGithubId = (formData.get("githubId") as string)?.trim();
    // Generate a unique githubId if not provided — use timestamp + random to avoid collisions
    const githubId = rawGithubId && rawGithubId !== "0"
      ? parseInt(rawGithubId)
      : Date.now() % 1_000_000 + Math.floor(Math.random() * 1000);
    const human = (formData.get("human") as string)?.trim() || null;

    if (!login || !name || !type) {
      trace.fail("validate", "missing fields");
      return { success: false, error: "Login, name, and type are required" };
    }
    if (!VALID_TYPES.includes(type)) {
      trace.fail("validate", "invalid type");
      return { success: false, error: `Invalid type: ${type}. Must be: ${VALID_TYPES.join(", ")}` };
    }
    if (!VALID_ROLES.includes(role)) {
      trace.fail("validate", "invalid role");
      return { success: false, error: `Invalid role: ${role}. Must be: ${VALID_ROLES.join(", ")}` };
    }
    trace.mark("validate");

    const existing = await prisma.user.findUnique({ where: { githubLogin: login } });
    if (existing) {
      trace.fail("check-unique", "login exists");
      return { success: false, error: `User "${login}" already exists` };
    }

    let user;
    try {
      user = await prisma.user.create({
        data: {
          githubLogin: login,
          githubId,
          displayName: name,
          authorType: type,
          humanName: human,
          role,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      trace.fail("create", msg);
      return { success: false, error: `Failed to create user: ${msg.includes("Unique") ? "githubId conflict — try a different value" : msg}` };
    }
    trace.mark("create");

    await logAuditEvent({
      action: "user.created",
      entity: "user",
      entityId: String(user.id),
      details: JSON.stringify({ login, type, role }),
    });

    return { success: true, githubLogin: login };
  });
}

export async function promoteUser(login: string, newRole: string): Promise<{ success: boolean; error?: string; role?: string }> {
  return withActionTrace("action.user.promote", async (trace) => {
    const session = await getSession();
    if (!session || session.role !== "admin") {
      trace.fail("auth", "not admin");
      return { success: false, error: "Admin access required" };
    }
    trace.mark("auth");

    if (!VALID_ROLES.includes(newRole)) {
      trace.fail("validate", "invalid role");
      return { success: false, error: `Invalid role: ${newRole}. Must be: ${VALID_ROLES.join(", ")}` };
    }

    const user = await prisma.user.findUnique({ where: { githubLogin: login } });
    if (!user) {
      trace.fail("lookup", "not found");
      return { success: false, error: `User "${login}" not found` };
    }
    trace.mark("lookup");

    await prisma.user.update({
      where: { githubLogin: login },
      data: { role: newRole },
    });
    trace.mark("update");

    await logAuditEvent({
      action: "user.promoted",
      entity: "user",
      entityId: String(user.id),
      details: JSON.stringify({ login, oldRole: user.role, newRole }),
    });

    return { success: true, role: newRole };
  });
}
