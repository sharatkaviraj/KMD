import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/accountant-dev",
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 60_000 },
  reporter: "list",
  outputDir: "../evidence/accountant-dev-results",
  use: {
    ...devices["Pixel 7"],
    baseURL: "http://localhost:3100",
    trace: "off", screenshot: "off", video: "off",
    navigationTimeout: 180_000,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
});
