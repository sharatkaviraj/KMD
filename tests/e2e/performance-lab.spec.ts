import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { signIn } from "./support/harness";

test("production browser measurements", async ({ page }, testInfo) => {
  test.setTimeout(300000);
  const output = process.env.PERFORMANCE_EVIDENCE;
  test.skip(!output, "Run explicitly with PERFORMANCE_EVIDENCE to collect a bounded lab sample.");
  await page.setViewportSize({ width: 1280, height: 900 });
  const results = [];
  for (const [role, path] of [["teacher", "/teach"], ["admin", "/dashboard"], ["accountant", "/fees/payments"]]) {
    await signIn(page, role, path);
    const durations: number[] = []; let documentBytes = 0;
    for (let i = 0; i < 20; i++) {
      const started = Date.now();
      const response = await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect(page.getByText("The protected workspace hit an error")).toHaveCount(0);
      durations.push(Date.now() - started);
      if (i === 0 && response) documentBytes = (await response.body()).byteLength;
    }
    durations.sort((a, b) => a - b);
    results.push({ role, route: path, samples: 20, warmNavigationP50Ms: durations[9], warmNavigationP95Ms: durations[18], documentBytes });
  }
  const origin = testInfo.project.use.baseURL ?? "http://localhost:3100";
  const hosting = new URL(origin).hostname === "localhost" ? "local production Next build" : "deployed production Next build";
  writeFileSync(output!, JSON.stringify({ measuredAt: new Date().toISOString(), origin, sourceCommit: process.env.PERFORMANCE_COMMIT ?? null, environment: `${hosting}, Chromium, dev database, desktop viewport, unthrottled; navigation includes server reads and paint readiness; not field CWV`, results }, null, 2) + "\n");
});
