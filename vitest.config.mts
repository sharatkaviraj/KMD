import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    // Fork startup exceeded the 60s handshake on this Windows checkout.
    // Threads completed the same suite; bound them to leave room for Next.
    pool: "threads",
    maxWorkers: 2,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
