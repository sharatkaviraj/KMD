import { defineConfig } from "@playwright/test";
import base from "./mobile-ui.playwright.config";

// Production components, synthetic records and action stubs; no auth or DB.
export default defineConfig({
  ...base,
  testMatch: ["student-profile.spec.ts", "student360-stream.spec.ts"],
  timeout: 60_000,
  use: { ...base.use, isMobile: true, hasTouch: true },
});
