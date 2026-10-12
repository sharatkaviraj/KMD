import { defineConfig } from "@playwright/test";
const evidence = process.env.CONTACT_GENUINE_EVIDENCE ?? "contact-genuine";
if (!/^contact-[a-z0-9-]+$/.test(evidence)) throw Error("Invalid contact runtime evidence label");
export default defineConfig({
  testDir: "./tests/e2e", testMatch: "contact-genuine.spec.ts", workers: 1, retries: 0, maxFailures: 1, timeout: 600_000,
  expect: { timeout: 45_000 },
  reporter: [["list"], ["json", { outputFile: `../evidence/${evidence}-results.json` }]], outputDir: `../evidence/${evidence}-browser`,
  use: { baseURL: process.env.PHONEOPS_CONTACT_ORIGIN ?? "http://localhost:3201", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", trace: "off", screenshot: "off", video: "off", navigationTimeout: 180_000, actionTimeout: 30_000 },
});
