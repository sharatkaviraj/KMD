import { defineConfig, devices } from "@playwright/test";
import { ROOT, fromRoot } from "./root";
export default defineConfig({
  testDir: fromRoot("./tests/accountant-mobile"), testMatch: "**/*.spec.ts", fullyParallel: false, workers: 1,
  timeout: 30000, reporter: "list", outputDir: fromRoot("./test-results/accountant-mobile"),
  use: { ...devices["Pixel 7"], baseURL: "http://127.0.0.1:3207", isMobile: true, hasTouch: true, deviceScaleFactor: 2, trace: "retain-on-failure", screenshot: "only-on-failure", launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } },
  webServer: { cwd: ROOT, command: "node node_modules/vite/bin/vite.js --config tests/accountant-mobile/vite.config.ts", url: "http://127.0.0.1:3207", reuseExistingServer: false, timeout: 60000 },
});
