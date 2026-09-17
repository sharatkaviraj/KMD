import { expect, test } from "@playwright/test";

import { m } from "@/messages";
import { primary } from "@/platform/i18n/language";

import { currentSessionLabel, db, signIn } from "./support/harness";

/**
 * A question asked on Monday is still Monday's question on Friday.
 *
 * **B-07 / S-02.** The roll and the prefilled values used to be re-read from
 * `enrolments` and `student_records` every time the link was opened. So a
 * child moved between classes after the link went out silently left the sheet
 * the teacher was filling in, and an office correction silently changed what
 * "the number we hold" meant — she is shown one thing, answers it, and the
 * review queue compares her answer against something she never saw.
 *
 * This is the journey no unit test can stand in for: the freeze happens in
 * `createRequest`, the reading happens in a server component, and the thing
 * that has to not change is a rendered page. So the test changes the world
 * underneath a live link and asserts the page did not notice — and then, as a
 * control, unfreezes the same link and watches it notice.
 */

/**
 * A **confirm** field, and that is the point.
 *
 * Confirm mode renders what the school holds as visible text, so "she was
 * shown the old number" is something a test can look at. A collect field
 * prefills nothing at all, and an assertion about the absence of a value that
 * is never rendered passes against any code whatsoever — including the code
 * this test exists to catch.
 */
const FIELD_KEY = "guardian_phone";

/** What the school holds when the link goes out. */
const HELD_AT_ISSUE = "9811111111";

/** What the office corrects it to, an hour later. Neither is in any fixture. */
const CORRECTED_AFTER_ISSUE = "9899999999";

let requestId: string | null = null;
let token: string | null = null;
let classId: string | null = null;
let className: string | null = null;
let otherClassId: string | null = null;
let fieldId: string | null = null;
let sessionLabel = "";
let roll: string[] = [];
let movedStudentId: string | null = null;
let movedStudentName = "";
let correctedStudentId: string | null = null;
let recordWasThere: { id: string; value: string | null } | null = null;
let recordCreated = false;

test.beforeAll(async () => {
  sessionLabel = await currentSessionLabel();

  const { data: field, error: fieldError } = await db()
    .from("collection_fields")
    .select("id")
    .eq("key", FIELD_KEY)
    .eq("is_active", true)
    .maybeSingle();

  if (fieldError) throw new Error(fieldError.message);
  if (!field) throw new Error(`No active "${FIELD_KEY}" field — run npm run seed:dev`);
  fieldId = field.id as string;

  const { data: enrolled, error: rollError } = await db()
    .from("enrolments")
    .select("class_id, student_id")
    .eq("session_label", sessionLabel)
    .eq("status", "enrolled");

  if (rollError) throw new Error(rollError.message);

  const byClass = new Map<string, string[]>();
  for (const row of enrolled ?? []) {
    const id = row.class_id as string;
    byClass.set(id, [...(byClass.get(id) ?? []), row.student_id as string]);
  }

  // Biggest class first: a roster of two makes "nobody fell off it" a claim
  // about almost nothing.
  const ranked = [...byClass.entries()].sort((a, b) => b[1].length - a[1].length);
  const [chosen, next] = ranked;

  if (!chosen || chosen[1].length < 2) {
    throw new Error("No class has two children — run npm run qa:seed");
  }
  if (!next) throw new Error("Only one class has children — run npm run qa:seed");

  classId = chosen[0];
  roll = [...chosen[1]].sort();
  otherClassId = next[0];
  correctedStudentId = roll[0];
  // The last one alphabetically, so this and office-collection.spec.ts are not
  // both leaning on the same child.
  movedStudentId = roll[roll.length - 1];

  const { data: klass } = await db("public")
    .from("classes")
    .select("class_name")
    .eq("id", classId)
    .maybeSingle();

  className = (klass?.class_name as string) ?? classId;

  const { data: child } = await db("public")
    .from("students")
    .select("full_name")
    .eq("id", movedStudentId)
    .maybeSingle();

  // Found by name, not by input id: a confirm field that holds a value renders
  // no input at all, so the id would be missing for exactly the case this is
  // about.
  movedStudentName = (child?.full_name as string) ?? "";
  if (!movedStudentName) throw new Error("The child to move has no name to find them by");
});

test.afterAll(async () => {
  // The child goes back to their own class first: of everything this test
  // changes, that is the one that would outlive the run.
  if (movedStudentId && classId) {
    await db()
      .from("enrolments")
      .update({ class_id: classId })
      .eq("student_id", movedStudentId)
      .eq("session_label", sessionLabel);
  }

  if (recordCreated) {
    await db()
      .from("student_records")
      .delete()
      .eq("student_id", correctedStudentId)
      .eq("field_id", fieldId);
  } else if (recordWasThere) {
    await db()
      .from("student_records")
      .update({ value: recordWasThere.value })
      .eq("id", recordWasThere.id);
  }

  // Cascades to its fields, its members and its submissions.
  if (requestId) await db().from("collection_requests").delete().eq("id", requestId);
});

test("a link keeps the roll and the values it was issued with", async ({
  page,
  browser,
}) => {
  /* ------------------------------ 0. something for the school to hold */

  // No child in the dev fixture has a guardian phone on the fee record, and
  // rule 2 says this repo never puts one there. VPPS One's own accepted value
  // is the other half of the same precedence and is ours to write, so that is
  // what the link will be carrying.
  await setRecord(HELD_AT_ISSUE, { remember: true });

  const account = await signIn(page, "office", "/collection");
  const title = `QA freeze ${Date.now()}`;

  /* --------------------------------------------- 1. the office asks */

  await page.fill("#title-en", title);
  await page.fill("#title-hi", title);
  await page.selectOption("#req-class", classId!);
  await page.check(`#field-${fieldId}`);
  await page
    .getByRole("button", { name: primary(m.collectionNew, account.language) })
    .click();

  await expect(page.getByText(title).first()).toBeVisible();

  const { data: created, error } = await db()
    .from("collection_requests")
    .select("id, token, audience_kind, audience_label")
    .eq("title_en", title)
    .maybeSingle();

  if (error) throw new Error(error.message);
  expect(created, "no request row exists after creating one").not.toBeNull();

  requestId = created!.id as string;
  token = created!.token as string;

  // A request made through this form is one class, and says so. The board, the
  // message and the review header all read the audience rather than the class
  // now, so a blank here is a blank on all three.
  expect(created!.audience_kind).toBe("class");
  expect(created!.audience_label).toBe(className);

  /* ------------------------------- 2. who was asked, written down at once */

  const members = await readMembers();

  expect(
    members.map((row) => row.student_id).sort(),
    "the roll was not frozen when the request was created",
  ).toEqual(roll);

  for (const member of members) {
    expect(
      Object.prototype.hasOwnProperty.call(member.snapshot, FIELD_KEY),
      `no snapshot of ${FIELD_KEY} for ${member.student_id}`,
    ).toBe(true);
  }

  expect(
    members.find((row) => row.student_id === correctedStudentId)?.snapshot[FIELD_KEY],
    "the snapshot did not record what the school held at the moment of asking",
  ).toBe(HELD_AT_ISSUE);

  /* --------------------------------------------- 3. the link goes live */

  await page.goto(`/collection/${requestId}`);
  await page
    .getByRole("button", { name: primary(m.collectionOpen, account.language) })
    .click();

  await expect
    .poll(async () => (await readRequestStatus()) ?? "", { timeout: 15_000 })
    .toBe("open");

  const anonymous = await browser.newContext();
  const link = await anonymous.newPage();
  await link.goto(`/r/${token}`);

  const before = await link.getByRole("listitem").count();
  expect(before, "the link did not load the class roster").toBe(roll.length);

  await expect(
    link.getByText(movedStudentName).first(),
    "the child this test will move is not on the link to begin with",
  ).toBeVisible();

  await expect(
    link.getByText(HELD_AT_ISSUE),
    "the link does not show what the school holds, so there is nothing to freeze",
  ).toHaveCount(1);

  /* ------------------------- 4. the world moves underneath the open link */

  // A child changes class. An ordinary September transfer, not an exotic case.
  const { error: moveError } = await db()
    .from("enrolments")
    .update({ class_id: otherClassId })
    .eq("student_id", movedStudentId)
    .eq("session_label", sessionLabel);

  if (moveError) throw new Error(moveError.message);

  // And the office corrects a number for a child who is still in the class.
  await setRecord(CORRECTED_AFTER_ISSUE);

  /* ------------------------------ 5. the link is still Monday's question */

  await link.reload();

  expect(
    await link.getByRole("listitem").count(),
    "a child who changed class fell off a link that had already gone out",
  ).toBe(before);

  await expect(
    link.getByText(movedStudentName).first(),
    "the moved child is no longer on the link they were sent on",
  ).toBeVisible();

  await expect(
    link.getByText(HELD_AT_ISSUE),
    "the link stopped showing the value it was issued with",
  ).toHaveCount(1);

  // The correction is real, and the teacher is not being shown it — she is
  // answering the question she was asked. A page that had quietly picked it up
  // would look completely normal, which is why this is asserted at all.
  await expect(
    link.getByText(CORRECTED_AFTER_ISSUE),
    "an office correction made after issue leaked onto an open link",
  ).toHaveCount(0);

  /* ------------------------- 6. and the same link without the freeze */

  // **The control.** Everything above would pass just as well against code
  // that never froze anything, because none of it shows that the freeze is
  // what did the work. So: delete the member rows and reload. That is not a
  // hypothetical — it is the legacy path `rollForRequest` still takes for a
  // request made before this migration, and it is precisely the old behaviour.
  //
  // The roll shrinks and the correction appears: B-07, reproduced on demand,
  // thirty lines below the fix that closes it.
  const { error: unfreezeError } = await db()
    .from("collection_request_members")
    .delete()
    .eq("request_id", requestId);

  if (unfreezeError) throw new Error(unfreezeError.message);

  await link.reload();

  expect(
    await link.getByRole("listitem").count(),
    "without a frozen roll the moved child should have fallen off — if they " +
      "did not, this test is not measuring what it claims to",
  ).toBe(before - 1);

  await expect(
    link.getByText(CORRECTED_AFTER_ISSUE),
    "without a frozen snapshot the correction should have leaked through",
  ).toHaveCount(1);

  await expect(
    link.getByText(HELD_AT_ISSUE),
    "without a frozen snapshot the issued value should have been replaced",
  ).toHaveCount(0);

  await anonymous.close();
});

/** Write VPPS One's own accepted value, remembering anything it displaced. */
async function setRecord(value: string, { remember = false } = {}) {
  const { data: existing, error: readError } = await db()
    .from("student_records")
    .select("id, value")
    .eq("student_id", correctedStudentId!)
    .eq("field_id", fieldId!)
    .maybeSingle();

  if (readError) throw new Error(readError.message);

  if (existing) {
    if (remember) {
      recordWasThere = {
        id: existing.id as string,
        value: existing.value as string | null,
      };
    }

    const { error } = await db()
      .from("student_records")
      .update({ value })
      .eq("id", existing.id);

    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await db().from("student_records").insert({
    session_label: sessionLabel,
    student_id: correctedStudentId,
    field_id: fieldId,
    value,
    source: "office",
  });

  if (error) throw new Error(error.message);
  if (remember) recordCreated = true;
}

async function readMembers() {
  const { data, error } = await db()
    .from("collection_request_members")
    .select("student_id, roll_no, snapshot")
    .eq("request_id", requestId!);

  if (error) throw new Error(error.message);
  return (data ?? []) as {
    student_id: string;
    roll_no: string | null;
    snapshot: Record<string, string | null>;
  }[];
}

async function readRequestStatus() {
  const { data, error } = await db()
    .from("collection_requests")
    .select("status")
    .eq("id", requestId!)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data?.status as string | undefined) ?? null;
}
