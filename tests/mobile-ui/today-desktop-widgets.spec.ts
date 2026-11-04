import { expect, test } from "@playwright/test";

test("desktop Today brings the schedule and quick work above fee analysis", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/?view=today&locale=en&desk=admin");
  const actions = page.getByRole("heading", { name: "Quick actions" }).locator("..");
  const schedule = page.getByText("Scheduled now", { exact: true }).filter({ visible: true });
  const finance = page.getByRole("region", { name: "Fees today" });
  await expect(schedule).toBeVisible();
  await expect(actions.getByRole("link", { name: "Assign substitute" })).toHaveAttribute("href", "/substitutions/arrange");
  await expect(actions.getByRole("link", { name: "Mark attendance" })).toHaveAttribute("href", "/attendance");
  await expect(finance).toBeVisible();
  expect((await finance.boundingBox())!.y).toBeGreaterThan((await actions.boundingBox())!.y);
  expect((await finance.boundingBox())!.y).toBeGreaterThan((await schedule.boundingBox())!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test("an office role sees only its shortcut and no fee analysis in bilingual mode", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/?view=today&locale=hi-en&desk=office&theme=dark");
  const actions = page.getByRole("heading", { name: /जल्दी के काम/ }).locator("..");
  await expect(actions.getByRole("link")).toHaveCount(1);
  await expect(actions.getByRole("link")).toHaveAttribute("href", "/attendance");
  await expect(page.getByRole("region", { name: /Fees today|आज की फ़ीस/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});
