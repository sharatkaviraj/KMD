import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e", testMatch: "operations-admin.spec.ts",
  workers: 1, retries: 0, maxFailures: 1, timeout: 900_000,
  outputDir: "../evidence/admin-interruption-followup-browser",
  reporter: [["list"], ["json", { outputFile: "../evidence/admin-interruption-followup-results.json" }]],
  use: {
    baseURL: process.env.OPS_ADMIN_ORIGIN ?? "http://localhost:3100",
    isMobile: true, hasTouch: true, serviceWorkers: "block",
    trace: "off", screenshot: "off", video: "off",
    actionTimeout: 30_000, navigationTimeout: 180_000,
  },
  projects: [
    { name: "phone360", use: { viewport: { width: 360, height: 800 } } },
    { name: "phone390", use: { viewport: { width: 390, height: 844 } } },
  ],
});
