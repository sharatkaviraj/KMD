import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

// Serve the production-built fixture without a server or external requests.
test.beforeEach(async ({ page }) => {
  const artifact = process.env.PHONEOPS_ACADEMIC_STATIC_DIR;
  if (!artifact) return;
  const root = path.resolve(artifact);
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") return route.abort("blockedbyclient");
    const file = request.isNavigationRequest()
      ? path.join(root, "index.html")
      : path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file)) return route.abort("blockedbyclient");
    await route.fulfill({ path: file });
  });
});
test("teacher sees published periods; coordinator previews pending edits", async ({ page }) => {
  await page.goto("/?role=teacher");
  await expect(page.locator(".only-m:visible, .only-d:visible").getByText("Published Maths", { exact: true })).toBeVisible();
  await expect(page.getByText("Pending Science", { exact: true })).toHaveCount(0);
  await page.goto("/?role=academic");
  await expect(page.locator(".only-m:visible, .only-d:visible").getByText("Pending Science", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("selected cover day survives assignment dialog, tabs and reload", async ({ page }) => {
  await page.goto("/?role=academic&view=subs&day=2026-11-03");
  await page.getByRole("button", { name: "Change", exact: true }).tap();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/day=2026-11-03/);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).tap();
  await expect(page).toHaveURL(/day=2026-11-03/);
  await page.getByRole("radio", { name: "Teacher", exact: true }).tap();
  await expect(page).toHaveURL(/day=2026-11-03/);
  await page.goBack();
  await expect(page).toHaveURL(/day=2026-11-03/);
  await page.goForward();
  await expect(page).toHaveURL(/day=2026-11-03/);
  await page.goBack();
  await page.reload();
  await page.getByRole("button", { name: "Release", exact: true }).tap();
  await expect(page.locator("#qa-command")).toContainText('"day":"2026-11-03"');
});
test("Now belongs only to the current school day", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-12T03:45:00Z") });
  await page.goto("/?role=academic&view=subs&day=2026-11-03");
  await expect(page.getByText("Now", { exact: true })).toHaveCount(0);
  await page.goto("/?role=academic&view=subs&day=2026-10-12");
  await expect(page.getByText("Now", { exact: true })).toBeVisible();
});
