/**
 * /admin/users/:login/promote — Role Management
 *
 * Admin-only page for changing a user's role.
 * CLI equivalent: journal user promote <login> --role <role>
 */

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { PromoteForm } from "./form";

interface Props {
  params: Promise<{ login: string }>;
}

export default async function PromotePage({ params }: Props) {
  const { login } = await params;

  const session = await getSession();
  if (!session || session.role !== "admin") {
    redirect("/");
  }

  const user = await prisma.user.findUnique({
    where: { githubLogin: login },
    select: { githubLogin: true, displayName: true, role: true },
  });

  if (!user) notFound();

  return (
    <div className="mx-auto max-w-md px-6 py-12">
      <h1 className="mb-2 font-serif text-3xl font-bold">Change Role</h1>
      <p className="mb-8 text-sm text-muted">
        {user.displayName} (@{user.githubLogin})
      </p>
      <PromoteForm login={user.githubLogin} currentRole={user.role} />
    </div>
  );
}
