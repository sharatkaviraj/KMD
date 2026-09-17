import { expect, test } from "@playwright/test";

import { currentSessionLabel, db, signIn } from "./support/harness";

/**
 * Choosing who a round asks about, and getting the same number twice.
 *
 * **The count is the whole test.** The office decides whether to send by
 * reading a number off this screen, so the number has to be the resolver's and
 * not the browser's arithmetic — the day those are two code paths is the day a
 * preview says nine and the round covers eleven (S-03, B-02).
 *
 * So each assertion is the screen against the database, never the screen
 * against itself: the roll is counted in SQL, the gap filter is made to bite
 * by writing records the app itself would write, and the round that is created
 * is read back out of `collection_rounds`.
 */

const FIELD_KEY = "guardian_phone";

/** Written for a few children so the gap filter has something to remove. */
const FILLED_IN = "9812345670";

let sessionLabel = "";
let classId = "";
let className = "";
let fieldId = "";
let roll: string[] = [];
/** The children the filter would select **right now**, counted in SQL. */
let gapNow: string[] = [];
let filledIn: string[] = [];
let roundId: string | null = null;
let frozenRoundId: string | null = null;

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

  const { data: enrolled, error } = await db()
    .from("enrolments")
    .select("class_id, student_id")
    .eq("session_label", sessionLabel)
    .eq("status", "enrolled");

  if (error) throw new Error(error.message);

  const byClass = new Map<string, string[]>();
  for (const row of enrolled ?? []) {
    const id = row.class_id as string;
    byClass.set(id, [...(byClass.get(id) ?? []), row.student_id as string]);
  }

  // Biggest class, and it needs enough children that removing four still
  // leaves a number distinguishable from the total.
  const [chosen] = [...byClass.entries()].sort((a, b) => b[1].length - a[1].length);
  if (!chosen || chosen[1].length < 6) {
    throw new Error("No class has six children — run npm run qa:seed");
  }

  classId = chosen[0];
  roll = [...chosen[1]].sort();

  // **Counted, never assumed.** The dev fixture already holds this field for
  // one child in the biggest class, so a test that assumed "nobody has it"
  // would fail against the seed rather than against the app — and a test that
  // hard-coded 15 would pass the day the resolver started ignoring the filter
  // entirely. Both numbers below come from the same two sources the resolver
  // reads, in the same precedence.
  const { data: recorded, error: recordError } = await db()
    .from("student_records")
    .select("student_id, value")
    .eq("field_id", fieldId)
    .in("student_id", roll);

  if (recordError) throw new Error(recordError.message);

  const { data: feeRows, error: feeError } = await db("public")
    .from("students")
    .select("id, guardian_phone")
    .in("id", roll);

  if (feeError) throw new Error(feeError.message);

  const held = new Set<string>();
  for (const row of recorded ?? []) {
    if (((row.value as string | null) ?? "").trim() !== "") held.add(row.student_id as string);
  }
  for (const row of feeRows ?? []) {
    if (((row.guardian_phone as string | null) ?? "").trim() !== "") {
      held.add(row.id as string);
    }
  }

  gapNow = roll.filter((id) => !held.has(id));
  if (gapNow.length < 6) {
    throw new Error(
      `Only ${gapNow.length} children in the biggest class are missing ${FIELD_KEY} — run npm run qa:reset`,
    );
  }

  // Four the filter currently selects, so filling them in removes exactly four.
  filledIn = gapNow.slice(0, 4);

  const { data: klass } = await db("public")
    .from("classes")
    .select("class_name")
    .eq("id", classId)
    .maybeSingle();

  className = (klass?.class_name as string) ?? classId;
});

test.afterAll(async () => {
  await db().from("student_records").delete().in("student_id", filledIn).eq("field_id", fieldId);
  if (roundId) await db().from("collection_rounds").delete().eq("id", roundId);
  if (frozenRoundId) {
    await db().from("collection_rounds").delete().eq("id", frozenRoundId);
  }
});

test("the office sees who a round reaches before creating it", async ({ page }) => {
  const account = await signIn(page, "office", "/collection/rounds/new");
  expect(account.language).toBeTruthy();

  /* ------------------------------------------- 1. a whole class, counted */

  await page.goto(`/collection/rounds/new?class=${classId}`);

  await expect
    .poll(() => previewCount(page), { message: "no count rendered", timeout: 15_000 })
    .toBe(roll.length);

  // The class is still ticked after the reload, because the URL is the state.
  await expect(page.locator(`#class-${classId}`)).toBeChecked();

  /* ------------------------------ 2. a gap filter nothing can bite on yet */

  // Whatever the fixture happens to hold, the screen has to agree with it.
  await page.goto(`/collection/rounds/new?class=${classId}&gap=${FIELD_KEY}`);

  await expect
    .poll(() => previewCount(page), {
      message: "the gap filter disagrees with what the database holds",
      timeout: 15_000,
    })
    .toBe(gapNow.length);

  // And it is a real filter, not a no-op that happens to match: at least one
  // child in this class already holds the value and must not be selected.
  expect(
    gapNow.length,
    "every child is missing this, so the filter is not being tested",
  ).toBeLessThan(roll.length);

  // A narrowed audience has to say why, or a teacher gets a short list with
  // nothing to explain it (S-03).
  await expect(
    page.locator("#round-reason-hi"),
    "the reason was not suggested from the filter that was chosen",
  ).not.toHaveValue("");

  /* ---------------------------------- 3. make the filter actually remove */

  // Four children get a value — through `student_records`, which is VPPS One's
  // own and is the same overlay an accepted answer lands in. `public.students`
  // is never written (rule 2).
  const { error } = await db()
    .from("student_records")
    .insert(
      filledIn.map((studentId) => ({
        session_label: sessionLabel,
        student_id: studentId,
        field_id: fieldId,
        value: FILLED_IN,
        source: "office",
      })),
    );

  if (error) throw new Error(error.message);

  await page.goto(`/collection/rounds/new?class=${classId}&gap=${FIELD_KEY}`);

  await expect
    .poll(() => previewCount(page), {
      message: "the gap filter did not narrow after four children were filled in",
      timeout: 15_000,
    })
    .toBe(gapNow.length - filledIn.length);

  // "10 of 15" — a bare 10 with no denominator is a number nobody can
  // sanity-check against the class they are looking at. The denominator is
  // everyone the audience covered *before* the gap filter, which is the roll.
  await expect(
    page.getByText(String(roll.length), { exact: false }).first(),
    "the count does not say what it was narrowed from",
  ).toBeVisible();

  /* -------------------------------------------- 4. create it, and read back */

  const title = `QA round ${Date.now()}`;
  await page.fill("#round-title-hi", title);
  await page.locator("input[name=fieldIds]").first().check();
  await page.getByRole("button", { name: /राउंड बनाएँ|Create the round/ }).click();

  await page.waitForURL(/\/collection\/rounds\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  const round = await readRound(title);
  expect(round, "no round row exists after creating one").not.toBeNull();
  roundId = round!.id;

  // **Stored as chosen, not as resolved.** The description is what lets the
  // board still say "Class 6, no phone number" long after the children in
  // question have changed; the resolved set is frozen per link, at fan-out.
  expect(round!.audience.classIds).toEqual([classId]);
  expect(round!.audience.gaps).toEqual([{ fieldKey: FIELD_KEY }]);
  expect(round!.status).toBe("draft");
  expect(
    round!.reason_hi ?? round!.reason_en,
    "a narrowed round was saved with no reason",
  ).toBeTruthy();

  /* ------------------------- 5. and the round agrees with the preview */

  // The same number, rendered by a different page from the stored audience.
  // This is the assertion the whole screen exists for.
  await expect
    .poll(() => previewCount(page), { timeout: 15_000 })
    .toBe(gapNow.length - filledIn.length);

  await expect(
    page.getByText(className, { exact: false }).first(),
    "the round does not name the class it was built from",
  ).toBeVisible();

  /* ------------------- 6. a frozen list is the whole audience */

  // **The one that would not fail loudly.** These four children all hold the
  // value now, so a gap filter applied on top of the list would remove every
  // one of them and the round would resolve to nobody — a round that quietly
  // covers a smaller set than the list it was frozen from.
  //
  // This is the shape a Resume produces days later: a list frozen from a gap
  // selection, re-resolved after some of the gaps have been filled in. The
  // list wins, and nothing else narrows it.
  const frozenTitle = `QA frozen ${Date.now()}`;

  const { data: frozen, error: frozenError } = await db()
    .from("collection_rounds")
    .insert({
      session_label: sessionLabel,
      title_hi: frozenTitle,
      audience: {
        classIds: [],
        houses: [],
        routeIds: [],
        search: "",
        gaps: [{ fieldKey: FIELD_KEY }],
        allEnrolled: false,
        studentIds: filledIn,
        notes: {},
        from: null,
      },
      reason_hi: "QA — जाँच",
      recipient_mode: "class_teacher",
      status: "draft",
    })
    .select("id")
    .single();

  if (frozenError) throw new Error(frozenError.message);
  frozenRoundId = frozen.id as string;

  await page.goto(`/collection/rounds/${frozenRoundId}`);

  await expect
    .poll(() => previewCount(page), {
      message:
        "a gap filter narrowed a frozen list — the round covers fewer children than it was frozen with",
      timeout: 15_000,
    })
    .toBe(filledIn.length);
});

/** The big number on the preview card, as the office reads it. */
async function previewCount(page: import("@playwright/test").Page) {
  const strong = page.locator("strong").first();
  if ((await strong.count()) === 0) return null;

  const text = (await strong.textContent())?.trim() ?? "";
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readRound(title: string) {
  const { data, error } = await db()
    .from("collection_rounds")
    .select("id, status, audience, reason_hi, reason_en")
    .eq("title_hi", title)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data as {
    id: string;
    status: string;
    audience: {
      classIds: string[];
      gaps: { fieldKey: string }[];
    };
    reason_hi: string | null;
    reason_en: string | null;
  } | null;
}
