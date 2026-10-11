import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

for (const width of [360, 390, 412]) {
  test(`selected student export is spreadsheet text at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/students");
    const name = '=HYPERLINK("https://example.invalid","QA Export")';
    await page.getByRole("checkbox", { name: `Select ${name}`, exact: true }).filter({ visible: true }).tap();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("region", { name: /selected/ }).getByRole("button", { name: /Export/ }).tap();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("students-OPS-EXPORT-2026.csv");
    const csv = await readFile((await download.path())!, "utf8");
    await test.info().attach("synthetic-selected-export", { body: csv, contentType: "text/csv" });
    expect(csv.startsWith("\uFEFF")).toBe(true);
    // Quoting alone does not prevent spreadsheet evaluation: string data must be text.
    expect(csv.split("\r\n")[1].startsWith('"\'=HYPERLINK(""https://example.invalid"",""QA Export"")"')).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(2);
    expect(csv).toContain('"123","456","0","5"');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}
