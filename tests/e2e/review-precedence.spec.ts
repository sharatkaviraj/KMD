import { expect, test } from "@playwright/test";

import { currentSessionLabel, db, signIn } from "./support/harness";

/**
 * Two things that go wrong between a teacher answering and the office
 * accepting, neither of which looks like anything on screen.
 *
 * A **stale** answer renders as an ordinary row with a reasonable value in it,
 * and accepting it silently reverts a correction somebody made on purpose
 * (S-07). A **superseded** one renders as a *second* ordinary row, and the
 * office is asked to adjudicate a question it cannot see the shape of.
 *
 * Both are built here deliberately, because neither occurs by accident often
 * enough to catch by using the app — and both are asserted to be **absent**
 * from the rows that should not have them, which is the half that catches a
 * flag on every row.
 */

const FIELD_KEY = "guardian_phone";

/** What the teacher was shown when the link went out. */
const SHOWN = "9800000001";
/** What the office corrected it to afterwards. */
const CORRECTED_SINCE = "9899999999";

let sessionLabel = "";
let fieldId = "";
let studentId = "";
let classId = "";
const requestIds: string[] = [];
let recordCreated = false;

test.beforeAll(async () => {
  sessionLabel = await currentSessionLabel();

  const { data: field, error } = await db()
    .from("collection_fields")
    .select("id")
    .eq("key", FIELD_KEY)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!field) throw new Error(`No active "${FIELD_KEY}" field — run npm run seed:dev`);
  fieldId = field.id as string;

  const { data: enrolment, error: rollError } = await db()
    .from("enrolments")
    .select("student_id, class_id")
    .eq("session_label", sessionLabel)
    .eq("status", "enrolled")
    .limit(1)
    .maybeSingle();

  if (rollError) throw new Error(rollError.message);
  if (!enrolment) throw new Error("Nobody is enrolled — run npm run qa:seed");

  studentId = enrolment.student_id as string;
  classId = enrolment.class_id as string;
});

test.afterAll(async () => {
  // The requests cascade to their fields, members and submissions.
  if (requestIds.length > 0) {
    await db().from("collection_requests").delete().in("id", requestIds);
  }

  if (recordCreated) {
    await db()
      .from("student_records")
      .delete()
      .eq("student_id", studentId)
      .eq("field_id", fieldId);
  }
});

test("the queue says when the record moved, and when a newer answer arrived", async ({
  page,
}) => {
  /* ------------------------ 1. two rounds asking the same thing */

  // The ordinary case, not an edge: the office asks in April, half the answers
  // come back, and it asks the stragglers again in June.
  for (const [label, token] of [
    ["QA April", "QAE2EAPRIL0001"],
    ["QA June", "QAE2EJUNE00001"],
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

    await db()
      .from("collection_request_fields")
      .insert({ request_id: data.id, field_id: fieldId, sort_order: 0 });

    // Frozen with what she was shown — the same value on both, because the
    // record had not moved when either link went out.
    await db()
      .from("collection_request_members")
      .insert({
        request_id: data.id,
        student_id: studentId,
        roll_no: "1",
        snapshot: { [FIELD_KEY]: SHOWN },
      });
  }

  const submitted = [
    { requestId: requestIds[0], value: "9812340001", at: "2026-04-01T10:00:00Z" },
    { requestId: requestIds[1], value: "9812340002", at: "2026-06-01T10:00:00Z" },
  ];

  const { error: answerError } = await db()
    .from("collection_submissions")
    .insert(
      submitted.map((row) => ({
        request_id: row.requestId,
        student_id: studentId,
        field_id: fieldId,
        value: row.value,
        previous_value: SHOWN,
        status: "pending",
        submitted_at: row.at,
      })),
    );

  if (answerError) throw new Error(answerError.message);

  /* ----------- 2. nothing is stale yet, because nothing has moved */

  await signIn(page, "office", "/collection/review");

  const staleFlag = page.getByText(/रिकॉर्ड बदला|record changed/i);

  // **Asserted absent first.** A flag that is always on is a flag nobody
  // reads, and the only way to know it is not always on is to look before the
  // thing it reports has happened.
  await expect(
    staleFlag,
    "an answer was called stale before anything had changed",
  ).toHaveCount(0);

  // The later answer already overtakes the earlier one, though — that needs no
  // correction, only two rounds.
  await expect(
    page.getByText(/नया जवाब आ चुका है|newer answer has arrived/i),
    "the earlier of two answers was not marked superseded",
  ).toHaveCount(1);

  /* ---------------------------- 3. the office corrects the record */

  const { error: recordError } = await db().from("student_records").insert({
    session_label: sessionLabel,
    student_id: studentId,
    field_id: fieldId,
    value: CORRECTED_SINCE,
    source: "office",
  });

  if (recordError) throw new Error(recordError.message);
  recordCreated = true;

  /* ------------------------------- 4. and now both answers are stale */

  await page.reload();

  // Both, because both were shown the old value — the correction landed after
  // either link went out.
  await expect
    .poll(async () => staleFlag.count(), {
      message: "the record moved and the queue did not say so",
      timeout: 15_000,
    })
    .toBe(2);

  // With the current value beside it, so the office can decide with both in
  // view rather than being told something is wrong.
  await expect(
    page.getByText(CORRECTED_SINCE).first(),
    "the flag does not say what the record holds now",
  ).toBeVisible();

  // The superseded one is still superseded: the two facts are independent.
  await expect(
    page.getByText(/नया जवाब आ चुका है|newer answer has arrived/i),
  ).toHaveCount(1);

  /* ------------------ 5. the group the answer was asked of, not the class */

  // A house link has no class at all, so a queue that printed `class_label`
  // would print a dash on every one of them.
  await expect(
    page.getByText("QA Class").first(),
    "the queue does not say which group the answer came from",
  ).toBeVisible();
});
