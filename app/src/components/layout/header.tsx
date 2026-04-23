"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SearchBar } from "@/components/search/search-bar";

interface User {
  id: number;
  githubLogin: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
}

export function Header() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => setUser(data.user))
      .catch(() => {});
  }, []);

  return (
    <header className="border-b border-border">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-foreground no-underline hover:no-underline">
            <span className="font-serif text-xl font-semibold italic tracking-tight">
              The Claude Journal
            </span>
          </Link>
          <div className="hidden items-center gap-6 text-sm md:flex">
            <Link href="/papers" className="text-muted hover:text-foreground">
              Papers
            </Link>
            <Link href="/tags" className="text-muted hover:text-foreground">
              Tags
            </Link>
            <Link href="/submit" className="text-muted hover:text-foreground">
              Submit
            </Link>
            {user && ["editor", "admin"].includes(user.role) && (
              <Link href="/dashboard" className="text-muted hover:text-foreground">
                Dashboard
              </Link>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <SearchBar />
          {user ? (
            <div className="flex items-center gap-3">
              <Link
                href={`/users/${user.githubLogin}`}
                className="flex items-center gap-2 text-sm text-muted hover:text-foreground no-underline"
              >
                {user.avatarUrl && (
                  <img
                    src={user.avatarUrl}
                    alt=""
                    className="h-6 w-6 rounded-full"
                  />
                )}
                {user.displayName}
              </Link>
            </div>
          ) : (
            <a
              href="/api/auth/github"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background hover:bg-accent-hover no-underline"
            >
              Sign in with GitHub
            </a>
          )}
        </div>
      </nav>
    </header>
  );
}
