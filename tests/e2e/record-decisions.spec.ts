import { expect, test } from "@playwright/test";

import { currentSessionLabel, db, signIn } from "./support/harness";

/**
 * P10 in a browser: deciding an answer is one command, and the two answers
 * that would quietly overwrite something are offered differently.
 *
 * An older answer with a newer one waiting can only be rejected. An answer
 * about a value that moved since the teacher saw it is accepted only through
 * "Accept and replace the newer value" — and when it is, the child's card
 * shows what it replaced, by whom and from where.
 *
 * A synthetic, inactive `qa_` field and synthetic numbers; everything,
 * history included, is removed afterwards.
 */

test.describe.configure({ mode: "serial" });

const SHOWN = "9812350000";
const CORRECTED_SINCE = "9812359999";
const APRIL = "9812350001";
const JUNE = "9812350002";

let sessionLabel = "";
let fieldId = "";
let studentId = "";
let classId = "";
const requestIds: string[] = [];

test.beforeAll(async () => {
  sessionLabel = await currentSessionLabel();

  const { data: field, error } = await db()
    .from("collection_fields")
    .insert({ key: `qa_p10_e2e_${Date.now()}`, label_hi: "QA पुष्टि नंबर", label_en: "QA check number", input_type: "text", is_active: false })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  fieldId = field.id as string;

  const { data: enrolment } = await db()
    .from("enrolments")
    .select("student_id, class_id")
    .eq("session_label", sessionLabel)
    .eq("status", "enrolled")
    .limit(1)
    .single();
  studentId = enrolment!.student_id as string;
  classId = enrolment!.class_id as string;
});

test.afterAll(async () => {
  await db().from("student_record_history").delete().eq("field_id", fieldId);
  await db().from("student_records").delete().eq("field_id", fieldId);
  if (requestIds.length > 0) await db().from("collection_requests").delete().in("id", requestIds);
  await db().from("collection_fields").delete().eq("id", fieldId);
});

test("an older answer is only rejected, and a moved record is replaced only on purpose", async ({ page }) => {
  test.setTimeout(180_000);

  // Two links asking the same thing, the office correcting the record after
  // both went out — the ordinary shape of the problem.
  for (const [label, token, value, at] of [
    ["QA P10 April", `QAP10APR${Date.now()}`, APRIL, "2026-04-01T10:00:00Z"],
    ["QA P10 June", `QAP10JUN${Date.now()}`, JUNE, "2026-06-01T10:00:00Z"],
  ]) {
    const { data, error } = await db()
      .from("collection_requests")
      .insert({
        session_label: sessionLabel,
        title_hi: label,
        title_en: label,
        class_id: classId,
        class_label: "QA Class",
        audience_kind: "class",
        audience_label: "QA Class",
        token,
        status: "open",
        opened_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    requestIds.push(data.id as string);
    const { error: answerError } = await db().from("collection_submissions").insert({
      request_id: data.id,
      student_id: studentId,
      field_id: fieldId,
      value,
      previous_value: SHOWN,
      status: "pending",
      submitted_at: at,
    });
    if (answerError) throw new Error(answerError.message);
  }
  // A fixture: the office's correction, already on the record.
  await db().from("student_records").insert({
    session_label: sessionLabel,
    student_id: studentId,
    field_id: fieldId,
    value: CORRECTED_SINCE,
    source: "office",
  });

  await signIn(page, "office", "/collection/review");

  const april = page.locator("li").filter({ hasText: APRIL });
  const june = page.locator("li").filter({ hasText: JUNE });
  const accept = /^(Accept|स्वीकार करें)$/;
  const replace = /Accept and replace the newer value|नया मान बदलकर स्वीकारें/;
  const reject = /^(Reject|अस्वीकार करें)$/;

  // The older answer: rejecting is the only decision on offer.
  await expect(april.getByRole("button", { name: reject })).toBeVisible();
  await expect(april.getByRole("button", { name: accept })).toHaveCount(0);
  await expect(april.getByRole("button", { name: replace })).toHaveCount(0);

  // The newer one is about a value that moved: no plain Accept.
  await expect(june.getByRole("button", { name: accept })).toHaveCount(0);
  await june.getByRole("button", { name: replace }).click();

  await expect
    .poll(async () => {
      const { data } = await db().from("student_records").select("value, source").eq("field_id", fieldId).single();
      return data;
    }, { timeout: 30_000 })
    .toMatchObject({ value: JUNE, source: "teacher" });

  const { data: written } = await db()
    .from("student_record_history")
    .select("outcome, old_value, new_value, old_source")
    .eq("field_id", fieldId)
    .order("id", { ascending: false })
    .limit(1)
    .single();
  expect(written).toMatchObject({ outcome: "written", old_value: CORRECTED_SINCE, new_value: JUNE, old_source: "office" });

  // April is no longer behind a newer answer, but the record moved under it
  // too; the office rejects it.
  await page.reload();
  await page.locator("li").filter({ hasText: APRIL }).getByRole("button", { name: reject }).click();
  await expect
    .poll(async () => {
      const { data } = await db().from("collection_submissions").select("status").eq("field_id", fieldId).eq("value", APRIL).single();
      return data?.status;
    }, { timeout: 30_000 })
    .toBe("rejected");
  const { data: stillJune } = await db().from("student_records").select("value").eq("field_id", fieldId).single();
  expect(stillJune?.value).toBe(JUNE);

  // The child's card says what the value replaced, from where.
  await page.goto(`/teach/student/${studentId}`);
  const history = page.locator("[data-record-history]");
  await history.locator("summary").click();
  const line = history.locator('li[data-outcome="written"]').filter({ hasText: JUNE }).first();
  await expect(line).toContainText(CORRECTED_SINCE);
  await expect(line).toContainText(/A teacher|अध्यापक/);
});
