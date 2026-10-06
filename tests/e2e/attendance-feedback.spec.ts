import { expect, test } from "@playwright/test";
import { ownClassOf, signIn, unrecordedSchoolDays } from "./support/harness";

test("attendance taps preserve row geometry and respect reduced motion", async ({ page }) => {
  const scene = await ownClassOf("teacher");
  const [day] = await unrecordedSchoolDays(scene.classId, scene.sessionLabel, 1, 30);
  await signIn(page, "teacher", `/teach/attendance?class=${scene.classId}&day=${day}`);
  const row = page.locator("[data-student]").first();
  await row.scrollIntoViewIfNeeded();
  const before = await row.boundingBox();
  const statuses = row.getByRole("button");
  expect(await statuses.count()).toBe(5);
  for (let index = 0; index < 20; index++) {
    const status = statuses.nth(index % 5);
    await status.click();
    await expect(status).toHaveAttribute("aria-pressed", "true");
    expect(await row.boundingBox()).toEqual(before);
  }
  const button = statuses.first();
  await button.hover();
  await page.mouse.down();
  await expect.poll(() => button.evaluate(element => getComputedStyle(element).transform)).not.toBe("none");
  expect(await row.boundingBox()).toEqual(before);
  await page.mouse.up();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await button.hover();
  await page.mouse.down();
  expect(await button.evaluate(element => getComputedStyle(element).transform)).toBe("none");
  expect(await button.evaluate(element => Math.max(...getComputedStyle(element).transitionDuration.split(",").map(Number.parseFloat)))).toBeLessThanOrEqual(0.00001);
  await page.mouse.up();
  // Feedback animates only while navigation is in flight.
  await expect(page.locator(".anim-route-progress")).toHaveCount(0);
});
