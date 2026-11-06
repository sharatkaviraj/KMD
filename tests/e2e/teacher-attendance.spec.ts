import { expect, test } from "@playwright/test";

import * as m from "@/messages/pairs";
import { attendanceLabels } from "@/modules/attendance/domain/attendance";
import { primary } from "@/platform/i18n/language";

import { db, ownClassOf, schoolToday, signIn } from "./support/harness";

/**
 * A teacher takes her class's register, and it is still there afterwards.
 *
 * The first of PLAN §5 R0's two automated journeys. What it is really for is
 * the gap between "the screen said Submitted" and "the school has a register":
 * the badge is a `useState`, and every attendance bug this app has had — the
 * offline notice that lied (D-88), the empty rows written for unreached
 * children (D-89) — rendered perfectly while being wrong.
 *
 * So every step here asserts the rows, and the reload asserts they came back.
 */

const today = schoolToday();

/**
 * This journey needs a day the school is open, and Sunday is not one.
 *
 * `isSchoolOpen()` treats Sunday as closed unless the academic calendar says
 * otherwise, so a teacher's Today card correctly offers no register — that is
 * one of the three kinds of nothing it is built to name (D-59), and D-101 was
 * the bug where a Sunday claimed nineteen registers were outstanding.
 *
 * The test used to fail on it, with "the class the teacher holds is not
 * offered as work to do" — which reads exactly like a regression and is not
 * one. A skip that says why is the honest report; the alternative is writing
 * an open day into the shared academic calendar to suit a test, which changes
 * what every other spec sees.
 */
const schoolIsClosedToday = new Date(`${today}T00:00:00Z`).getUTCDay() === 0;

test.skip(
  schoolIsClosedToday,
  `the school is closed on ${today} (a Sunday), so there is no register to take`,
);

type Scene = Awaited<ReturnType<typeof ownClassOf>>;

let scene: Scene;

/**
 * The register as it was before this run touched it, and how to put it back.
 *
 * **A register for today may already exist** — the `open-registers` job opens
 * one per class every morning (Phase 7.2), unsaved, at revision 0. What the
 * teacher does is save it. A register somebody has already *recorded* today
 * is history (P6): the run skips rather than unsaving it, because rewriting a
 * recorded register to suit a test is exactly what revisions exist to stop.
 */
let before: {
  id: string;
  status: string;
  revision: number;
  taken_by: string | null;
  submitted_at: string | null;
  on_behalf_of: string | null;
} | null = null;
let beforeMarks: { student_id: string; status: string }[] = [];
let alreadyRecorded = false;

test.beforeAll(async () => {
  scene = await ownClassOf("teacher");

  expect(
    scene.childCount,
    "the QA teacher's class has no children — run `npm run qa:seed`",
  ).toBeGreaterThan(0);

  const { data, error } = await db()
    .from("attendance_registers")
    .select("id, status, revision, taken_by, submitted_at, on_behalf_of")
    .eq("session_label", scene.sessionLabel)
    .eq("class_id", scene.classId)
    .eq("day", today)
    .is("period", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  before = (data as typeof before) ?? null;

  if (before) {
    beforeMarks = await readMarks(before.id);
    alreadyRecorded = before.revision >= 1;
  }
});

test.afterAll(async () => {
  if (alreadyRecorded) return;
  const register = await readRegister(scene);
  if (!register) return;

  // This run's revisions go first: they refuse to outlive their register.
  await db().from("attendance_register_revisions").delete().eq("register_id", register.id);

  if (!before) {
    // Nothing was here; marks cascade from the register.
    await db().from("attendance_registers").delete().eq("id", register.id);
    return;
  }

  await db()
    .from("attendance_registers")
    .update({
      status: before.status,
      revision: before.revision,
      taken_by: before.taken_by,
      submitted_at: before.submitted_at,
      on_behalf_of: before.on_behalf_of,
      totals: null,
      roster_hash: null,
    })
    .eq("id", before.id);

  await db().from("attendance_marks").delete().eq("register_id", before.id);

  if (beforeMarks.length > 0) {
    await db()
      .from("attendance_marks")
      .insert(
        beforeMarks.map((mark) => ({
          register_id: before!.id,
          student_id: mark.student_id,
          status: mark.status,
        })),
      );
  }
});

test("the day's work on Today leads to the register, and taking it clears it", async ({
  page,
}) => {
  test.skip(alreadyRecorded, "today's register is already recorded, and a test does not unsave a register");

  const account = await signIn(page, "teacher", "/teach");
  const language = account.language;

  /* ------------------------------------------------- 1. the next action */

  // Located by its heading, not by `getByRole("region", { name })`: the
  // `Section` primitive renders a bare <section> with an <h2> inside and no
  // `aria-labelledby`, so the landmark has no accessible name (B-23).
  const needsDoing = page.locator("section").filter({
    has: page.getByRole("heading", { name: primary(m.teachNeedsDoing, language) }),
  });

  await expect(
    needsDoing.getByRole("link", { name: new RegExp(scene.className) }),
    "the class the teacher holds is not offered as work to do",
  ).toBeVisible();

  await needsDoing.getByRole("link", { name: new RegExp(scene.className) }).click();

  await expect(page).toHaveURL(new RegExp(`/teach/attendance\\?.*class=${scene.classId}`));

  /* --------------------------------------------- 2. mark, with exceptions */

  // Everyone shows as present until the register is saved; only the
  // exceptions are marked (P6). Nothing is written yet.
  const rows = page.locator("li[data-student]");
  const markedRows = await rows.count();

  expect(
    markedRows,
    "the register does not list the class's children",
  ).toBeGreaterThanOrEqual(scene.childCount);

  const absentLabel = primary(attendanceLabels.absent, language);
  const absentees = Math.min(2, scene.childCount);

  for (let index = 0; index < absentees; index += 1) {
    await rows.nth(index).getByRole("button", { name: absentLabel, exact: true }).click();
  }

  const unsaved = await readRegister(scene);
  expect(unsaved?.revision ?? 0, "marking a child recorded something before Save").toBe(0);

  /* ------------------------------------------------- 3. review, then save */

  await page.getByRole("button", { name: primary(m.attendanceReview, language) }).click();
  await page.getByRole("button", { name: primary(m.attendanceSaveConfirm, language), exact: true }).click();

  await expect(
    page.locator("[data-attendance-receipt]"),
    "the register did not show a receipt",
  ).toBeVisible({ timeout: 30_000 });

  /* ----------------------------------------- 4. what actually got written */

  const register = await readRegister(scene);

  expect(register, "no register row exists after a save").not.toBeNull();
  expect(register!.status, "the register was created but never recorded").toBe("submitted");
  expect(register!.revision, "a first save is revision 1").toBe(1);

  const marks = await readMarks(register!.id);

  expect(marks.length, "a mark per child on the roll").toBe(scene.childCount);
  expect(
    marks.filter((mark) => mark.status === "absent").length,
    "the two exceptions did not land as absences",
  ).toBe(absentees);
  expect(marks.filter((mark) => mark.status === "present").length).toBe(
    scene.childCount - absentees,
  );

  /* ------------------------------------ 5. reload: the marks are still there */

  await page.reload();

  await expect(
    page.locator("li[data-student]").nth(0).getByRole("button", { name: absentLabel, exact: true }),
    "an absence did not survive a reload",
  ).toHaveAttribute("aria-pressed", "true");

  /* --------------------------- 6. a recorded register offers no second save */

  await expect(
    page.getByRole("button", { name: primary(m.attendanceReview, language) }),
    "a recorded register still offers Save",
  ).toHaveCount(0);

  const { data: revisions } = await db()
    .from("attendance_register_revisions")
    .select("id")
    .eq("register_id", register!.id);
  expect(revisions ?? [], "one save, one revision").toHaveLength(1);

  /* --------------------------- 7. downstream: Today no longer asks for it */

  await page.goto("/teach");

  await expect(
    page
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: primary(m.teachNeedsDoing, language),
        }),
      })
      .getByRole("link", { name: new RegExp(scene.className) }),
    "Today still asks for a register that has been submitted",
  ).toHaveCount(0);
});

async function readRegister(current: Scene) {
  const { data, error } = await db()
    .from("attendance_registers")
    .select("id, status, revision, taken_by, on_behalf_of")
    .eq("session_label", current.sessionLabel)
    .eq("class_id", current.classId)
    .eq("day", today)
    .is("period", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as { id: string; status: string; revision: number; taken_by: string | null } | null;
}

async function readMarks(registerId: string) {
  const { data, error } = await db()
    .from("attendance_marks")
    .select("student_id, status")
    .eq("register_id", registerId);

  if (error) throw new Error(error.message);
  return (data ?? []) as { student_id: string; status: string }[];
}
