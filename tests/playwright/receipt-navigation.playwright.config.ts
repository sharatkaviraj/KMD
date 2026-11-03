import { defineConfig } from "@playwright/test";
import { ROOT, fromRoot } from "./root";
export default defineConfig({ testDir: fromRoot("tests/receipt-navigation"), outputDir: fromRoot("test-results/receipt-navigation"), workers: 1, timeout: 30_000, reporter: "list",
  use: { baseURL: "http://127.0.0.1:3228", browserName: "chromium", hasTouch: true, screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: { cwd: ROOT, command: "npx vite --config tests/receipt-navigation/vite.config.ts", url: "http://127.0.0.1:3228", reuseExistingServer: false },
});
