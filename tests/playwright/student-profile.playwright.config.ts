import { defineConfig } from "@playwright/test";
import base from "./mobile-ui.playwright.config";
import { ROOT } from "./root";

// Production components, synthetic records and action stubs; no auth or DB.
export default defineConfig({
  ...base,
  testMatch: ["student-profile.spec.ts", "student360-stream.spec.ts", "student-documents.spec.ts"],
  timeout: 60_000,
  use: { ...base.use, isMobile: true, hasTouch: true },
  webServer: {
    cwd: ROOT,
    command: "npx vite --config tests/mobile-ui/student-profile.vite.config.ts",
    url: "http://127.0.0.1:3201",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
