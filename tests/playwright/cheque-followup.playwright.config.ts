import { defineConfig, devices } from "@playwright/test";
import { ROOT, fromRoot } from "./root";
export default defineConfig({
  testDir: fromRoot("./tests/cheque-followup"), workers: 1, retries: 0, timeout: 30000, expect: { timeout: 5000 }, reporter: [['list'], ['json', { outputFile: fromRoot('../evidence/cheque-followup-results.json') }]],
  outputDir: fromRoot("../evidence/cheque-followup-results"),
  use: { ...devices["Pixel 7"], baseURL: "http://127.0.0.1:3221", isMobile: true, hasTouch: true, screenshot: "only-on-failure", trace: "retain-on-failure", launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } },
  webServer: { cwd: ROOT, command: "node node_modules/vite/bin/vite.js --config tests/cheque-followup/vite.config.mts", url: "http://127.0.0.1:3221", reuseExistingServer: false, timeout: 60000 },
});
