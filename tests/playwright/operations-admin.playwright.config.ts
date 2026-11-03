import { defineConfig } from "@playwright/test";
import { ROOT, fromRoot } from "./root";
export default defineConfig({
  testDir: fromRoot("./tests/operations-admin"), testMatch: "**/*.spec.ts", workers: 1, timeout: 45000,
  reporter: "list", outputDir: fromRoot(".playwright/operations-admin"),
  use: { baseURL: "http://127.0.0.1:3204", trace: "retain-on-failure", screenshot: "only-on-failure", hasTouch: true, isMobile: true },
  webServer: { cwd: ROOT, command: "node node_modules/vite/bin/vite.js --config tests/operations-admin/vite.config.ts", url: "http://127.0.0.1:3204", reuseExistingServer: true, timeout: 120000 },
});
