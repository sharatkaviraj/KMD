import { expect, test } from "@playwright/test";
import { T } from "../../src/vx/screens/admin/text";
import { lead } from "../../src/vx/text";
test.setTimeout(60_000);
for (const width of [390, 1440]) for (const locale of ["en", "hi", "hi-en"] as const) {
  test(`Student 360 delayed stream and retry: ${locale}/${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?view=student360&locale=${locale}`);
    // Suspense retains a hidden previous subtree while switching streams.
    // Role locators exercise the visible, accessible tab rather than that copy.
    const tab = (name: string) => page.getByRole("link", { name, exact: true });
    const attendance = locale === "hi" ? "हाज़िरी" : "Attendance";
    const family = locale === "hi" ? "परिवार" : "Family";
    const notes = locale === "hi" ? "नोट्स" : "Notes";
    const language = locale === "hi-en" ? "both" : locale;
    const learning = lead(T.learning, language);
    const more = lead(T.profileMore, language);
    await expect(page.getByText("QA school note", { exact: true })).toBeVisible();
    await tab(learning).click(); await tab(attendance).click(); await page.getByRole("button", { name: "Resolve fee read", exact: true }).click();
    await expect(tab(attendance)).toHaveAttribute("aria-current", "location");
    await expect(page).toHaveURL(/tab=attendance/);
    await tab(more).click(); await tab(family).click(); await expect(page.getByText("QA Sibling", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);

    await page.goto(`/?view=student360&locale=${locale}`);
    await tab(more).click(); await tab(notes).click(); await page.getByRole("button", { name: "Fail fee read", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByText("QA school note", { exact: true })).toBeVisible();
    await tab(family).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText(/No brothers or sisters linked|कोई भाई-बहन जुड़े नहीं/)).toHaveCount(0);
    const retry = page.getByRole("button", { name: locale === "hi" ? "फिर कोशिश करें" : "Try again", exact: true });
    await retry.focus(); await page.keyboard.press("Enter");
    await expect(page.locator('[role="status"][aria-busy="true"]')).toBeVisible();
    await page.getByRole("button", { name: "Resolve fee read", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0); await expect(tab(family)).toHaveAttribute("aria-current", "location");
    await expect(page.getByText("QA Sibling", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
}
