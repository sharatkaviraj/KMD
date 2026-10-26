import { defineConfig } from "@playwright/test";
import { fromRoot } from "./root";
import base from "./contact-genuine.playwright.config";
export default defineConfig({ ...base, testMatch: "contact-genuine-continuation.spec.ts", reporter: [["list"], ["json", { outputFile: fromRoot("../evidence/contact-genuine-continuation-results.json") }]], outputDir: fromRoot("../evidence/contact-genuine-continuation-browser") });
