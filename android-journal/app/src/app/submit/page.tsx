import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SubmissionForm } from "@/components/paper/submission-form";

export default async function SubmitPage() {
  const session = await getSession();
  if (!session) {
    // Fall back to dev login when OAuth is not configured
    const hasOAuth = !!process.env.GITHUB_CLIENT_ID;
    redirect(hasOAuth ? "/api/auth/github" : "/api/auth/dev-login");
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-2 font-serif text-3xl font-bold">Submit a Paper</h1>
      <p className="mb-8 text-muted">
        Upload your paper as PDF. LaTeX source is optional but encouraged.
        All submissions are peer-reviewed.
      </p>
      <SubmissionForm />
    </div>
  );
}
