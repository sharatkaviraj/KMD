import { defineConfig, devices } from "@playwright/test";
import { ROOT, fromRoot } from "./root";

export default defineConfig({
  testDir: fromRoot("./tests/marks-mobile"),
  outputDir: fromRoot(".playwright/marks-mobile"),
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: "list",
  use: { ...devices["Pixel 7"], baseURL: "http://127.0.0.1:3206", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { cwd: ROOT, command: "node node_modules/vite/bin/vite.js --config tests/marks-mobile/vite.config.ts", url: "http://127.0.0.1:3206", reuseExistingServer: false, timeout: 60_000 },
});
