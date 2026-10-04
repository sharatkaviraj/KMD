import { expect, test } from "@playwright/test";

import { db, signIn } from "./support/harness";

/**
 * P11 in a browser: an administrator builds an archive, runs a restore drill
 * against it, and the screen says it passed — with the counts the manifest
 * holds. The archive's files and its rows are removed afterwards.
 */

test.describe.configure({ mode: "serial" });

const LABEL = `QA archive ${Date.now()}`;

test.afterAll(async () => {
  const { data: archive } = await db().from("archives").select("id, manifest").eq("label", LABEL).maybeSingle();
  if (!archive) return;
  const manifest = archive.manifest as { tables: { path: string }[]; objects: { path: string }[] } | null;
  if (manifest) {
    const paths = [...manifest.tables.map((table) => table.path), ...manifest.objects.map((object) => object.path), `${archive.id}/manifest.json`];
    for (let i = 0; i < paths.length; i += 100) await db().storage.from("vppsone-archives").remove(paths.slice(i, i + 100));
  }
  await db().from("restore_drills").delete().eq("archive_id", archive.id);
  await db().from("archives").delete().eq("id", archive.id);
});

test("an administrator builds an archive and a restore drill passes against it", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, "admin", "/archives");

  await page.locator("#archive-label").fill(LABEL);
  await page.locator("[data-archive-build]").getByRole("button").click();

  const card = page.locator("[data-archives] li").filter({ hasText: LABEL });
  await expect(card.locator("[data-status]")).toHaveAttribute("data-status", "ready", { timeout: 240_000 });

  const { data: archive } = await db().from("archives").select("id, table_count, row_count").eq("label", LABEL).single();
  await expect(card.locator("[data-archive-totals]")).toContainText(`${archive!.table_count}`);

  await card.getByRole("button", { name: /Run a restore drill|बहाली की जाँच चलाएँ/ }).click();
  // `.first()`: a reader in both languages sees the line twice, once in each.
  await expect(card.getByText(/Drill passed: every table and file comes back|जाँच सफल — हर तालिका/).first()).toBeVisible({ timeout: 240_000 });

  const { data: drill } = await db().from("restore_drills").select("ok, report").eq("archive_id", archive!.id).single();
  expect(drill!.ok).toBe(true);
  expect((drill!.report as { tables: { checked: number } }).tables.checked).toBe(archive!.table_count);
});
