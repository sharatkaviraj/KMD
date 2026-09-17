import { expect, test } from "@playwright/test";

import { m } from "@/messages";
import { primary } from "@/platform/i18n/language";

import { currentSessionLabel, db, signIn } from "./support/harness";

/**
 * The office asks a teacher for something, and the answer comes back.
 *
 * The second of PLAN §5 R0's two automated journeys, and the one that crosses
 * the public boundary: a request is created behind a login, answered through a
 * token link with **no session at all**, and lands in the review queue. Three
 * different authorities in one workflow, which is where this app's bugs live —
 * `/collection/messages` threw on every load for two phases because nobody had
 * opened it signed in (D-95).
 *
 * Everything is asserted against the rows. The refusal case is asserted
 * against the *absence* of a row, which is the half a success message cannot
 * tell you about.
 */

const FIELD_KEY = "mother_phone";
const TOO_SHORT = "987654321"; // nine digits: impossible to submit (D-30)
const GOOD_NUMBER = "9812345670";

let requestId: string | null = null;
let token: string | null = null;
let classId: string | null = null;
let className: string | null = null;
let fieldId: string | null = null;
let firstStudentId: string | null = null;

test.beforeAll(async () => {
  const sessionLabel = await currentSessionLabel();

  const { data: field, error: fieldError } = await db()
    .from("collection_fields")
    .select("id, key")
    .eq("key", FIELD_KEY)
    .eq("is_active", true)
    .maybeSingle();

  if (fieldError) throw new Error(fieldError.message);
  if (!field) throw new Error(`No active "${FIELD_KEY}" field — run npm run seed:dev`);
  fieldId = field.id as string;

  // A class with children and no open request, so the journey is not competing
  // with a fixture. Biggest first, because a class of three makes "the roster
  // loaded" a weak assertion.
  const { data: roll, error: rollError } = await db()
    .from("enrolments")
    .select("class_id, student_id")
    .eq("session_label", sessionLabel)
    .eq("status", "enrolled");

  if (rollError) throw new Error(rollError.message);

  const byClass = new Map<string, string[]>();
  for (const row of roll ?? []) {
    const id = row.class_id as string;
    byClass.set(id, [...(byClass.get(id) ?? []), row.student_id as string]);
  }

  const [chosen] = [...byClass.entries()].sort((a, b) => b[1].length - a[1].length);
  if (!chosen) throw new Error("No class has any children — run npm run qa:seed");

  classId = chosen[0];
  firstStudentId = [...chosen[1]].sort()[0];

  const { data: klass } = await db("public")
    .from("classes")
    .select("class_name")
    .eq("id", classId)
    .maybeSingle();

  className = (klass?.class_name as string) ?? classId;
});

test.afterAll(async () => {
  // The request cascades to its fields and submissions.
  if (requestId) await db().from("collection_requests").delete().eq("id", requestId);
});

test("the office asks for a number, a teacher answers without signing in, and the office sees it", async ({
  page,
  browser,
}) => {
  const account = await signIn(page, "office", "/collection");
  const language = account.language;

  /* ------------------------------------------------------- 1. ask for it */

  const title = `QA mother phone ${Date.now()}`;

  await page.fill("#title-en", title);
  // B-05: a one-language school still has to type both. Recorded by doing it.
  await page.fill("#title-hi", title);
  await page.selectOption("#req-class", classId!);

  // By id, not by label text: the office reads in Hindi and the field's own
  // labels are editable from /collection/fields, so a label-text locator would
  // be testing the seed rather than the form.
  await page.check(`#field-${fieldId}`);

  await page.getByRole("button", { name: primary(m.collectionNew, language) }).click();

  await expect(page.getByText(title).first()).toBeVisible();

  /* ------------------------------------------- 2. what the request became */

  const request = await readRequest(title);

  expect(request, "no request row exists after creating one").not.toBeNull();
  requestId = request!.id;
  token = request!.token;
  classId = request!.class_id;

  // A new request is a **draft**: written down, not yet live. The office
  // decides when the link starts working.
  expect(request!.status, "a new request should not already be live").toBe("draft");

  // The label is denormalised onto the request so a link outlives a renamed
  // class. It still has to be the class that was chosen when it was written.
  expect(request!.class_label, "the request names a different class").toBe(className);
  expect(
    token.length,
    "a token short enough to guess is not a token",
  ).toBeGreaterThanOrEqual(16);

  const { data: askedFor } = await db()
    .from("collection_request_fields")
    .select("field_id")
    .eq("request_id", requestId);

  expect(
    (askedFor ?? []).map((row) => row.field_id),
    "the request does not ask for the field that was ticked",
  ).toEqual([fieldId]);

  /* ------------------------- 3. a draft link is not a link yet */

  const anonymous = await browser.newContext();
  const link = await anonymous.newPage();

  const draftResponse = await link.goto(`/r/${token}`);

  // Not "closed", not "not ready" — the same 404 an invented token gets.
  // Telling a stranger that their guess named a real request is telling them
  // their guess was right (TOKEN_REJECTION_IS_ALWAYS_404).
  expect(
    draftResponse?.status(),
    "a draft link answers something other than 404",
  ).toBe(404);

  /* -------------------------------- 4. the office turns the link on */

  await page.goto(`/collection/${requestId}`);
  await page.getByRole("button", { name: primary(m.collectionOpen, language) }).click();

  await expect
    .poll(async () => (await readRequest(title))?.status, { timeout: 15_000 })
    .toBe("open");

  /* ---------------------------- 5. the link, with no session behind it */

  await link.goto(`/r/${token}`);

  await expect(
    link.getByText(title).first(),
    "the token link does not say what is being asked for",
  ).toBeVisible();

  await expect(
    link.getByRole("listitem"),
    "the token link did not load the class roster",
  ).not.toHaveCount(0);

  const input = link.locator(`[id="${firstStudentId}|${FIELD_KEY}"]`);
  await expect(input, "the first child has no field to answer").toBeVisible();

  /* ------------------ 6. a nine-digit number cannot reach the database */

  // The link surface is public and carries its own language cookie, so both
  // halves of the pair are accepted here rather than assuming one.
  const send = link.getByRole("button", { name: /भेजें|Send/ });

  await input.fill(TOO_SHORT);

  // Not "the save failed" — **the save is not offered**. A phone number that is
  // not a 10-digit Indian mobile is impossible to submit, rather than something
  // the office cleans up afterwards (D-30).
  await expect(
    send,
    "a nine-digit phone number could still be sent",
  ).toBeDisabled();

  expect(
    (await readSubmissions()).length,
    "a nine-digit phone number reached the database",
  ).toBe(0);

  /* ------------------------------------------ 7. the real answer lands */

  await input.fill(GOOD_NUMBER);
  await expect(send).toBeEnabled();
  await send.click();

  await expect
    .poll(async () => (await readSubmissions()).length, {
      message: "the answer never reached the database",
      timeout: 15_000,
    })
    .toBe(1);

  const [submission] = await readSubmissions();
  expect(submission.value).toBe(GOOD_NUMBER);
  expect(submission.student_id).toBe(firstStudentId);
  expect(submission.status, "an answer arrives waiting for review").toBe("pending");

  /* ---------------------- 8. re-answering replaces rather than piles up */

  await input.fill("9812345671");
  await send.click();

  await expect
    .poll(async () => (await readSubmissions())[0]?.value, { timeout: 15_000 })
    .toBe("9812345671");

  expect(
    (await readSubmissions()).length,
    "a correction became a second submission instead of replacing the first",
  ).toBe(1);

  await anonymous.close();

  /* ------------------------------------- 9. the office sees it waiting */

  await page.goto("/collection/review");

  await expect(
    page.getByText("9812345671").first(),
    "the answer is not in the review queue",
  ).toBeVisible();
});

async function readRequest(title: string) {
  const { data, error } = await db()
    .from("collection_requests")
    .select("id, token, status, class_id, class_label")
    .eq("title_en", title)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as {
    id: string;
    token: string;
    status: string;
    class_id: string;
    class_label: string;
  } | null;
}

async function readSubmissions() {
  if (!requestId) return [];

  const { data, error } = await db()
    .from("collection_submissions")
    .select("id, student_id, field_id, value, status")
    .eq("request_id", requestId);

  if (error) throw new Error(error.message);
  return (data ?? []) as {
    id: string;
    student_id: string;
    field_id: string;
    value: string;
    status: string;
  }[];
}
