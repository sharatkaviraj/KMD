import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import { ROOT, fromRoot } from "./root";

export default defineConfig({
  testDir: fromRoot("./tests/payment-draft-ui"), outputDir: fromRoot("test-results"),
  testMatch: "payment-draft.spec.ts",
  fullyParallel: true,
  workers: 2,
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3202",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined) },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    cwd: ROOT, command: "npx vite --config tests/payment-draft-ui/vite.config.ts",
    url: "http://127.0.0.1:3202/payment-draft.html",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
