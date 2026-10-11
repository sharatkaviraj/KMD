import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/operations-fee-collector", testMatch: "*.spec.ts", fullyParallel: false, workers: 1, timeout: 60_000,
  reporter: [["list"], ["json", { outputFile: "../evidence/fee-collector-playwright.json" }]],
  outputDir: "../evidence/fee-collector-artifacts",
  globalSetup: "./tests/operations-fee-collector/warmup.ts",
  use: { baseURL: "http://127.0.0.1:3224", isMobile: true, hasTouch: true, trace: "retain-on-failure", screenshot: "only-on-failure",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } },
  webServer: { command: "node node_modules/vite/bin/vite.js --config tests/operations-fee-collector/vite.config.ts", url: "http://127.0.0.1:3224/fixture.html", reuseExistingServer: false, timeout: 120_000 },
});
