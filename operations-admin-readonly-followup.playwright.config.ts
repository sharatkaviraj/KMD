import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", testMatch: "operations-admin-readonly-followup.spec.ts",
  workers: 1, retries: 0, maxFailures: 1, timeout: 240_000,
  outputDir: "../evidence/admin-followup-readonly-browser",
  reporter: [["list"], ["json", { outputFile: "../evidence/admin-followup-readonly-results.json" }]],
  use: { baseURL: "http://localhost:3100", viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, serviceWorkers: "block", trace: "off", screenshot: "off", video: "off", actionTimeout: 30_000, navigationTimeout: 180_000 },
});
