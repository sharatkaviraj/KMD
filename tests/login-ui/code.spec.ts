import { expect, test, type Page } from "@playwright/test";

// Sign in with a WhatsApp code (D-585), redrawn 12 Nov after the owner found
// it "not optimised" on his phone: on a Galaxy M32 the keyboard covered Send
// code and Sign in, and the code step was taller than the screen. Chromium on
// a desktop cannot open a phone keyboard, so the keyboard is a shorter
// viewport here; device QA is BrowserStack.

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => undefined)));
  });
}

async function bottomOf(page: Page, selector: string) {
  return page.locator(selector).first().evaluate(node => node.getBoundingClientRect().bottom);
}

for (const lang of ["en", "hi", "both"]) for (const viewport of [{ width: 360, height: 640 }, { width: 412, height: 800 }]) {
  test(`both steps fit one phone screen, the big button in sight: ${lang} ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`/?code=1&sent=1&lang=${lang}`);
    await settle(page);
    const send = 'form button[type="submit"]';
    expect(await bottomOf(page, send)).toBeLessThanOrEqual(viewport.height);

    await page.locator("#phone").fill("9876543210");
    await page.locator(send).click();
    await expect(page.locator("#code")).toBeVisible();
    await settle(page);
    // Sign in, and the two buttons that get the code there, without scrolling.
    expect(await bottomOf(page, 'form:has(#code) button[type="submit"]')).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    // Every button's icon keeps its size and every label stays inside its
    // button: the first live phone showed the key icon squeezed to a dot
    // beside "Email and password".
    const cramped = await page.evaluate(() => [...document.querySelectorAll(".lg-code .btn")].flatMap(button => {
      const box = button.getBoundingClientRect();
      const icons = [...button.querySelectorAll("svg")].filter(icon => icon.getBoundingClientRect().width < 16);
      return icons.length > 0 || button.scrollWidth > button.clientWidth + 1 || box.right > window.innerWidth ? [button.textContent?.trim()] : [];
    }));
    expect(cramped).toEqual([]);
  });
}

for (const lang of ["en", "hi"]) {
  test(`with the keyboard up, Send code and then Sign in stay above it: ${lang}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(`/?code=1&sent=1&lang=${lang}`);
    await settle(page);
    const keyboardUp = { width: 360, height: 330 };

    await page.locator("#phone").focus();
    await page.setViewportSize(keyboardUp);
    const send = page.locator('form button[type="submit"]').first();
    await expect.poll(async () => (await send.boundingBox())!.y + (await send.boundingBox())!.height).toBeLessThanOrEqual(keyboardUp.height);

    await page.setViewportSize({ width: 360, height: 640 });
    await page.locator("#phone").fill("9876543210");
    await send.click();
    await expect(page.locator("#code")).toBeVisible();
    await page.locator("#code").focus();
    await page.setViewportSize(keyboardUp);
    const signIn = page.locator('form:has(#code) button[type="submit"]');
    await expect.poll(async () => {
      const box = (await signIn.boundingBox())!;
      return box.y >= 0 && box.y + box.height <= keyboardUp.height;
    }).toBe(true);
    // The box being typed into is still in sight too.
    const code = (await page.locator("#code").boundingBox())!;
    expect(code.y).toBeGreaterThanOrEqual(0);
  });
}

// A Galaxy M32 on BrowserStack (12 Nov): with the keyboard up, the first tap
// on Send code, and on Change, only closed the keyboard. The tap moved focus
// off the box, the keyboard went and the page dropped back under the finger.
// A desktop Chromium has no keyboard to close, so this checks the cause: at
// the moment of the click the box being typed into still has focus.
test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });
  test("a tap on Send code, then on Change, leaves the box focused until the click", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto("/?code=1&sent=1&lang=en");
    await settle(page);
    await page.evaluate(() => document.addEventListener("click", () => {
      (window as unknown as { focusAtClick: string }).focusAtClick = document.activeElement?.id || document.activeElement?.tagName || "";
    }, { capture: true }));
    const focusAtClick = () => page.evaluate(() => (window as unknown as { focusAtClick: string }).focusAtClick);

    await page.locator("#phone").fill("9876543210");
    await page.locator("#phone").focus();
    await page.locator('form button[type="submit"]').first().tap();
    expect(await focusAtClick()).toBe("phone");
    await expect(page.locator("#code")).toBeVisible();

    await page.locator("#code").focus();
    await page.getByRole("button", { name: "Change number" }).tap();
    expect(await focusAtClick()).toBe("code");
    await expect(page.locator("#phone")).toBeVisible();
  });
});
