import { defineConfig } from "@playwright/test";
import base from "./contact-genuine.playwright.config";
export default defineConfig({ ...base, testMatch: "contact-genuine-continuation.spec.ts", reporter: [["list"], ["json", { outputFile: "../evidence/contact-genuine-continuation-results.json" }]], outputDir: "../evidence/contact-genuine-continuation-browser" });
