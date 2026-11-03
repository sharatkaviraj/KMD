import { defineConfig } from "@playwright/test";
import { ROOT, fromRoot } from "./root";
export default defineConfig({
  testDir: fromRoot("./tests/export-followup"), testMatch: "**/*.spec.ts", workers: 1, timeout: 90000,
  reporter: [['list'], ['json', { outputFile: fromRoot('../evidence/export-followup-results.json') }]], outputDir: fromRoot(".playwright/export-followup"),
  use: { baseURL: "http://127.0.0.1:3214", hasTouch: true, isMobile: true, trace: "retain-on-failure" },
  webServer: { cwd: ROOT, command: "node node_modules/vite/bin/vite.js --config tests/export-followup/vite.config.ts", url: "http://127.0.0.1:3214", reuseExistingServer: false, timeout: 120000 },
});
