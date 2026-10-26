import { defineConfig, devices } from "@playwright/test";
import { fromRoot } from "./root";

export default defineConfig({
  testDir: fromRoot("./tests/marks-dev"),
  outputDir: fromRoot(".playwright/marks-dev"),
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 45_000 },
  reporter: "list",
  use: { ...devices["Pixel 7"], baseURL: "http://localhost:3100", navigationTimeout: 180_000, trace: "off", screenshot: "off" },
});
