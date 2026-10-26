import { defineConfig, devices } from "@playwright/test";
import { ROOT, fromRoot } from "./root";
export default defineConfig({
  testDir: fromRoot("./tests/module-followup"), testMatch: "**/*.spec.ts", fullyParallel: false, workers: 1,
  timeout: 20000, reporter: [['list'], ['json', { outputFile: fromRoot('../evidence/module-followup-results.json') }]], outputDir: fromRoot("./test-results/module-followup"),
  use: { ...devices["Pixel 7"], baseURL: "http://127.0.0.1:3211", isMobile: true, hasTouch: true, deviceScaleFactor: 2, trace: "retain-on-failure", screenshot: "only-on-failure", launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } },
  webServer: { cwd: ROOT, command: "node node_modules/vite/bin/vite.js --config tests/module-followup/vite.config.ts", url: "http://127.0.0.1:3211", reuseExistingServer: false, timeout: 60000 },
});
