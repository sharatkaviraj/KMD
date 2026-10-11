import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/operations-admin", testMatch: "**/*.spec.ts", workers: 1, timeout: 45000,
  reporter: "list", outputDir: ".playwright/operations-admin",
  use: { baseURL: "http://127.0.0.1:3204", trace: "retain-on-failure", screenshot: "only-on-failure", hasTouch: true, isMobile: true },
  webServer: { command: "node node_modules/vite/bin/vite.js --config tests/operations-admin/vite.config.ts", url: "http://127.0.0.1:3204", reuseExistingServer: true, timeout: 120000 },
});
