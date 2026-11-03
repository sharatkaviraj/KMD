import { defineConfig } from "@playwright/test";
import { ROOT, fromRoot } from "./root";

export default defineConfig({
  testDir: fromRoot("tests/mobile-ui"), testMatch: "one-polish.spec.ts",
  outputDir: fromRoot("test-results/one-polish"),
  workers: 2, timeout: 30_000, reporter: "list",
  use: { baseURL: "http://127.0.0.1:3216", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: { cwd: ROOT, command: "node node_modules/vite/bin/vite.js --config tests/mobile-ui/polish.vite.config.ts", url: "http://127.0.0.1:3216/one-polish.html", reuseExistingServer: true, timeout: 30_000 },
});
