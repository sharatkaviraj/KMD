import { expect, test, type Page } from "@playwright/test";

// Chromium on a desktop cannot open Android's IME. Model the independently
// panning visual viewport measured on the real S24, keeping real DOM geometry,
// scrolling, type changes and production event handlers. Device QA is separate.
async function openKeyboardViewport(page: Page, lang: string, shrink = false) {
  await page.setViewportSize({ width: 360, height: 647 });
  await page.goto(`/?lang=${lang}`);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => undefined)));
  });
  const password = page.locator("#password");
  await password.fill("synthetic-password");
  await page.setViewportSize({ width: 703, height: 280 });
  await password.evaluate(node => {
    const input = node as HTMLInputElement;
    input.scrollIntoView({ block: "center", behavior: "instant" });
    input.setSelectionRange(4, 9, "backward");
    input.dataset.original = "yes";
  });
  // Settle native focus/rotation autoscroll before recording any toggle baseline.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    let last = scrollY, stable = performance.now();
    const start = stable;
    function sample(now: number) {
      if (scrollY !== last) { last = scrollY; stable = now; }
      if (now - stable >= 100) resolve();
      else if (now - start > 2000) reject(new Error("Focus scroll did not settle"));
      else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }));
  await password.evaluate((node, shrink) => {
    const input = node as HTMLInputElement, viewport = window.visualViewport!;
    let offset = 140, height = 82;
    Object.defineProperties(viewport, {
      offsetTop: { configurable: true, get: () => offset },
      height: { configurable: true, get: () => height },
    });
    const documentTop = input.getBoundingClientRect().top + scrollY;
    window.scrollTo({ top: documentTop - offset - 20, behavior: "instant" });
    input.parentElement!.querySelector("button")!.addEventListener("pointerdown", () => {
      input.dataset.pointerTop = String(input.getBoundingClientRect().top - offset);
    }, true);
    input.addEventListener("input", () => { input.dataset.typedAt = String(performance.now()); });
    const scrollBy = window.scrollBy.bind(window);
    input.dataset.scrollCalls = "0";
    window.scrollBy = ((...args: Parameters<typeof scrollBy>) => {
      input.dataset.scrollCalls = String(Number(input.dataset.scrollCalls) + 1);
      scrollBy(...args);
    }) as typeof window.scrollBy;
    let previousType = input.type;
    new MutationObserver(() => {
      // React can reassign the same type while restoring an input after
      // typing. Model an IME type switch only when the type actually changes.
      if (input.type === previousType) return;
      previousType = input.type;
      input.dataset.typeChangedAt = String(performance.now());
      const from = offset, to = input.type === "text" ? 181 : 140;
      const samples: { top: number; bottom: number; height: number }[] = [];
      input.dataset.panComplete = "no";
      [40, 100, 185].forEach((delay, index) => setTimeout(() => {
        offset = from + (to - from) * (index + 1) / 3;
        if (index === 2) input.dataset.lastPanAt = String(performance.now());
        if (shrink && index === 2) {
          height = input.type === "text" ? 60 : 82;
          viewport.dispatchEvent(new Event("resize"));
        }
        viewport.dispatchEvent(new Event("scroll"));
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const rect = input.getBoundingClientRect();
          samples.push({ top: rect.top - offset, bottom: rect.bottom - offset, height });
          input.dataset.panSamples = JSON.stringify(samples);
        }));
      }, delay));
      setTimeout(() => { input.dataset.panComplete = "yes"; }, 650);
    }).observe(input, { attributes: true, attributeFilter: ["type"] });
  }, shrink);
  return password;
}

async function geometry(page: Page) {
  return page.locator("#password").evaluate(node => {
    const rect = node.getBoundingClientRect(), viewport = window.visualViewport!;
    return { top: rect.top - viewport.offsetTop, bottom: rect.bottom - viewport.offsetTop, height: rect.height, viewportHeight: viewport.height, scroll: scrollY };
  });
}

async function tapEye(page: Page) {
  const eye = page.locator("#password").locator("..").getByRole("button");
  const box = await eye.boundingBox();
  if (!box) throw new Error("Expected the visible eye button");
  // Locator.tap() scrolls using our modelled viewport. A raw touch on the
  // measured DOM box isolates product movement from Playwright autoscroll.
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

for (const lang of ["en", "hi"]) {
  test(`typing during the pending native pan keeps the field visible: ${lang}`, async ({ page }) => {
    const password = await openKeyboardViewport(page, lang);
    const before = await geometry(page);
    await tapEye(page);
    await page.waitForTimeout(75);
    await page.keyboard.type("Z");
    await expect(password).toHaveAttribute("data-pan-complete", "yes");
    const after = await geometry(page);
    expect(after.top).toBeGreaterThanOrEqual(-1);
    expect(after.bottom).toBeLessThanOrEqual(after.viewportHeight + 1);
    expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
    await expect(password).toHaveValue("syntZ-password");
    await expect(password).toBeFocused();
    expect(await password.evaluate(node => {
      const input = node as HTMLInputElement;
      return [input.dataset.original, input.selectionStart, input.selectionEnd];
    })).toEqual(["yes", 5, 5]);
    const typedAt = Number(await password.getAttribute("data-typed-at"));
    expect(typedAt).toBeGreaterThan(Number(await password.getAttribute("data-type-changed-at")));
    expect(typedAt).toBeLessThan(Number(await password.getAttribute("data-last-pan-at")));
    expect(await page.evaluate(() => window.loginSubmissions)).toBe(0);
  });

  for (const shrink of [false, true]) {
    test(`landscape field stays inside the visual viewport after delayed pan${shrink ? " and resize" : ""}: ${lang}`, async ({ page }, testInfo) => {
      const password = await openKeyboardViewport(page, lang, shrink);
      const evidence = [];
      for (let toggle = 0; toggle < 4; toggle++) {
        const before = await geometry(page);
        await tapEye(page);
        await expect(password).toHaveAttribute("data-pan-complete", "yes");
        const after = await geometry(page);
        // A locator can scroll before clicking. Prove the automation did not
        // move the baseline, then assert rendered geometry, not the ARIA name.
        expect(Math.abs(Number(await password.getAttribute("data-pointer-top")) - before.top)).toBeLessThanOrEqual(1);
        const samples = JSON.parse((await password.getAttribute("data-pan-samples"))!) as { top: number; bottom: number; height: number }[];
        expect(samples).toHaveLength(3);
        for (const sample of samples) {
          expect(sample.top).toBeGreaterThanOrEqual(-1);
          expect(sample.bottom).toBeLessThanOrEqual(sample.height + 1);
          const expected = Math.max(0, Math.min(before.top, sample.height - before.height));
          expect(Math.abs(sample.top - expected)).toBeLessThanOrEqual(1);
        }
        await expect(password).toBeFocused();
        await expect(password).toHaveValue("synthetic-password");
        expect(await password.evaluate(node => {
          const input = node as HTMLInputElement;
          return [input.dataset.original, input.selectionStart, input.selectionEnd, input.selectionDirection];
        })).toEqual(["yes", 4, 9, "backward"]);
        expect(await page.evaluate(() => window.loginSubmissions)).toBe(0);
        evidence.push({ before, after, samples });
      }
      await password.evaluate(node => (node as HTMLInputElement).setSelectionRange(4, 4));
      await page.keyboard.type("X");
      await expect(password).toHaveValue("syntXhetic-password");
      await testInfo.attach("visual-viewport-geometry", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
    });
  }

  test(`a deliberate scroll cancels toggle compensation: ${lang}`, async ({ page }) => {
    const password = await openKeyboardViewport(page, lang);
    await tapEye(page);
    await page.mouse.move(500, 200);
    await page.mouse.wheel(0, -30);
    await page.waitForTimeout(120);
    const userScroll = await page.evaluate(() => scrollY);
    await expect(password).toHaveAttribute("data-pan-complete", "yes");
    expect(await page.evaluate(() => scrollY)).toBe(userScroll);
    await expect(password).toBeFocused();
    expect(await page.evaluate(() => window.loginSubmissions)).toBe(0);
  });

  test(`Tab cancels compensation and keeps focus on the eye: ${lang}`, async ({ page }) => {
    const password = await openKeyboardViewport(page, lang);
    const eye = password.locator("..").getByRole("button");
    await tapEye(page);
    await page.keyboard.press("Tab");
    await expect(eye).toBeFocused();
    // Native Tab focus may scroll to reveal the eye. Count programmatic
    // corrections separately so that normal browser movement is allowed.
    const scrollCalls = await password.getAttribute("data-scroll-calls");
    await expect(password).toHaveAttribute("data-pan-complete", "yes");
    await expect(password).toHaveAttribute("data-scroll-calls", scrollCalls!);
    await expect(eye).toBeFocused();
    expect(await page.evaluate(() => window.loginSubmissions)).toBe(0);
  });
}
