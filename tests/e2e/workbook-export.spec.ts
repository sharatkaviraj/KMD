import { expect, test } from "@playwright/test";
import * as XLSX from "xlsx";

import { currentSessionLabel, db, signIn } from "./support/harness";

/**
 * P10d in a browser: the office downloads the students workbook and a round's
 * workbook, and both open as text with the counts they say they hold.
 *
 * The round is synthetic — one link, one child, one answer — and is removed
 * afterwards. The students workbook is read, never changed.
 */

test.describe.configure({ mode: "serial" });

let sessionLabel = "";
let roundId = "";
let requestId = "";
let fieldId = "";

test.beforeAll(async () => {
  sessionLabel = await currentSessionLabel();
  const { data: field } = await db()
    .from("collection_fields")
    .insert({ key: `qa_p10d_${Date.now()}`, label_hi: "QA निर्यात", label_en: "QA export", input_type: "text", is_active: false })
    .select("id")
    .single();
  fieldId = field!.id as string;
});

test.afterAll(async () => {
  if (requestId) await db().from("collection_requests").delete().eq("id", requestId);
  if (roundId) await db().from("collection_rounds").delete().eq("id", roundId);
  await db().from("collection_fields").delete().eq("id", fieldId);
});

test("the students and round workbooks open as text with the counts they claim", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "office", "/collection");
  await expect(page.locator("[data-export-students]")).toBeVisible();

  /* ------------------------------------------------- the students workbook */
  const response = await page.request.get("/collection/export/students");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("spreadsheetml");
  const book = XLSX.read(await response.body(), { type: "buffer" });
  expect(book.SheetNames).toEqual(["Students", "Sources", "About"]);

  const students = XLSX.utils.sheet_to_json<string[]>(book.Sheets.Students!, { header: 1, raw: true });
  const { count: enrolled } = await db()
    .from("enrolments")
    .select("student_id", { count: "exact", head: true })
    .eq("session_label", sessionLabel)
    .eq("status", "enrolled");
  expect(students.length - 1, "one row per enrolled child").toBe(enrolled);

  const about = XLSX.utils.sheet_to_json<string[]>(book.Sheets.About!, { header: 1, raw: true });
  expect(about).toContainEqual(["Students rows", String(enrolled)]);

  // Every cell is text, so an SR number keeps its leading zeros.
  const sheet = book.Sheets.Students!;
  const types = new Set(Object.keys(sheet).filter((key) => !key.startsWith("!")).map((key) => (sheet[key] as { t: string }).t));
  expect([...types]).toEqual(["s"]);

  const { data: logged } = await db()
    .from("academic_exports")
    .select("kind, row_count")
    .eq("kind", "students")
    .order("exported_at", { ascending: false })
    .limit(1)
    .single();
  expect(logged).toMatchObject({ kind: "students", row_count: enrolled });

  /* ---------------------------------------------------- a round's workbook */
  const { data: enrolment } = await db()
    .from("enrolments")
    .select("student_id, class_id")
    .eq("session_label", sessionLabel)
    .eq("status", "enrolled")
    .limit(1)
    .single();
  const { data: round } = await db()
    .from("collection_rounds")
    .insert({ session_label: sessionLabel, title_hi: "QA निर्यात राउंड", title_en: "QA export round", status: "open" })
    .select("id")
    .single();
  roundId = round!.id as string;
  const { data: request } = await db()
    .from("collection_requests")
    .insert({
      session_label: sessionLabel,
      round_id: roundId,
      title_hi: "QA",
      title_en: "QA",
      class_id: enrolment!.class_id,
      class_label: "QA Class/6",
      audience_kind: "class",
      audience_label: "QA Class/6",
      token: `QAP10DEXPORT${Date.now()}`,
      status: "open",
      opened_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  requestId = request!.id as string;
  await db().from("collection_request_fields").insert({ request_id: requestId, field_id: fieldId, sort_order: 0 });
  const fieldKey = (await db().from("collection_fields").select("key").eq("id", fieldId).single()).data!.key as string;
  await db()
    .from("collection_request_members")
    .insert({ request_id: requestId, student_id: enrolment!.student_id, roll_no: "1", snapshot: { [fieldKey]: "0" } });
  await db().from("collection_submissions").insert({
    request_id: requestId,
    student_id: enrolment!.student_id,
    field_id: fieldId,
    value: "0042",
    previous_value: "0",
    status: "pending",
  });

  await page.goto(`/collection/rounds/${roundId}`);
  await expect(page.locator("[data-export-round]")).toBeVisible();
  const roundResponse = await page.request.get(`/collection/rounds/${roundId}/export`);
  expect(roundResponse.status()).toBe(200);
  const roundBook = XLSX.read(await roundResponse.body(), { type: "buffer" });
  // The class label's "/" is not allowed in a sheet name.
  expect(roundBook.SheetNames).toEqual(["QA Class-6", "About"]);
  const rows = XLSX.utils.sheet_to_json<string[]>(roundBook.Sheets["QA Class-6"]!, { header: 1, raw: true });
  // The shown "0" stays a zero and the answer keeps its leading zeros.
  expect(rows[1]!.slice(0, 1)).toEqual(["1"]);
  expect(rows[1]!.slice(3)).toEqual(["0", "0042", "pending"]);
});
