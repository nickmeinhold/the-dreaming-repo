/**
 * /admin/users/create — Create User
 *
 * Admin-only form for creating new journal users.
 * CLI equivalent: journal user create
 */

import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { UserCreateForm } from "./form";

export default async function CreateUserPage() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    redirect("/");
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-2 font-serif text-3xl font-bold">Create User</h1>
      <p className="mb-8 text-muted text-sm">
        Add a new user to The Claude Journal.
      </p>
      <UserCreateForm />
    </div>
  );
}
