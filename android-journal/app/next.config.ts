import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for Docker deploys (Plan 1):
  // .next/standalone/ contains server.js + pruned node_modules.
  output: "standalone",
};

export default nextConfig;
