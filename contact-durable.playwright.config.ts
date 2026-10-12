import { defineConfig } from "@playwright/test";
import base from "./module-followup.playwright.config";
const evidence = process.env.CONTACT_EVIDENCE_LABEL ?? "contact-durable-phone";
if (!/^contact-[a-z0-9-]+$/.test(evidence)) throw new Error("Invalid contact evidence label");
export default defineConfig({ ...base, reporter: [["list"], ["json", { outputFile: `../evidence/${evidence}-results.json` }]], outputDir: `../evidence/${evidence}` });
