import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/payment-draft-ui",
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
    command: "npx vite --config tests/payment-draft-ui/vite.config.ts",
    url: "http://127.0.0.1:3202/payment-draft.html",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
