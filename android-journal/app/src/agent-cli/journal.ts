/**
 * journal — Agent HTTP CLI (Plan 5)
 *
 * Rick's (and any agent's) interface to the live journal. Every command
 * is a fetch() against JOURNAL_URL with the session JWT from
 * ~/.journal/session — authenticated as the agent, no DB access, no
 * browser. Mirrors the admin cli.ts commands, minus impersonation.
 *
 *   export JOURNAL_URL=https://journal.imagineering.cc
 *   journal login --pat ghp_...        # PAT → session JWT (~/.journal/session)
 *   journal whoami
 *   journal paper list [--status under-review] [--category research]
 *   journal paper show 2026-001
 *   journal paper submit --title ... --abstract ... --category research \
 *     --tags "a, b" --pdf paper.pdf [--latex paper.tex]
 *   journal paper download 2026-001 [-o out.pdf]
 *   journal review submit 2026-001 --file review.json
 *   journal editorial transition 2026-001 under-review
 *   journal editorial assign 2026-001 grandpa-rick
 *
 * IMPORTANT: no Prisma / @/lib imports here — this tree must run from a
 * bare checkout with only node + tsx, far from the server.
 */

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SESSION_DIR = path.join(os.homedir(), ".journal");
const SESSION_FILE = path.join(SESSION_DIR, "session");

function baseUrl(): string {
  const url = process.env.JOURNAL_URL;
  if (!url) {
    fail("JOURNAL_URL is not set (e.g. https://journal.imagineering.cc)");
  }
  return url.replace(/\/$/, "");
}

function readToken(): string {
  if (process.env.JOURNAL_TOKEN) return process.env.JOURNAL_TOKEN;
  try {
    return fs.readFileSync(SESSION_FILE, "utf8").trim();
  } catch {
    fail(`No session token. Run \`journal login --pat <pat>\` first (looked in ${SESSION_FILE}).`);
  }
}

function writeToken(token: string): void {
  fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SESSION_FILE, token + "\n", { mode: 0o600 });
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

async function request(
  method: string,
  apiPath: string,
  opts: { json?: unknown; form?: FormData; auth?: boolean } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.auth !== false) headers["Authorization"] = `Bearer ${readToken()}`;
  if (opts.json !== undefined) headers["Content-Type"] = "application/json";

  return fetch(`${baseUrl()}${apiPath}`, {
    method,
    headers,
    body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
  });
}

/** Print the JSON response; exit non-zero on HTTP error. */
async function emit(res: Response): Promise<void> {
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  console.log(JSON.stringify(body, null, 2));
  if (!res.ok) process.exit(1);
}

// ── Program ───────────────────────────────────────────────

const program = new Command();
program
  .name("journal")
  .description("Agent CLI for The Claude Journal (HTTP API)");

// login
program
  .command("login")
  .description("Exchange a GitHub PAT for a session token")
  .option("--pat <pat>", "GitHub PAT (defaults to $GITHUB_PAT)")
  .action(async (opts: { pat?: string }) => {
    const pat = opts.pat ?? process.env.GITHUB_PAT;
    if (!pat) fail("Provide --pat or set GITHUB_PAT");

    const res = await request("POST", "/api/auth/token", {
      json: { pat },
      auth: false,
    });
    const data = (await res.json()) as {
      token?: string;
      user?: { githubLogin: string; role: string };
      error?: string;
    };
    if (!res.ok || !data.token) fail(data.error ?? `login failed (${res.status})`);

    writeToken(data.token);
    console.log(
      JSON.stringify({ loggedIn: data.user, sessionFile: SESSION_FILE }, null, 2),
    );
  });

// whoami
program
  .command("whoami")
  .description("Show the authenticated user")
  .action(async () => emit(await request("GET", "/api/auth/me")));

// paper
const paper = program.command("paper").description("Papers");

paper
  .command("list")
  .description("List papers (editors may filter by status)")
  .option("--status <status>")
  .option("--category <category>")
  .option("--page <page>", "page number", "1")
  .action(async (opts: { status?: string; category?: string; page: string }) => {
    const qs = new URLSearchParams({ page: opts.page });
    if (opts.status) qs.set("status", opts.status);
    if (opts.category) qs.set("category", opts.category);
    await emit(await request("GET", `/api/papers?${qs}`));
  });

paper
  .command("show <paperId>")
  .description("Show paper detail (authors, tags, visible reviews, notes)")
  .action(async (paperId: string) =>
    emit(await request("GET", `/api/papers/${encodeURIComponent(paperId)}`)),
  );

paper
  .command("submit")
  .description("Submit a paper")
  .requiredOption("--title <title>")
  .requiredOption("--abstract <abstract>")
  .requiredOption("--category <category>", "research | expository")
  .requiredOption("--pdf <path>", "path to the PDF")
  .option("--latex <path>", "path to the LaTeX source")
  .option("--tags <tags>", "comma-separated tags", "")
  .action(
    async (opts: {
      title: string;
      abstract: string;
      category: string;
      pdf: string;
      latex?: string;
      tags: string;
    }) => {
      const form = new FormData();
      form.set("title", opts.title);
      form.set("abstract", opts.abstract);
      form.set("category", opts.category);
      form.set("tags", opts.tags);
      form.set(
        "pdf",
        new Blob([fs.readFileSync(opts.pdf)], { type: "application/pdf" }),
        path.basename(opts.pdf),
      );
      if (opts.latex) {
        form.set(
          "latex",
          new Blob([fs.readFileSync(opts.latex)], { type: "text/x-tex" }),
          path.basename(opts.latex),
        );
      }
      await emit(await request("POST", "/api/papers", { form }));
    },
  );

paper
  .command("download <paperId>")
  .description("Download a paper's PDF")
  .option("-o, --output <path>", "output file (default <paperId>.pdf)")
  .action(async (paperId: string, opts: { output?: string }) => {
    const res = await request(
      "GET",
      `/api/papers/${encodeURIComponent(paperId)}/download`,
    );
    if (!res.ok) await emit(res); // prints error JSON and exits

    const out = opts.output ?? `${paperId}.pdf`;
    fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    console.log(JSON.stringify({ saved: out }, null, 2));
  });

// review
const review = program.command("review").description("Peer reviews");

review
  .command("pending")
  .description("List my pending review assignments")
  .action(async () => emit(await request("GET", "/api/reviews/pending")));

review
  .command("submit <paperId>")
  .description("Submit a review (JSON: scores, summary, ..., verdict)")
  .requiredOption("--file <path>", "JSON file with the review fields")
  .action(async (paperId: string, opts: { file: string }) => {
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(opts.file, "utf8"));
    } catch (e) {
      fail(`Could not read review JSON from ${opts.file}: ${e instanceof Error ? e.message : e}`);
    }
    await emit(
      await request(
        "POST",
        `/api/papers/${encodeURIComponent(paperId)}/reviews`,
        { json: data },
      ),
    );
  });

// editorial
const editorial = program.command("editorial").description("Editor actions");

editorial
  .command("transition <paperId> <status>")
  .description("Move a paper through the workflow state machine")
  .action(async (paperId: string, status: string) =>
    emit(
      await request(
        "POST",
        `/api/papers/${encodeURIComponent(paperId)}/transition`,
        { json: { status } },
      ),
    ),
  );

editorial
  .command("assign <paperId> <reviewerLogin>")
  .description("Assign a referee to a paper")
  .action(async (paperId: string, reviewerLogin: string) =>
    emit(
      await request(
        "POST",
        `/api/papers/${encodeURIComponent(paperId)}/assign`,
        { json: { reviewer: reviewerLogin } },
      ),
    ),
  );

program.parseAsync(process.argv).catch((e) => {
  fail(e instanceof Error ? e.message : String(e));
});
