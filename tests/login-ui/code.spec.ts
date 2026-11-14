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

    // A press and release sent separately, as BrowserStack's driver sends
    // them, which is how the Galaxy M32 check met it: the box keeps focus.
    await page.locator("#phone").focus();
    await page.getByRole("radio", { name: "Password" }).click();
    expect(await focusAtClick()).toBe("phone");
    await expect(page.locator("#password")).toBeVisible();
  });
});

// D-608 (the owner, 14 Nov): "by default the main method should be by phone
// only, phone and OTP", with email and password still there. His phone had
// opened on the password for good after one tap on Email and password.
test.describe("phone first, password beside it", () => {
  for (const code of ["1", "owner"]) {
    test(`the page opens on the mobile number with Password one tap away (code=${code})`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 640 });
      // What a phone kept from before D-608 no longer decides anything.
      await page.addInitScript(() => localStorage.setItem("vx:login:way", "password"));
      await page.goto(`/?code=${code}&lang=en`);
      await expect(page.locator("#phone")).toBeVisible();
      await expect(page.getByRole("radio", { name: "WhatsApp code" })).toHaveAttribute("aria-checked", "true");
      await expect(page.getByRole("radio", { name: "Password" })).toHaveAttribute("aria-checked", "false");
      expect(await page.evaluate(() => localStorage.getItem("vx:login:way"))).toBeNull();

      await page.getByRole("radio", { name: "Password" }).click();
      await expect(page.locator("#password")).toBeVisible();
      await expect(page.getByRole("radio", { name: "Password" })).toHaveAttribute("aria-checked", "true");
      await page.getByRole("radio", { name: "WhatsApp code" }).click();
      await expect(page.locator("#phone")).toBeVisible();

      // A tap is for this visit only: the next visit opens on the number again.
      await page.getByRole("radio", { name: "Password" }).click();
      await page.reload();
      await expect(page.locator("#phone")).toBeVisible();
    });
  }

  for (const lang of ["en", "hi", "both"]) {
    test(`each way's label fits on one line in its half at 360px: ${lang}`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 640 });
      await page.goto(`/?code=1&lang=${lang}`);
      await settle(page);
      const lines = await page.locator('[role="radio"]').evaluateAll(radios => radios.map(radio => {
        const first = radio.querySelector("span > span");
        const height = first ? first.getBoundingClientRect().height : 0;
        const size = first ? parseFloat(getComputedStyle(first).lineHeight) || 18 : 18;
        return { lines: Math.round(height / size), overflow: radio.scrollWidth > radio.clientWidth + 1 };
      }));
      expect(lines).toEqual([{ lines: 1, overflow: false }, { lines: 1, overflow: false }]);
    });
  }

  test("with the code off there is no switch, only email and password", async ({ page }) => {
    await page.goto("/?lang=en");
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByRole("radiogroup")).toHaveCount(0);
  });

  test("a number without codes yet is told so, Password is the next step, and that phone opens there next time", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto("/?code=owner&sent=notyet&lang=en");
    await page.locator("#phone").fill("9876543210");
    await page.getByRole("button", { name: "Send code on WhatsApp" }).click();
    await expect(page.getByRole("alert")).toContainText("not on for this number yet");
    const next = page.getByRole("button", { name: "Use email and password instead" });
    await expect(next).toHaveClass(/\bpri\b/);
    await expect(page.getByRole("button", { name: "Send code on WhatsApp" })).toHaveClass(/\bsec\b/);
    await settle(page);
    expect(await bottomOf(page, "button.pri")).toBeLessThanOrEqual(640);

    await next.click();
    await expect(page.locator("#password")).toBeVisible();
    // Only once the person signs in that way does the phone remember.
    expect(await page.evaluate(() => localStorage.getItem("vx:login:no-code"))).toBeNull();
    await page.locator("#email").fill("staff@example.com");
    await page.locator("#password").fill("not-a-real-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("vx:login:no-code"))).toBe("1");

    await page.reload();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByRole("radio", { name: "WhatsApp code" })).toBeVisible();
    // With codes on for all staff, that memory no longer holds the phone back.
    await page.goto("/?code=1&lang=en");
    await expect(page.locator("#phone")).toBeVisible();
  });
});

// D-608: back from WhatsApp with the code copied, it goes in by itself where
// the browser lets the page read the clipboard, and Paste code lights up where
// it does not. Chromium's clipboard permission stands in for the person's Allow.
test.describe("the code from WhatsApp", () => {
  async function toCodeStep(page: Page) {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto("/?code=1&sent=1&lang=en");
    await page.locator("#phone").fill("9876543210");
    await page.getByRole("button", { name: "Send code on WhatsApp" }).click();
    await expect(page.locator("#code")).toBeVisible();
  }
  const copy = (page: Page, text: string) => page.evaluate((value) => navigator.clipboard.writeText(value), text);
  const comeBack = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("focus")));

  test("goes in and signs in by itself once the page may read what was copied", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await toCodeStep(page);
    await expect(page.locator("#code-paste-hint")).toContainText("the code goes in by itself");
    await copy(page, "Your VPPS One code is 482913");
    await comeBack(page);
    await expect(page.locator("#code")).toHaveValue("482913");
    await expect.poll(() => page.evaluate(() => window.codeChecks)).toEqual(["482913"]);
    // A code already tried is not tried again on the next return.
    await comeBack(page);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.codeChecks)).toEqual(["482913"]);
  });

  test("never uses what was already copied before the code step, or a longer number", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/?code=1&sent=1&lang=en");
    await copy(page, "111111");
    await toCodeStep(page);
    await page.waitForTimeout(300);
    await comeBack(page);
    await page.waitForTimeout(1500);
    await copy(page, "9680312345");
    await comeBack(page);
    await page.waitForTimeout(1500);
    await expect(page.locator("#code")).toHaveValue("");
    expect(await page.evaluate(() => window.codeChecks)).toEqual([]);
  });

  test("where the page may not read it, Paste code becomes the next step on coming back", async ({ page }) => {
    await toCodeStep(page);
    const paste = page.getByRole("button", { name: "Paste code" });
    await expect(paste).toHaveClass(/\bsec\b/);
    await expect(page.locator("#code-paste-hint")).toContainText("tap Paste code");
    await comeBack(page);
    await expect(paste).toHaveClass(/\bpri\b/);
    expect(await page.evaluate(() => window.codeChecks)).toEqual([]);
  });
});
