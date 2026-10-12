import { expect, test } from "@playwright/test";
for (const [width, height] of [[360, 800], [390, 844], [412, 915], [844, 390]]) test(`${width}x${height} expired original can explicitly correct date while keeping its UUID`, async ({ page, context }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width, height });
  await context.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:3211" && route.request().method() === "GET" ? route.continue() : route.abort());
  await page.goto("/?run=expired&serverToday=2026-10-12");
  await page.getByRole("button", { name: "Log family contact", exact: true }).tap();
  const dialog = page.getByRole("dialog", { name: "Log family contact", exact: true });
  await dialog.getByRole("button", { name: "Follow-up agreed", exact: true }).tap();
  await dialog.locator('input[type="date"]').fill("2026-10-11");
  await dialog.locator("textarea").fill("OPS expired-date correction conversation");
  await dialog.getByRole("button", { name: "Save", exact: true }).tap();
  await expect(dialog.getByRole("alert")).toContainText("past");
  const initial = await page.evaluate(() => window.moduleContactSnapshot());
  expect(initial.records).toEqual([]); expect(initial.calls).toHaveLength(1);
  await dialog.getByRole("button", { name: "Check original result", exact: true }).tap();
  await expect(dialog.getByRole("button", { name: "Retry same contact", exact: true })).toBeVisible();
  await expect(dialog.locator('input[type="date"]')).toBeEnabled();
  await dialog.locator('input[type="date"]').fill("2026-10-12");
  const correct = dialog.getByRole("button", { name: "Correct date on same contact", exact: true });
  await correct.scrollIntoViewIfNeeded();
  const geometry = await correct.evaluate(button => { const r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { width: r.width, height: r.height, hit: hit === button || button.contains(hit), overflow: document.documentElement.scrollWidth > innerWidth }; });
  expect(geometry.width).toBeGreaterThanOrEqual(44); expect(geometry.height).toBeGreaterThanOrEqual(44); expect(geometry.hit).toBe(true); expect(geometry.overflow).toBe(false);
  await correct.tap();
  await expect(dialog).not.toBeVisible();
  const final = await page.evaluate(() => window.moduleContactSnapshot());
  expect(final.records).toHaveLength(1); expect(final.records[0]).toMatchObject({ attemptId: initial.calls[0].attemptId, agreedOn: "2026-10-12" });
  expect(new Set(final.calls.map(row => row.attemptId)).size).toBe(1); expect(final.sends).toBe(0);
});

for (const scenario of ["lost", "originalWins"]) test(`390px ${scenario} correction recovers the actual winning date with the same UUID`, async ({ page, context }) => {
  test.setTimeout(60_000); await page.setViewportSize({ width: 390, height: 844 });
  await context.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:3211" && route.request().method() === "GET" ? route.continue() : route.abort());
  await page.goto(`/?run=correction-${scenario}&serverToday=2026-10-12&${scenario}`);
  await page.getByRole("button", { name: "Log family contact", exact: true }).tap(); const dialog = page.getByRole("dialog", { name: "Log family contact", exact: true });
  await dialog.getByRole("button", { name: "Follow-up agreed", exact: true }).tap(); await dialog.locator('input[type="date"]').fill("2026-10-11"); await dialog.locator("textarea").fill("OPS correction winner conversation"); await dialog.getByRole("button", { name: "Save", exact: true }).tap();
  await expect(dialog.getByRole("alert")).toContainText("past"); const initial = await page.evaluate(() => window.moduleContactSnapshot());
  await dialog.locator('input[type="date"]').fill("2026-10-12"); await dialog.getByRole("button", { name: "Correct date on same contact", exact: true }).tap();
  if (scenario === "lost") {
    await expect(dialog.getByRole("alert")).toContainText("Could not confirm");
    const durable = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("vx-contact:v1:")).map(key => JSON.parse(localStorage.getItem(key)!)));
    expect(durable).toHaveLength(1); expect(durable[0].payload).toEqual(initial.calls[0]); expect(durable[0].dateCorrections).toEqual(["2026-10-12"]);
    await page.reload(); await page.getByRole("button", { name: "Log family contact", exact: true }).tap(); await dialog.getByRole("button", { name: "Check original result", exact: true }).tap();
  }
  await expect(dialog).not.toBeVisible(); const winner = scenario === "originalWins" ? "2026-10-11" : "2026-10-12";
  await expect(page.getByText(`Family contact recorded · agreed date ${winner}`, { exact: true })).toBeVisible();
  const final = await page.evaluate(() => window.moduleContactSnapshot()); expect(final.records).toHaveLength(1); expect(final.records[0]).toMatchObject({ attemptId: initial.calls[0].attemptId, agreedOn: winner }); expect(final.calls).toHaveLength(2); expect(final.sends).toBe(0);
});
