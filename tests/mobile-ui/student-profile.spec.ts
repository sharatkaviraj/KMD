import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { T } from "../../src/vx/screens/admin/text";
import { lead } from "../../src/vx/text";

for (const width of [320, 360, 375, 390]) {
  for (const locale of ["en", "hi", "hi-en"] as const) {
    test(`profile portrait, sections and keyboard ${locale}/${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(`/student-profile.html?locale=${locale}`);
      await expect(page.getByRole("heading", { name: "Aarav Test", exact: true })).toBeVisible();
      expect(await page.locator('.student-profile-portrait').evaluate(e => [e.getBoundingClientRect().width, e.getBoundingClientRect().height])).toEqual([96, 96]);
      await expect(page.locator('.student-profile-nav a')).toHaveCount(4);
      await expect(page.getByText("74%", { exact: true })).toBeVisible();
      const language = locale === "hi-en" ? "both" : locale;
      const learning = page.getByRole("link", { name: lead(T.learning, language), exact: true });
      await learning.focus(); await page.keyboard.press("Enter");
      await expect(learning).toHaveAttribute("aria-current", "page");
      await expect(page).toHaveURL(/tab=attendance/);
      await page.getByRole("link", { name: lead(T.tabMarks, language), exact: true }).click();
      await expect(page.getByText("74%", { exact: true })).toBeVisible();
      await page.getByRole("link", { name: lead(T.tabOverview, language), exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      for (const box of await page.locator('.student-profile-nav a,.student-profile-actions a').evaluateAll(elements => elements.map(e => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })))) { expect(box.w).toBeGreaterThanOrEqual(44); expect(box.h).toBeGreaterThanOrEqual(44); }
      if (locale === "en") await page.screenshot({ path: info.outputPath(`overview-${width}.png`), fullPage: true, animations: "disabled" });
      expect(errors).toEqual([]);
    });
  }
}

for (const state of ["no-photo", "failed-photo", "empty", "error"] as const) test(`profile ${state} stays honest`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto(`/student-profile.html?state=${state}`);
  if (state === "no-photo" || state === "failed-photo") {
    await expect(page.locator('.student-profile-portrait img')).toHaveCount(0);
    await expect(page.locator('.student-profile-portrait')).toHaveText("AT");
  } else if (state === "empty") {
    await expect(page.getByText("No observation recorded", { exact: true })).toBeVisible();
    await expect(page.getByText("No attendance recorded yet", { exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText("No observation recorded", { exact: true })).toHaveCount(0);
    await expect(page.getByText("No open support action", { exact: true })).toHaveCount(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test("school-only reader has no finance or private-photo surface", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/student-profile.html?role=teacher");
  await expect(page.locator('.student-profile-nav a')).toHaveCount(3);
  await expect(page.getByRole("link", { name: "Fees", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Payment Desk", exact: true })).toHaveCount(0);
  await expect(page.locator('.student-profile-portrait img')).toHaveCount(0);
  await expect(page.getByText("Due now", { exact: true })).toHaveCount(0);
});

test("fees keep separate dues, concessions, keyboard scrolling and More records", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto("/student-profile.html");
  await page.getByRole("link", { name: "Fees", exact: true }).click();
  await expect(page.getByText("Due now", { exact: true })).toBeVisible(); await expect(page.getByText("Upcoming dues", { exact: true })).toBeVisible();
  await expect(page.getByText("Concessions reduce fees; they are not cash received.", { exact: true })).toBeVisible();
  const table = page.getByRole("region", { name: /Installment details/ }); await table.focus(); await page.keyboard.press("ArrowRight");
  await expect.poll(() => table.evaluate(e => e.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: info.outputPath("fees-320.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("link", { name: "More", exact: true }).click();
  await page.getByRole("link", { name: "Family", exact: true }).click(); await expect(page.getByText("Synthetic Sibling", { exact: true })).toBeVisible();
});

for (const theme of ["light", "dark"]) test(`reduced motion and accessible overview ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto(`/student-profile.html?theme=${theme}`);
  expect(await page.locator('.student-profile-body').evaluate(e => getComputedStyle(e).animationName)).toBe("none");
  const result = await new AxeBuilder({ page }).include('.student-profile-hero,.student-profile-nav,.student-profile-actions,.student-profile-body').analyze();
  expect(result.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});

test("real directory preserves filters and scroll across profile and interrupted payment entry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/student-profile.html");
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/students\?q=Test&class=qa&view=school&page=2$/);
  const child = page.getByRole("link", { name: "Aarav Test", exact: true }); await child.scrollIntoViewIfNeeded();
  const directoryY = await page.evaluate(() => scrollY); expect(directoryY).toBeGreaterThan(300);
  await child.click(); await expect(page.getByRole("heading", { name: "Aarav Test", exact: true })).toBeVisible();
  const profileURL = page.url();
  await page.getByRole("link", { name: "Payment Desk", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Synthetic payment entry" })).toBeVisible();
  await page.getByRole("textbox", { name: "Synthetic amount" }).fill("111");
  await page.goBack(); await expect(page).toHaveURL(profileURL);
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/students\?q=Test&class=qa&view=school&page=2$/);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(directoryY, -1);
});
