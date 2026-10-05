import { devices, expect, test } from "@playwright/test";

// These public checks can also run against the production alias without an account.
for (const device of ["desktop", "android"] as const) {
  test(`PWA installation metadata and offline launch on ${device}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      ...(device === "android" ? devices["Pixel 7"] : { viewport: { width: 1440, height: 1000 } }),
    });
    try {
      const page = await context.newPage();
      await page.goto("/login");
      await expect(page.locator('img[alt="Veer Patta Public School logo"]').first()).toBeVisible();
      const manifestResponse = await page.request.get("/manifest.webmanifest");
      expect(manifestResponse.ok()).toBe(true);
      const manifest = await manifestResponse.json();
      expect(manifest.name).toContain("Veer Patta Public School");
      expect(manifest.id).toBe("/");
      expect(manifest.scope).toBe("/");
      expect(manifest.start_url).toBe("/");
      expect(manifest.display).toBe("standalone");
      for (const icon of manifest.icons) {
        const response = await page.request.get(icon.src);
        expect(response.ok()).toBe(true);
      }
      const cdp = await context.newCDPSession(page);
      const browserManifest = await cdp.send("Page.getAppManifest");
      expect(browserManifest.errors).toEqual([]);
      const installability = await cdp.send("Page.getInstallabilityErrors");
      expect(installability.installabilityErrors).toEqual([]);
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await page.reload();
      await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
      await context.setOffline(true);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Reconnect to open VPPS One" })).toBeVisible();
      await context.setOffline(false);
      const cachedPaths = await page.evaluate(async () => {
        const names = await caches.keys();
        return (await Promise.all(names.map(async name =>
          (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)
        ))).flat();
      });
      expect(cachedPaths).toContain("/branding/icon-192.png");
      expect(cachedPaths).toContain("/branding/icon-512.png");
      expect(cachedPaths.some(path => /^(\/api\/|\/teach|\/fees|\/r\/)/.test(path))).toBe(false);
    } finally {
      await context.close();
    }
  });
}

test("iPhone sign-in explains Safari home-screen installation", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, ...devices["iPhone 13"] });
  try {
    const page = await context.newPage();
    await page.goto("/login");
    await expect(page.locator("main")).toContainText(/Safari/);
    await expect(page.locator("main")).toContainText(/Add to Home Screen|होम स्क्रीन पर जोड़ें/);
  } finally {
    await context.close();
  }
});
