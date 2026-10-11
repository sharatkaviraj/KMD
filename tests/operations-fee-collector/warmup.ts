import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { collectorSummary } from "./legacy-data";

export default async function warmup() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/fees/payments/student-summary?*", route => {
    const query = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: collectorSummary(query.get("studentId") ?? "a", query.get("paymentDate") ?? undefined) });
  });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname !== "127.0.0.1" || route.request().method() !== "GET" ? route.abort() : route.fallback();
  });
  const results = [];
  try {
    const fixtures = process.env.OPS_FEE_ACTIVE_ONLY === "yes"
      ? [["vx.html", ".pd-amt input"]]
      : [["vx.html", ".pd-amt input"], ["fixture.html", 'input[aria-label="Amount received"]']];
    for (const [url, selector] of fixtures) {
      const started = performance.now();
      console.log(`Warming synthetic fee fixture ${url} (no saves or sends)`);
      await page.goto(`http://127.0.0.1:3224/${url}`, { waitUntil: "commit", timeout: 180_000 });
      await page.locator(selector).filter({ visible: true }).first().waitFor({ state: "visible", timeout: 180_000 });
      results.push({ fixture: url, durationMs: performance.now() - started, ready: true });
    }
    if (errors.length) throw new Error(`Synthetic fixture startup errors: ${errors.join("; ")}`);
  } finally {
    writeFileSync("../evidence/fee-collector-warmup.json", JSON.stringify({ layer: "fixture startup, not operational acceptance", mobileEmulation: { width: 390, height: 844, isMobile: true, hasTouch: true }, results, errors }, null, 2));
    await browser.close();
  }
}
