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

test("desktop Today starts Fees today straight under the teaching cards, beside the rail (D-528)", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/?view=today&locale=en&desk=admin");
  const finance = page.getByRole("region", { name: "Fees today" });
  await expect(finance).toBeVisible();
  const f = (await finance.boundingBox())!;
  const rail = (await page.locator("aside.td-rail").boundingBox())!;
  const teaching = (await page.locator(".td-grid > .td-main").first().boundingBox())!;
  // Beside the rail, in the wide column, not under the rail's end…
  expect(f.x + f.width).toBeLessThanOrEqual(rail.x);
  // …and no empty stretch between the teaching cards and the money: one grid gap at most.
  expect(f.y - (teaching.y + teaching.height)).toBeLessThanOrEqual(24);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test("in a narrower money column the year's pace and how they pay pair up under the chart (D-528)", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto("/?view=today&locale=en&desk=admin");
  const card = (name: string) => page.locator("section.card", { has: page.getByRole("heading", { name, exact: true }) });
  await expect(card("Year pace")).toBeVisible();
  const chart = (await card("Money taken").boundingBox())!;
  const pace = (await card("Year pace").boundingBox())!;
  const pay = (await card("How they pay").boundingBox())!;
  // Side by side, the same height, under the chart: neither one stretched beside the class table.
  expect(pace.y).toBeGreaterThan(chart.y + chart.height - 1);
  expect(Math.abs(pace.y - pay.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(pace.height - pay.height)).toBeLessThanOrEqual(2);
  expect(pace.x + pace.width).toBeLessThanOrEqual(pay.x);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test("a phone's Today has no desk money section and keeps its own order (D-528)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=today&locale=en&desk=admin");
  await expect(page.getByRole("region", { name: "Fees today" })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});
