import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/marks-dev",
  outputDir: ".playwright/marks-dev",
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 45_000 },
  reporter: "list",
  use: { ...devices["Pixel 7"], baseURL: "http://localhost:3100", navigationTimeout: 180_000, trace: "off", screenshot: "off" },
});
