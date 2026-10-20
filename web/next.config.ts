import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Only the Playwright suite sets this, so its two dev servers do not fight over `.next`'s lock.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
