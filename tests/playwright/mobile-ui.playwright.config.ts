import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import { ROOT, fromRoot } from "./root";

export default defineConfig({
  testDir: fromRoot("./tests/mobile-ui"), outputDir: fromRoot("test-results"),
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  workers: 2,
  timeout: 30_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3201",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined) },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    cwd: ROOT, command: "npx vite --config tests/mobile-ui/vite.config.ts",
    url: "http://127.0.0.1:3201",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
