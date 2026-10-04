import { expect, test } from "@playwright/test";
import * as XLSX from "xlsx";

import { db, signIn } from "./support/harness";

/**
 * P10b in a browser: the office uploads SamPark's Students workbook, the rows
 * matched by an id are applied (their SamPark ids now point at a child), and
 * the rows no id could settle wait for a person — chosen by SR number, or set
 * aside with a reason.
 *
 * A workbook built here with SamPark's own headers and synthetic SamPark ids
 * (`QA-SPE-…`). Only identity columns and a column this app does not read, so
 * no child's record is touched; precedence over values is `verify:sampark-import`'s.
 */

test.describe.configure({ mode: "serial" });

const STAMP = Date.now();
const SP = (n: number) => `QA-SPE-${STAMP}-${n}`;
let children: { id: string; admissionNo: string }[] = [];

test.beforeAll(async () => {
  const { data } = await db("public")
    .from("students")
    .select("id, admission_no")
    .not("admission_no", "is", null)
    .order("admission_no")
    .limit(3);
  children = (data ?? []).map((row) => ({ id: row.id as string, admissionNo: row.admission_no as string }));
  if (children.length < 3) throw new Error("Need three children with an admission number on dev");
});

test.afterAll(async () => {
  await db().from("external_student_ids").delete().eq("app_id", "sampark").like("external_id", `QA-SPE-${STAMP}-%`);
  await db().from("sampark_import_batches").delete().like("file_name", `qa-sampark-${STAMP}%`);
});

function workbook(): Buffer {
  const [a, b, c] = children;
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Student ID", "SR No", "Name", "Class", "Father's Name"],
    [SP(1), a!.admissionNo, "QA Child One", "6", "QA Parent"],
    [SP(2), `QA-NO-SUCH-${STAMP}`, "QA Child Two", "6", "QA Parent"],
    [SP(3), c!.admissionNo, "QA Child Three", "7", "QA Parent"],
    [SP(4), c!.admissionNo, "QA Child Three again", "7", "QA Parent"],
  ]);
  void b;
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Students");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("a SamPark workbook is matched by ids, and what ids cannot settle waits for a person", async ({ page }) => {
  test.setTimeout(180_000);
  const [a, b, c] = children;
  await signIn(page, "office", "/collection/import");

  await page.locator("#sampark-file").setInputFiles({
    name: `qa-sampark-${STAMP}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbook(),
  });
  await page.locator("[data-sampark-upload]").getByRole("button", { name: /^(Read the file|फ़ाइल पढ़ें)$/ }).click();
  await page.waitForURL(/\/collection\/import\?batch=/, { timeout: 60_000 });

  // One matched, three waiting: an SR nobody has, and two rows for one child.
  const counts = page.locator("[data-sampark-counts]");
  await expect(counts).toContainText(/Matched 1|पहचाने गए 1/);
  await expect(counts).toContainText(/Waiting for you to decide 3|आपके फ़ैसले की प्रतीक्षा में 3/);
  // The column this app does not read is named, not silently dropped.
  await expect(page.locator("[data-sampark-batch]")).toContainText("Father's Name");

  // Apply the matched row: its SamPark id now points at that child.
  await page.locator("[data-sampark-apply]").getByRole("button", { name: /Apply the matched rows|पहचानी गई पंक्तियाँ लागू करें/ }).click();
  await expect
    .poll(async () => (await db().from("external_student_ids").select("student_id, matched_on").eq("external_id", SP(1)).maybeSingle()).data, {
      timeout: 30_000,
    })
    .toMatchObject({ student_id: a!.id, matched_on: "sr" });

  // The SR nobody has: the office knows the child, and says so by SR number.
  const unmatched = page.locator("[data-sampark-queue] [data-row='3']");
  await unmatched.getByRole("radio", { name: /By the fee record's SR number|फ़ीस रिकॉर्ड के SR नंबर से/ }).check();
  await unmatched.locator('input[name="admissionNo"]').fill(b!.admissionNo);
  await unmatched.getByRole("button", { name: /^(Decide|तय करें)$/ }).click();
  await expect
    .poll(async () => (await db().from("external_student_ids").select("student_id, matched_on").eq("external_id", SP(2)).maybeSingle()).data, {
      timeout: 30_000,
    })
    .toMatchObject({ student_id: b!.id, matched_on: "hand" });

  // Two rows for one child: neither was taken. One is set aside — which needs
  // a reason — and the other is the child.
  await page.reload();
  const extra = page.locator("[data-sampark-queue] [data-row='5']");
  await expect(extra).toContainText(/The file has two rows for this child|फ़ाइल में इस बच्चे की दो पंक्तियाँ हैं/);
  await extra.getByRole("radio", { name: /Nobody here|किसी से मेल नहीं/ }).check();
  await extra.locator('textarea[name="note"]').fill("The same child twice in SamPark");
  await extra.getByRole("button", { name: /^(Decide|तय करें)$/ }).click();
  await expect
    .poll(async () => {
      const { data } = await db().from("sampark_import_rows").select("resolution, decision_note").eq("row_no", 5).eq("external_id", SP(4)).single();
      return data;
    }, { timeout: 30_000 })
    .toMatchObject({ resolution: "dismissed", decision_note: "The same child twice in SamPark" });

  await page.reload();
  const kept = page.locator("[data-sampark-queue] [data-row='4']");
  await kept.getByRole("radio", { name: new RegExp(`SR ${c!.admissionNo}`) }).check();
  await kept.getByRole("button", { name: /^(Decide|तय करें)$/ }).click();
  await expect
    .poll(async () => (await db().from("external_student_ids").select("student_id").eq("external_id", SP(3)).maybeSingle()).data?.student_id, {
      timeout: 30_000,
    })
    .toBe(c!.id);

  // Nothing is left waiting.
  await page.reload();
  await expect(page.locator("[data-sampark-queue]")).toHaveCount(0);
});
