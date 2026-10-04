import { expect, test } from "@playwright/test";

import { currentSessionLabel, db, signIn } from "./support/harness";

/**
 * P10c in a browser: the office opens a class, drops a folder of photographs,
 * the one named for a child's SR number goes to that child, the one named for
 * nobody waits in the tray until a person chooses, and a retake keeps the
 * earlier photograph. Synthetic 1×1 images; removed afterwards.
 */

test.describe.configure({ mode: "serial" });

// A valid 1×1 PNG: the browser decodes it before shrinking it.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let classId = "";
let children: { id: string; sr: string }[] = [];

test.beforeAll(async () => {
  const session = await currentSessionLabel();
  const { data: roll } = await db().from("enrolments").select("student_id, class_id").eq("session_label", session).eq("status", "enrolled").limit(200);
  const { data: photographed } = await db().from("student_photos").select("student_id");
  const taken = new Set((photographed ?? []).map((row) => row.student_id as string));
  const byClass = new Map<string, string[]>();
  for (const row of roll ?? []) {
    if (taken.has(row.student_id as string)) continue;
    byClass.set(row.class_id as string, [...(byClass.get(row.class_id as string) ?? []), row.student_id as string]);
  }
  for (const [id, students] of byClass) {
    const { data } = await db("public").from("students").select("id, admission_no").in("id", students.slice(0, 50)).not("admission_no", "is", null);
    if ((data ?? []).length >= 2) {
      classId = id;
      children = (data ?? []).slice(0, 2).map((row) => ({ id: row.id as string, sr: row.admission_no as string }));
      break;
    }
  }
  if (!classId) throw new Error("No class with two unphotographed children who have SR numbers");
});

test.afterAll(async () => {
  for (const child of children) {
    const { data } = await db().from("student_photos").select("storage_path").eq("student_id", child.id);
    await db().from("student_photos").update({ replaced_by: null, replaced_at: null }).eq("student_id", child.id);
    await db().from("student_photos").delete().eq("student_id", child.id);
    const paths = (data ?? []).map((row) => row.storage_path as string);
    if (paths.length > 0) await db().storage.from("vppsone-photos").remove(paths);
  }
});

test("a folder is placed by SR number, the tray by a person, and a retake keeps the earlier photograph", async ({ page }) => {
  test.setTimeout(180_000);
  const [a, b] = children;
  await signIn(page, "office", `/collection/photos?class=${classId}`);

  const missingBefore = Number(await page.locator("[data-photo-missing]").getAttribute("data-photo-missing"));

  await page.locator('[data-photo-folder] input[type="file"]').setInputFiles([
    { name: `IMG_${a!.sr}.png`, mimeType: "image/png", buffer: PNG },
    { name: "scan-without-a-name.png", mimeType: "image/png", buffer: PNG },
  ]);

  const plan = page.locator("[data-photo-plan]");
  await expect(plan.locator(`[data-photo-file="IMG_${a!.sr}.png"]`)).toHaveAttribute("data-match", "matched");
  const tray = plan.locator('[data-photo-file="scan-without-a-name.png"]');
  await expect(tray).toHaveAttribute("data-match", "none");
  await tray.locator("select").selectOption(b!.id);

  await page.locator("[data-photo-folder]").getByRole("button", { name: /Place the photographs|फ़ोटो लगाएँ/ }).click();
  await expect(page.locator("[data-photo-progress]")).toContainText("2 / 2", { timeout: 60_000 });

  const current = async (studentId: string) =>
    (await db().from("student_photos").select("id, source, source_ref").eq("student_id", studentId).is("replaced_at", null).maybeSingle()).data;
  await expect.poll(async () => (await current(a!.id))?.source_ref, { timeout: 30_000 }).toBe(`IMG_${a!.sr}.png`);
  await expect.poll(async () => (await current(b!.id))?.source_ref, { timeout: 30_000 }).toBe("scan-without-a-name.png");

  await page.reload();
  await expect(page.locator("[data-photo-missing]")).toHaveAttribute("data-photo-missing", String(missingBefore - 2));

  // A retake of the first child: the earlier photograph is kept, replaced.
  const first = await current(a!.id);
  const tile = page.locator(`[data-photo-child="${a!.id}"]`);
  await expect(tile).toHaveAttribute("data-has-photo", "yes");
  await tile.locator('input[type="file"]:not([capture])').setInputFiles({ name: "retake.png", mimeType: "image/png", buffer: PNG });
  await expect(tile.getByText(/Photograph replaced|फ़ोटो बदली गई/)).toBeVisible({ timeout: 60_000 });
  const { data: rows } = await db().from("student_photos").select("id, replaced_by").eq("student_id", a!.id);
  expect(rows).toHaveLength(2);
  expect(rows!.find((row) => row.id === first!.id)?.replaced_by).toBe((await current(a!.id))!.id);
});
