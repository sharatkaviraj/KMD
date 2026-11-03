import { defineConfig } from "@playwright/test";
import { ROOT, fromRoot } from "./root";
const evidence = "D:/Codex/scratch/school-office-release-2026-11-01/browser";
export default defineConfig({
  testDir: fromRoot("tests/school-office-ui"), testMatch: "**/*.spec.ts", outputDir: `${evidence}/test-results`,
  fullyParallel: true, workers: 2, timeout: 30_000,
  reporter: [["list"], ["json", { outputFile: `${evidence}/results.json` }]],
  use: { baseURL: "http://127.0.0.1:3216", trace: "retain-on-failure", screenshot: "only-on-failure",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } },
  webServer: { cwd: ROOT, command: "node node_modules/vite/bin/vite.js --config tests/school-office-ui/vite.config.ts", url: "http://127.0.0.1:3216", reuseExistingServer: false, timeout: 30_000 },
});
