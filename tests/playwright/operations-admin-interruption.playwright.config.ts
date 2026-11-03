import { defineConfig } from "@playwright/test";
import { fromRoot } from "./root";

export default defineConfig({
  testDir: fromRoot("./tests/e2e"), testMatch: "operations-admin.spec.ts",
  workers: 1, retries: 0, maxFailures: 1, timeout: 900_000,
  outputDir: fromRoot("../evidence/admin-interruption-followup-browser"),
  reporter: [["list"], ["json", { outputFile: fromRoot("../evidence/admin-interruption-followup-results.json") }]],
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
