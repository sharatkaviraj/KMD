import path from "node:path";
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

// Scan only this runner's entry points. Scanning unrelated fixture pages can
// fail on their server-only boundaries and make Vite discover upload packages
// late, triggering a cold-cache reload after client-side profile navigation.
export default mergeConfig(base, defineConfig({
  cacheDir: path.resolve(__dirname, "../../.next/vite-student-profile"),
  optimizeDeps: {
    entries: ["student-profile.html", "index.html"],
    include: ["@supabase/ssr", "@supabase/supabase-js"],
  },
}));
