import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

test.use({ isMobile: true, hasTouch: true });

const id = "00000000-0000-4000-8000-000000000001";
// Optional offline artifact serving keeps browser acceptance executable when
// the host sandbox blocks loopback. Production components are Vite-built;
// every request is fulfilled locally or blocked, never sent elsewhere.
test.beforeEach(async ({ page }) => {
  // The generic mobile-ui runner has no viewport project; keep these phone
  // cases narrow there too, while preserving the dedicated four-size matrix.
  if ((page.viewportSize()?.width ?? 1280) > 900) await page.setViewportSize({ width: 390, height: 844 });
  const artifact = process.env.PHONEOPS_STATIC_DIR;
  if (!artifact) return;
  const root = path.resolve(artifact);
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") return route.abort("blockedbyclient");
    const file = request.isNavigationRequest()
      ? path.join(root, "student360-navigation.html")
      : path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file)) return route.abort("blockedbyclient");
    await route.fulfill({ path: file });
  });
});
test("Notes → All notes → Back restores the selected phone tab", async ({ page }, testInfo) => {
  if (!process.env.PHONEOPS_STATIC_DIR) await page.route(`**/students/${id}*`, route => route.fulfill({ path: "tests/mobile-ui/student360-navigation.html", contentType: "text/html" }));
  await page.goto("/student360-navigation.html", { waitUntil: "domcontentloaded" });
  const notes = page.getByRole("link", { name: "Notes", exact: true });
  const target = await notes.boundingBox();
  await notes.tap();
  await expect(notes).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(new RegExp(`/students/${id}\\?tab=notes$`));
  await page.getByRole("link", { name: "All notes", exact: true }).tap();
  await expect(page.getByRole("heading", { name: "Synthetic notes board" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/students/${id}\\?tab=notes$`));
  await expect(notes).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("QA navigation observation", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("notes-restored-phone.png"), fullPage: true });
  await testInfo.attach("phone-layout", { body: JSON.stringify({ viewport: page.viewportSize(), touch: await page.evaluate(() => matchMedia("(pointer: coarse)").matches), notesTarget: target, documentOverflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) }), contentType: "application/json" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Synthetic notes board" })).toBeVisible();
  await page.goBack();
  await expect(notes).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(notes).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("QA navigation observation", { exact: true })).toBeVisible();
});

test("history updates restore allowed tabs and reject unavailable tabs", async ({ page }) => {
  await page.goto("/student360-navigation.html", { waitUntil: "domcontentloaded" });
  const notes = page.getByRole("link", { name: "Notes", exact: true });
  const overview = page.getByRole("link", { name: "Overview", exact: true });
  await notes.tap();
  await page.evaluate((studentId) => {
    history.pushState(null, "", `/students/${studentId}?tab=attendance`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, id);
  await expect(page.getByRole("link", { name: "Attendance", exact: true })).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(notes).toHaveAttribute("aria-current", "page");
  await page.evaluate((studentId) => {
    history.pushState(null, "", `/students/${studentId}?tab=fees`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, id);
  await expect(overview).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Fees", exact: true })).toHaveCount(0);
});

test("repeated offline tab taps keep one history entry and recover after reconnect", async ({ page, context }) => {
  await page.goto("/student360-navigation.html", { waitUntil: "domcontentloaded" });
  const entries = await page.evaluate(() => history.length);
  await context.setOffline(true);
  for (let repeat = 0; repeat < 3; repeat += 1) {
    await page.getByRole("link", { name: "Notes", exact: true }).tap();
    await expect(page.getByRole("link", { name: "Notes", exact: true })).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: "Attendance", exact: true }).tap();
    await expect(page.getByRole("link", { name: "Attendance", exact: true })).toHaveAttribute("aria-current", "page");
  }
  expect(await page.evaluate(() => history.length)).toBe(entries);
  await context.setOffline(false);
  await page.getByRole("link", { name: "Notes", exact: true }).tap();
  await expect(page.getByText("QA navigation observation", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});
