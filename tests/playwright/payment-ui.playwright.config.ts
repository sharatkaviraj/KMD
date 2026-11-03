import { defineConfig } from "@playwright/test";
import { ROOT, fromRoot } from "./root";
export default defineConfig({
  testDir: fromRoot("./tests/payment-ui"), outputDir: fromRoot("test-results"), testMatch: "**/*.spec.ts", workers: 1,
  timeout: 120_000, expect: { timeout: 30_000 }, reporter: "list",
  use: { baseURL: "http://127.0.0.1:3212", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium", launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } } },
    { name: "webkit", use: { browserName: "webkit", hasTouch: true } },
  ],
  webServer: {
    cwd: ROOT, command: "npx vite build --config tests/payment-ui/vite.config.ts && npx vite preview --config tests/payment-ui/vite.config.ts --host 127.0.0.1 --port 3212",
    url: "http://127.0.0.1:3212", reuseExistingServer: false, timeout: 240_000,
  },
});
