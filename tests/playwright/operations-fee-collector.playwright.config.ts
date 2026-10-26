import { defineConfig } from "@playwright/test";
import { ROOT, fromRoot } from "./root";
process.env.OPS_FEE_ACTIVE_ONLY = "yes";
const evidenceDir = process.env.OPS_FEE_EVIDENCE_DIR ?? ".test-artifacts/operations-fee-collector";
export default defineConfig({
  testDir: fromRoot("./tests/operations-fee-collector"), testMatch: ["vx-phone.spec.ts", "vx-postfix.spec.ts"], fullyParallel: false, workers: 1, timeout: 60_000,
  reporter: [["list"], ["json", { outputFile: fromRoot(`${evidenceDir}/results.json`) }]],
  outputDir: fromRoot(`${evidenceDir}/artifacts`),
  globalSetup: fromRoot("./tests/operations-fee-collector/warmup.ts"),
  use: { baseURL: "http://127.0.0.1:3224", isMobile: true, hasTouch: true, trace: "retain-on-failure", screenshot: "only-on-failure",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } },
  webServer: { cwd: ROOT, command: "node node_modules/vite/bin/vite.js --config tests/operations-fee-collector/vite.config.ts", url: "http://127.0.0.1:3224/vx.html", reuseExistingServer: false, timeout: 120_000 },
});
