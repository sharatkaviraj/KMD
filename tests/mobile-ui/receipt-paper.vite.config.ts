import path from "node:path";
import { defineConfig } from "vite";
import base from "./vite.config";

// The receipt fixture (receipt-paper.html) draws the receipts desk and the
// receipt page in the browser. Its stand-ins come first: an alias list is
// matched in order, and the base config's catch-all "@" would win otherwise.
export default defineConfig({
  ...base,
  resolve: { alias: {
    "server-only": path.resolve(__dirname, "server-only.ts"),
    // Close day, reverse: the desk's own actions, which a fixture never runs.
    "@/app/(app)/receipts/actions": path.resolve(__dirname, "../receipt-navigation/actions.ts"),
    ...(base.resolve?.alias as Record<string, string>),
  } },
});
