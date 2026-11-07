import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const width of [320, 390, 768, 1024, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`workspace composes without clipping at ${width}px/${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/one-polish.html?theme=${theme}&label=TEST-2026-27`);
      const trigger = page.getByRole("button", { name: /Change academic session/ });
      await expect(trigger).toBeVisible();
      await expect(trigger).toContainText("TEST-2026-27");
      await expect(page.getByRole("heading", {name: "Good morning, Test"})).toBeVisible();
      if (width === 390 && theme === "light") await page.screenshot({path: test.info().outputPath("one-mobile.png")});
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      const bar = await page.locator(".vx-workspace-bar").boundingBox();
      expect(bar!.height).toBeLessThanOrEqual(64);
      const box = await trigger.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      if (width < 900) {
        expect(box!.height).toBeGreaterThanOrEqual(44);
        const hero = await page.getByRole("heading", {name: "Good morning, Test"}).boundingBox();
        expect(hero!.y).toBeLessThan(180);
      }
      await trigger.click();
      if (width < 900) {
        const dialog = page.getByRole("dialog", { name: "Academic session" });
        await expect(dialog).toBeVisible();
        expect((await dialog.boundingBox())!.height).toBeLessThan(600);
        const axe = await new AxeBuilder({ page }).include(".vx-workspace-bar, #vx-layer").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(axe.violations).toEqual([]);
        await page.keyboard.press("Escape");
        await expect(dialog).not.toBeVisible();
        await expect(trigger).toBeFocused();
        expect(await page.locator("body").evaluate(el => el.style.overflow)).not.toBe("hidden");
      } else {
        await expect(page.getByRole("menu")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).not.toBeVisible();
      }
    });
  }
}

test("Hindi labels and roster warnings wrap at 320px in dark mode", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/one-polish.html?locale=hi&theme=dark&stale&label=TEST-2026-27");
  await expect(page.locator(".vx-roster-warning")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await page.locator(".vx-sessionbar-m button").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("TEST-2026-27");
  expect((await new AxeBuilder({ page }).include("#vx-layer").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
});

test("native picker retries catalogue failures and does not navigate on close", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/one-polish.html?failed");
  const trigger = page.locator(".vx-sessionbar-m button");
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(new URL(page.url()).pathname).toBe("/one-polish.html");
});

test("picker switches once, clears stale filters, and Back dismisses it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/one-polish.html?list&q=old&page=3");
  await page.evaluate(() => {
    document.body.dataset.switchCount = "0";
    window.addEventListener("qa:session-switch", () => { document.body.dataset.switchCount = String(Number(document.body.dataset.switchCount) + 1); });
  });
  await page.locator(".vx-sessionbar-m button").click();
  await page.goBack();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".vx-sessionbar-m button")).toBeFocused();
  expect(await page.locator("body").evaluate(el => el.style.overflow)).not.toBe("hidden");
  await page.locator(".vx-sessionbar-m button").click();
  await page.getByRole("dialog").getByRole("button", { name: /TEST-2026-27/ }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("session")).toBe("TEST-2026-27");
  expect(new URL(page.url()).searchParams.has("q")).toBe(false);
  expect(new URL(page.url()).searchParams.has("page")).toBe(false);
  expect(await page.locator("body").getAttribute("data-switch-count")).toBe("1");
});

test("a year switch names the year it opened, then gets out of the way", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/one-polish.html?slow-switch");
  await page.locator(".vx-sessionbar-m button").click();
  await page.getByRole("dialog").getByRole("button", { name: /TEST-2026-27/ }).click();
  // D-515: the switch is seen, "Opening …" while it runs and "Now showing …" once the year has arrived.
  await expect(page.locator('[data-session-switch-card="opening"]')).toContainText("Opening TEST-2026-27");
  const landed = page.locator('[data-session-switch-card="landed"]');
  await expect(landed).toContainText("Now showing TEST-2026-27");
  await expect(landed).toBeHidden({ timeout: 4_000 });
  await expect(page.locator('[data-session-switch-card]')).toHaveCount(0);
});

test("roster details and ledger explanation keep exact evidence and links available", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/one-polish.html");
  await page.locator(".vx-roster summary").click();
  await expect(page.locator(".vx-roster time")).toHaveAttribute("datetime", "2026-11-02T11:30:00.000Z");
  await page.locator(".only-m .vx-ledger-notice summary").click();
  await expect(page.locator('.only-m .vx-ledger-notice a[href="/payments"]')).toBeVisible();
  await expect(page.locator('.only-m .vx-ledger-notice a[href="/dues"]')).toBeVisible();
});

test("reduced-motion sheets finish closing promptly and list rows do not move", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/one-polish.html?list");
  await page.getByRole("button", { name: "Open sheet" }).click();
  const dialog = page.getByRole("dialog", { name: "Synthetic sheet" });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(el => parseFloat(getComputedStyle(el).animationDuration))).toBeLessThanOrEqual(.001);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible({ timeout: 200 });
  await expect(page.getByRole("button", {name: "Open sheet"})).toBeFocused();
  expect(await page.getByRole("row").nth(1).evaluate(el => getComputedStyle(el).transform)).toBe("none");
});


test("Suspense preserves TEST identity and geometry while catalogue resolves", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/one-polish.html?delayed&label=TEST-2026-27", {waitUntil: "domcontentloaded"});
  const placeholder = page.locator(".vx-sessionbar-m .vx-session-placeholder");
  await expect(placeholder).toContainText("TEST-2026-27");
  const before = await placeholder.boundingBox();
  const trigger = page.locator(".vx-sessionbar-m button");
  await expect(trigger).toBeVisible();
  const after = await trigger.boundingBox();
  expect(after!.width).toBe(before!.width);
  expect(after!.height).toBe(before!.height);
  await expect(trigger).toContainText("TEST-2026-27");
});

for (const condition of ["only-test&label=TEST-2026-27", "loading"]) {
  test("keyboard stays in a picker without enabled choices: " + condition, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/one-polish.html?" + condition);
    await page.locator(".vx-sessionbar-m button").click();
    const close = page.getByRole("dialog").getByRole("button", {name: "Close", exact: true});
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(close).toBeFocused();
  });
}

test("a session that arrives while the picker is open joins the keyboard loop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/one-polish.html?arrives");
  await page.locator(".vx-sessionbar-m button").click();
  const dialog = page.getByRole("dialog");
  const close = dialog.getByRole("button", {name: "Close", exact: true});
  const row = dialog.getByRole("button", {name: /TEST-2026-27/});
  await expect(row).toBeEnabled();
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(row).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
});

test("catalogue retry recovers into available sessions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/one-polish.html?failed&recover");
  await page.locator(".vx-sessionbar-m button").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", {name: "Try again"}).click();
  await expect(dialog.getByRole("button", {name: /TEST-2026-27/})).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});

for (const status of ["error", "pending"]) {
  test("full " + status + " roster warning remains visible in dark Hindi", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto("/one-polish.html?locale=hi&theme=dark&status=" + status);
    await expect(page.locator(".vx-roster-warning")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    expect((await new AxeBuilder({ page }).include(".vx-workspace-bar").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  });
}

for (const width of [320, 1440]) {
  test("archived and long labels remain complete at " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const label = "HISTORICALDEMONSTRATIONSESSIONARCHIVE-2025-26";
    await page.goto("/one-polish.html?label=" + label);
    const trigger = page.locator(width < 900 ? ".vx-sessionbar-m button" : ".vx-sessionbar-d button");
    await expect(trigger).toContainText(label);
    await expect(trigger).not.toHaveAttribute("data-live", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await trigger.click();
    const row = width < 900 ? page.getByRole("dialog").getByRole("button", {name: label, exact: true}) : page.getByRole("menuitem", {name: label, exact: true});
    await expect(row).toBeVisible();
    expect(await row.locator("span").first().evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
}


for (const theme of ["light", "dark"]) {
  test("phone toolbar retains contrast under mouse hover in " + theme, async ({ page }) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto("/one-polish.html?theme=" + theme);
    await page.locator(".vx-sessionbar-m button").hover();
    expect((await new AxeBuilder({page}).include(".vx-workspace-bar").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  });
}
