import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { T } from "../../src/vx/screens/admin/text";
import { lead } from "../../src/vx/text";

/*
 * Student 360 as the design draws it on a phone (F06–F08): the fee ring around
 * the child's face, three tiles, the tab chips and the action bar. Production
 * components, synthetic records, stubbed actions; no sign-in, no database.
 */

for (const width of [320, 360, 375, 390]) {
  for (const locale of ["en", "hi", "hi-en"] as const) {
    test(`Student 360 hero, tiles and chips ${locale}/${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(`/student-profile.html?locale=${locale}`);
      const language = locale === "hi-en" ? "both" : locale;
      await expect(page.getByRole("heading", { name: "Aarav Test", exact: true })).toBeVisible();
      expect(await page.locator(".s360-ring").evaluate(e => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)])).toEqual([96, 96]);
      await expect(page.locator(".s360-tabs a")).toHaveCount(9);
      await expect(page.locator(".s360-kpis.phone").getByText("74%", { exact: true })).toBeVisible();
      const attendance = page.locator(".s360-tabs").getByRole("link", { name: lead(T.tabAttendance, language), exact: true });
      await attendance.focus(); await page.keyboard.press("Enter");
      await expect(attendance).toHaveAttribute("aria-current", "page");
      await expect(page).toHaveURL(/tab=attendance/);
      await page.locator(".s360-tabs").getByRole("link", { name: lead(T.tabMarks, language), exact: true }).click();
      await expect(page.locator(".s360-body").getByText("74%", { exact: true })).toBeVisible();
      await page.locator(".s360-tabs").getByRole("link", { name: lead(T.tabOverview, language), exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      for (const box of await page.locator(".s360-bar a, .s360-top a, .s360-top button").evaluateAll(elements => elements.map(e => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })))) { expect(box.w).toBeGreaterThanOrEqual(44); expect(box.h).toBeGreaterThanOrEqual(44); }
      if (locale === "en") await page.screenshot({ path: info.outputPath(`overview-${width}.png`), animations: "disabled" });
      expect(errors).toEqual([]);
    });
  }
}

for (const state of ["no-photo", "failed-photo", "empty", "error"] as const) test(`Student 360 ${state} stays honest`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto(`/student-profile.html?state=${state}`);
  if (state === "no-photo" || state === "failed-photo") {
    await expect(page.locator(".s360-ava img")).toHaveCount(0);
    await expect(page.locator(".s360-ava")).toHaveText("AT");
  } else if (state === "empty") {
    await expect(page.getByText(lead(T.noNotesYet, "en"), { exact: true })).toBeVisible();
    await expect(page.getByText(lead(T.noMarks, "en"), { exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText(lead(T.noNotesYet, "en"), { exact: true })).toHaveCount(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test("school-only reader has no finance or private-photo surface", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/student-profile.html?role=teacher");
  await expect(page.locator(".s360-tabs a")).toHaveCount(5);
  await expect(page.locator(".s360-tabs").getByRole("link", { name: "Fees", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Collect/ })).toHaveCount(0);
  await expect(page.locator(".s360-ava img")).toHaveCount(0);
  await expect(page.getByText("Pending today", { exact: true })).toHaveCount(0);
});

test("fees keep pending today, not due yet and the late fee apart", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto("/student-profile.html");
  await page.locator(".s360-tabs").getByRole("link", { name: "Fees", exact: true }).click();
  const body = page.locator(".s360-body");
  await expect(body.getByText("Pending today", { exact: true }).first()).toBeVisible();
  await expect(body.getByText(/₹6,000 not due yet/)).toBeVisible();
  await expect(body.getByText("Late fee ₹100 · kept apart", { exact: true }).first()).toBeVisible();
  await expect(body.getByText("Concessions reduce fees; they are not cash received.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: info.outputPath("fees-320.png"), animations: "disabled" });
  await page.locator(".s360-tabs").getByRole("link", { name: "Family", exact: true }).click();
  await expect(page.getByText("Synthetic Sibling", { exact: true })).toBeVisible();
});

for (const theme of ["light", "dark"]) test(`reduced motion and accessible Student 360 ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto(`/student-profile.html?theme=${theme}`);
  expect(await page.locator(".s360-body").evaluate(e => getComputedStyle(e).animationName)).toBe("none");
  const result = await new AxeBuilder({ page }).include(".s360").analyze();
  expect(result.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});

test("real directory preserves filters and scroll across Student 360 and interrupted payment entry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/student-profile.html");
  await page.locator(".s360-top").getByRole("link", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/students\?q=Test&class=qa&view=school&page=2$/);
  const child = page.getByRole("link", { name: "Aarav Test", exact: true }); await child.scrollIntoViewIfNeeded();
  const directoryY = await page.evaluate(() => scrollY); expect(directoryY).toBeGreaterThan(300);
  await child.click(); await expect(page.getByRole("heading", { name: "Aarav Test", exact: true })).toBeVisible();
  const profileURL = page.url();
  await page.locator(".s360-bar").getByRole("link", { name: /^Collect/ }).click();
  await expect(page.getByRole("heading", { name: "Synthetic payment entry" })).toBeVisible();
  await page.getByRole("textbox", { name: "Synthetic amount" }).fill("111");
  await page.goBack(); await expect(page).toHaveURL(profileURL);
  await page.locator(".s360-top").getByRole("link", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/students\?q=Test&class=qa&view=school&page=2$/);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(directoryY, -1);
});

for (const width of [390, 1280]) {
  test(`directory search keeps filters and supports Enter at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/student-profile.html");
    await page.getByRole("link", { name: width < 900 ? "Back" : "Close", exact: true }).click();
    const search = page.locator(width < 900 ? "#stu-q-m" : "#stu-q-d");
    await search.fill("Aarav");
    await search.press("Enter");
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("Aarav");
    const params = new URL(page.url()).searchParams;
    expect(params.get("class")).toBe("qa");expect(params.get("view")).toBe("school");expect(params.has("page")).toBe(false);
    await expect(search).toHaveValue("Aarav");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
}
