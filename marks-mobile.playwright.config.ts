import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/marks-mobile",
  outputDir: ".playwright/marks-mobile",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: "list",
  use: { ...devices["Pixel 7"], baseURL: "http://127.0.0.1:3206", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "node node_modules/vite/bin/vite.js --config tests/marks-mobile/vite.config.ts", url: "http://127.0.0.1:3206", reuseExistingServer: false, timeout: 60_000 },
});
