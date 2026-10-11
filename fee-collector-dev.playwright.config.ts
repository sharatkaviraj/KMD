import { defineConfig } from "@playwright/test";

if (process.env.OPS_FEE_DEV_POSTING_READY !== "yes" || process.env.OPS_FEE_DEV_FINANCE_AUTHORIZED !== "yes") {
  throw new Error("Collector DEV posting held: requires parent integration-ready and synthetic-bookkeeping authorization signals. No cleanup, migration, or approval bypass is covered.");
}
const baseURL = process.env.PHONEOPS_BASE_URL ?? "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw new Error("Collector financial tests require the verified local DEV app.");

export default defineConfig({
  testDir: "./tests/fee-collector-dev", testMatch: "*.spec.ts", fullyParallel: false, workers: 1,
  timeout: 180_000, expect: { timeout: 20_000 },
  reporter: [["list"], ["json", { outputFile: "../evidence/fee-collector-dev-results.json" }]],
  outputDir: "../evidence/fee-collector-dev-artifacts",
  // Ephemeral QA confirmation tokens and auth cookies must never enter traces.
  use: { baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, trace: "off", screenshot: "off" },
});
