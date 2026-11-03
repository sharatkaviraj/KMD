import { defineConfig } from "@playwright/test";
import { ROOT } from "./root";
import base from "./mobile-ui.playwright.config";

// Pure synthetic student models and server-action stubs: no .env, auth or DB.
export default defineConfig({
  ...base,
  testMatch: "student360-navigation.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  use: { ...base.use, isMobile: true, hasTouch: true, navigationTimeout: 180_000 },
  projects: [
    { name: "phone-360", use: { viewport: { width: 360, height: 800 } } },
    { name: "phone-390", use: { viewport: { width: 390, height: 844 } } },
    { name: "phone-412", use: { viewport: { width: 412, height: 915 } } },
    { name: "phone-landscape", use: { viewport: { width: 844, height: 390 } } },
  ],
  webServer: {
    cwd: ROOT, command: "npx vite --config tests/mobile-ui/vite.config.ts",
    url: "http://127.0.0.1:3201",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
