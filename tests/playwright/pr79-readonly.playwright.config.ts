import { defineConfig } from "@playwright/test";
import { fromRoot } from "./root";
import path from "node:path";

const evidence = path.resolve(process.env.PR79_READONLY_OUTPUT_DIR ?? "../evidence/pr79-deployed-readonly");
export default defineConfig({
  testDir: fromRoot("./tests/pr79-readonly"),
  testMatch: "acceptance.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: path.join(evidence, "results.json") }]],
  outputDir: path.join(evidence, "private-errors"),
  use: {
    baseURL: "https://vppsone.vercel.app",
    browserName: "chromium",
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    serviceWorkers: "block",
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
});
