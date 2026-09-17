import { expect, test } from "@playwright/test";

import { m } from "@/messages";
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

type Scene = Awaited<ReturnType<typeof ownClassOf>>;

let scene: Scene;

/**
 * The register as it was before this run touched it, and how to put it back.
 *
 * **A register for today already exists** — the `open-registers` job opens one
 * per class every morning (Phase 7.2), so what a teacher does is not create it
 * but submit it. The first version of this teardown assumed the row was the
 * test's own and skipped cleanup whenever it found one, which left Class 1
 * submitted and made the next run fail with "there is nothing to do today".
 * Restoring the columns and the marks is the only version that survives being
 * run twice.
 */
let before: {
  id: string;
  status: string;
  taken_by: string | null;
  submitted_at: string | null;
  on_behalf_of: string | null;
} | null = null;
let beforeMarks: { student_id: string; status: string }[] = [];

test.beforeAll(async () => {
  scene = await ownClassOf("teacher");

  expect(
    scene.childCount,
    "the QA teacher's class has no children — run `npm run qa:seed`",
  ).toBeGreaterThan(0);

  const { data, error } = await db()
    .from("attendance_registers")
    .select("id, status, taken_by, submitted_at, on_behalf_of")
    .eq("session_label", scene.sessionLabel)
    .eq("class_id", scene.classId)
    .eq("day", today)
    .is("period", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  before = (data as typeof before) ?? null;

  if (before) {
    beforeMarks = await readMarks(before.id);

    // Today's register has to be outstanding for the journey to have anything
    // to do. If a previous run left it submitted, put it back first rather
    // than reporting a failure about the fixture.
    if (before.status === "submitted") {
      await db()
        .from("attendance_registers")
        .update({ status: "open", submitted_at: null })
        .eq("id", before.id);
      before = { ...before, status: "open", submitted_at: null };
    }
  }
});

test.afterAll(async () => {
  const register = await readRegister(scene);
  if (!register) return;

  if (!before) {
    // Nothing was here; marks cascade from the register.
    await db().from("attendance_registers").delete().eq("id", register.id);
    return;
  }

  await db()
    .from("attendance_registers")
    .update({
      status: before.status,
      taken_by: before.taken_by,
      submitted_at: before.submitted_at,
      on_behalf_of: before.on_behalf_of,
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

  const rows = page.getByRole("listitem").filter({ has: page.getByRole("button") });
  const markedRows = await rows.count();

  expect(
    markedRows,
    "the register does not list the class's children",
  ).toBeGreaterThanOrEqual(scene.childCount);

  await page
    .getByRole("button", { name: primary(m.attendanceMarkAllPresent, language) })
    .click();

  const absentLabel = primary(attendanceLabels.absent, language);
  const absentees = Math.min(2, scene.childCount);

  for (let index = 0; index < absentees; index += 1) {
    await rows.nth(index).getByRole("button", { name: absentLabel }).click();
  }

  /* ------------------------------------------------------------ 3. save */

  await page.getByRole("button", { name: new RegExp(primary(m.attendanceSubmit, language)) }).click();

  await expect(
    page.getByText(primary(m.attendanceSubmitted, language)),
    "the register did not report itself submitted",
  ).toBeVisible();

  /* ----------------------------------------- 4. what actually got written */

  const register = await readRegister(scene);

  expect(register, "no register row exists after a submitted register").not.toBeNull();
  expect(register!.status, "the register was created but never submitted").toBe("submitted");

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

  const reloadedRows = page.getByRole("listitem").filter({ has: page.getByRole("button") });

  await expect(
    reloadedRows.nth(0).getByRole("button", { name: absentLabel }),
    "an absence did not survive a reload",
  ).toHaveAttribute("aria-pressed", "true");

  /* ---------------------------- 6. submitting twice changes nothing at all */

  const submitAgain = page.getByRole("button", {
    name: new RegExp(primary(m.attendanceSubmit, language)),
  });

  if (await submitAgain.isVisible()) {
    await submitAgain.click();
    await expect(page.getByText(primary(m.attendanceSubmitted, language))).toBeVisible();
  }

  const afterSecond = await readRegister(scene);
  expect(afterSecond!.id, "a second submit created a second register").toBe(register!.id);
  expect(
    (await readMarks(register!.id)).length,
    "a second submit duplicated the marks",
  ).toBe(scene.childCount);

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
    .select("id, status, taken_by, on_behalf_of")
    .eq("session_label", current.sessionLabel)
    .eq("class_id", current.classId)
    .eq("day", today)
    .is("period", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as { id: string; status: string; taken_by: string | null } | null;
}

async function readMarks(registerId: string) {
  const { data, error } = await db()
    .from("attendance_marks")
    .select("student_id, status")
    .eq("register_id", registerId);

  if (error) throw new Error(error.message);
  return (data ?? []) as { student_id: string; status: string }[];
}
