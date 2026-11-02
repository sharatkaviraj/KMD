import path from "node:path";
import { defineConfig, mergeConfig } from "vite";
import design from "./design.vite.config";

export default mergeConfig(design, defineConfig({
  resolve: { alias: [{ find: "@/app/(app)/fees/session/actions", replacement: path.resolve(__dirname, "session-actions.ts") }] },
  server: { port: 3216 },
  cacheDir: path.resolve(__dirname, "../../.vite-design/polish"),
}));
