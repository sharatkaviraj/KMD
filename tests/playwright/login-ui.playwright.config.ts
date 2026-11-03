import { defineConfig } from "@playwright/test";
import { ROOT, fromRoot } from "./root";
export default defineConfig({
  testDir: fromRoot("tests/login-ui"), outputDir: fromRoot("test-results/login"), workers: 1,
  timeout: 30_000, reporter: "list",
  use: { baseURL: "http://127.0.0.1:3226", browserName: "chromium", hasTouch: true, screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: { cwd: ROOT, command: "npx vite --config tests/login-ui/vite.config.ts", url: "http://127.0.0.1:3226", reuseExistingServer: false },
});
