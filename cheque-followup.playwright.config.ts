import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/cheque-followup", workers: 1, retries: 0, timeout: 30000, expect: { timeout: 5000 }, reporter: [['list'], ['json', { outputFile: '../evidence/cheque-followup-results.json' }]],
  outputDir: "../evidence/cheque-followup-results",
  use: { ...devices["Pixel 7"], baseURL: "http://127.0.0.1:3221", isMobile: true, hasTouch: true, screenshot: "only-on-failure", trace: "retain-on-failure", launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } },
  webServer: { command: "node node_modules/vite/bin/vite.js --config tests/cheque-followup/vite.config.mts", url: "http://127.0.0.1:3221", reuseExistingServer: false, timeout: 60000 },
});
