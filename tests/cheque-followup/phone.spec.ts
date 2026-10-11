import { expect, test } from "@playwright/test";

const phones = [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 844, height: 390 }];
for (const viewport of phones) test(`receipt cheque draft preserves actual date and bank ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
  await page.setViewportSize(viewport);
  await page.goto("/?path=/accounts/books");
  const addDetails = page.getByRole("button", { name: "Add details", exact: true });
  await addDetails.scrollIntoViewIfNeeded();
  const geometry = await addDetails.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const nav = document.querySelector("nav.vx-bottom")?.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { width: rect.width, height: rect.height, gap: nav ? nav.top - rect.bottom : null, ownsCenter: hit === button || !!hit && button.contains(hit) };
  });
  await testInfo.attach("last-row-action-geometry", { body: JSON.stringify(geometry), contentType: "application/json" });
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.gap).not.toBeNull();
  expect(geometry.gap!).toBeGreaterThanOrEqual(12);
  expect(geometry.ownsCenter).toBe(true);
  await addDetails.evaluate((button) => button.addEventListener("click", (event) => button.setAttribute("data-ops-trusted-click", String(event.isTrusted)), { once: true }));
  await addDetails.tap();
  await expect(addDetails).toHaveAttribute("data-ops-trusted-click", "true");
  const dialog = page.getByRole("dialog", { name: "Cheque details", exact: true });
  await testInfo.attach("draft-fields", { body: JSON.stringify({ bank: await dialog.getByLabel("Bank and branch", { exact: true }).inputValue(), chequeDate: await dialog.getByLabel("Date on the cheque", { exact: true }).inputValue(), paymentDate: "2026-04-03", expectedChequeDate: "2026-04-01" }), contentType: "application/json" });
  await expect(dialog.getByLabel("Cheque number", { exact: true })).toHaveValue("004518");
  await expect(dialog.getByLabel("Date on the cheque", { exact: true })).toHaveValue("2026-04-01");
  await expect(dialog.getByLabel("Bank and branch", { exact: true })).toHaveValue("OPS Synthetic Bank");
  await expect(dialog).toContainText("OPS-IMP05 synthetic receipt memo");
  expect(await page.evaluate(() => localStorage.getItem("ops-imp05-save-attempts"))).toBeNull();
  await dialog.getByRole("button", { name: "Close", exact: true }).tap();
  expect(await page.evaluate(() => localStorage.getItem("ops-imp05-save-attempts"))).toBeNull();
  await page.getByRole("button", { name: "Add details", exact: true }).tap();
  await page.getByRole("dialog", { name: "Cheque details", exact: true }).getByRole("button", { name: "Save details", exact: true }).tap();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("ops-imp05-save-attempts") ?? "[]"))).toEqual([{ receiptId: "00000000-0000-4000-8000-000000000501", chequeNo: "004518", bank: "OPS Synthetic Bank", chequeDate: "2026-04-01" }]);
});

test("separately confirmed cheque metadata wins over receipt draft", async ({ page }) => {
  await page.goto("/?path=/accounts/books&canonical");
  await page.getByRole("button", { name: "Add details", exact: true }).tap();
  const dialog = page.getByRole("dialog", { name: "Cheque details", exact: true });
  await expect(dialog.getByLabel("Bank and branch", { exact: true })).toHaveValue("OPS Reviewed Canonical Bank");
  await expect(dialog.getByLabel("Date on the cheque", { exact: true })).toHaveValue("2026-03-31");
});
for (const mode of ["legacy", "ambiguous"]) test(`${mode} receipt cannot silently suggest a bank/date`, async ({ page }) => {
  await page.goto(`/?path=/accounts/books&${mode}`);
  await page.getByRole("button", { name: "Add details", exact: true }).tap();
  const dialog = page.getByRole("dialog", { name: "Cheque details", exact: true });
  await expect(dialog.getByLabel("Bank and branch", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("Date on the cheque", { exact: true })).toHaveValue("2026-04-03");
  await expect(dialog).toContainText(mode === "legacy" ? "Legacy memo; bank supplied in person" : "Another Bank");
});
test("read-only preview offers no cheque metadata save", async ({ page }) => {
  await page.goto("/?path=/accounts/books&readonly");
  await expect(page.getByRole("button", { name: "Add details", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("ops-imp05-save-attempts"))).toBeNull();
});
