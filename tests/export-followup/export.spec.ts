import { readFile } from "node:fs/promises";
import { expect, test, type Download } from "@playwright/test";

const name = '=HYPERLINK("https://example.invalid","QA Export")';

async function checkCsv(download: Download, attach: (csv: string) => Promise<void>) {
  expect(download.suggestedFilename()).toBe("students-OPS-EXPORT-2026.csv");
  const csv = await readFile((await download.path())!, "utf8");
  await attach(csv);
  expect(csv.startsWith("﻿")).toBe(true);
  // Quoting alone does not prevent spreadsheet evaluation: string data must be text.
  expect(csv.split("\r\n")[1].startsWith('"\'=HYPERLINK(""https://example.invalid"",""QA Export"")"')).toBe(true);
  expect(csv.split("\r\n")).toHaveLength(2);
  expect(csv).toContain('"123","456","0","5"');
}

// On a desk the rows are ticked and the floating bulk bar exports them (D01).
for (const width of [1024, 1440]) {
  test(`selected student export is spreadsheet text at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/students");
    await page.getByRole("checkbox", { name: `Select ${name}`, exact: true }).filter({ visible: true }).tap();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: /Export/ }).tap();
    await checkCsv(await downloadPromise, (csv) => test.info().attach("synthetic-selected-export", { body: csv, contentType: "text/csv" }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

// A phone has no ticks (F05: cards swipe for Call · WhatsApp · Collect); the list's export sits under it.
for (const width of [360, 390, 412]) {
  test(`phone list export is spreadsheet text at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/students");
    await expect(page.getByRole("checkbox", { name: `Select ${name}`, exact: true }).filter({ visible: true })).toHaveCount(0);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export these 1/ }).filter({ visible: true }).tap();
    await checkCsv(await downloadPromise, (csv) => test.info().attach("synthetic-list-export", { body: csv, contentType: "text/csv" }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}
