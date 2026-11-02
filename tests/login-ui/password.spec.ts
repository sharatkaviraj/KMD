import { expect, test } from "@playwright/test";

for (const lang of ["en", "hi"]) for (const viewport of [{ width: 360, height: 647 }, { width: 647, height: 360 }, { width: 412, height: 797 }]) {
  test(`touch toggles retain the input, selection and scroll: ${lang} ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`/?lang=${lang}&next=%2F`);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => undefined)));
    });
    const password = page.locator("#password");
    await password.fill("synthetic-password");
    await password.evaluate(node => {
      if (!(node instanceof HTMLInputElement)) throw new Error("Expected the password input");
      node.scrollIntoView({ block: "center", behavior: "instant" });
      node.dataset.original = "yes";
      node.setSelectionRange(4, 9, "backward");
      node.addEventListener("blur", () => { node.dataset.blurred = "yes"; });
    });
    // Native focus/selection can schedule autoscroll before any pointer event.
    // Record the baseline after that settles; the toggle must keep it exactly.
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
      let last = scrollY, stable = performance.now();
      const start = stable;
      const sample = (now: number) => {
        if (scrollY !== last) { last = scrollY; stable = now; }
        if (now - stable >= 100) resolve();
        else if (now - start > 2000) reject(new Error("Password focus scroll did not settle"));
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
    const before = await page.evaluate(() => [scrollX, scrollY]);
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: lang === "hi" ? (i % 2 ? "पासवर्ड छिपाएँ" : "पासवर्ड दिखाएँ") : (i % 2 ? "Hide password" : "Show password"), exact: true }).tap();
      await expect(password).toBeFocused();
      await expect(password).toHaveValue("synthetic-password");
      expect(await password.evaluate(node => { const input = node as HTMLInputElement; return [input.dataset.original, input.dataset.blurred ?? null, input.selectionStart, input.selectionEnd, input.selectionDirection]; })).toEqual(["yes", null, 4, 9, "backward"]);
      expect(await page.evaluate(() => [scrollX, scrollY])).toEqual(before);
      expect(await page.evaluate(() => window.loginSubmissions)).toBe(0);
    }
    await password.evaluate(node => (node as HTMLInputElement).setSelectionRange(4, 4));
    await page.keyboard.type("X");
    await expect(password).toHaveValue("syntXhetic-password");
    await page.screenshot({ path: `test-results/login/touch-${lang}-${viewport.width}.png` });
  });
}

for (const lang of ["en", "hi"]) {
  test(`keyboard activation keeps focus on the eye and never submits: ${lang}`, async ({ page }) => {
    await page.goto(`/?lang=${lang}`);
    const password = page.locator("#password");
    await password.fill("synthetic-password");
    await page.keyboard.press("Tab");
    const eye = password.locator("..").getByRole("button");
    await expect(eye).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(eye).toBeFocused();
    await expect(password).toHaveAttribute("type", "text");
    await page.keyboard.press("Space");
    await expect(eye).toBeFocused();
    await expect(password).toHaveAttribute("type", "password");
    await expect(eye).toHaveAttribute("type", "button");
    expect(await page.evaluate(() => window.loginSubmissions)).toBe(0);
    await page.keyboard.press("Tab");
    await expect(eye).not.toBeFocused();
  });

  test(`failed login preserves email, clears password and focuses the error: ${lang}`, async ({ page }) => {
    await page.goto(`/?lang=${lang}&next=%2F`);
    await page.locator("#email").fill("synthetic@example.invalid");
    await page.locator("#password").fill("synthetic-password");
    await page.getByRole("button", { name: lang === "hi" ? "साइन इन करें" : "Sign in", exact: true }).click();
    await expect(page.locator("#login-error")).toBeFocused();
    await expect(page.locator("#email")).toHaveValue("synthetic@example.invalid");
    await expect(page.locator("#password")).toHaveValue("");
    await expect(page.locator('[name="next"]')).toHaveValue("/");
    expect(await page.evaluate(() => window.loginSubmissions)).toBe(1);
  });
}
