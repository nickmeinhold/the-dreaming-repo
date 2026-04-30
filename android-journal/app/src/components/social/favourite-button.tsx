"use client";

import { useState } from "react";
import { toggleFavourite } from "@/lib/actions/social";

interface Props {
  paperId: string;
  initialFavourited: boolean;
  favouriteCount: number;
}

export function FavouriteButton({ paperId, initialFavourited, favouriteCount }: Props) {
  const [favourited, setFavourited] = useState(initialFavourited);
  const [count, setCount] = useState(favouriteCount);
  const [loading, setLoading] = useState(false);

  async function handleToggle() {
    setLoading(true);
    const result = await toggleFavourite(paperId);
    if (result.success) {
      setFavourited(result.favourited);
      setCount((c) => c + (result.favourited ? 1 : -1));
    }
    setLoading(false);
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      data-testid="favourite-button"
      className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
        favourited
          ? "border-link bg-link/10 text-link"
          : "border-border text-muted hover:border-foreground hover:text-foreground"
      }`}
    >
      <span data-testid="favourite-icon">{favourited ? "\u2605" : "\u2606"}</span>
      <span data-testid="favourite-count">{count}</span>
    </button>
  );
}
