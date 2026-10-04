import { randomUUID } from "node:crypto";

import { expect, test, type Browser } from "@playwright/test";

import { currentSessionLabel, db, ownClassOf, signIn } from "./support/harness";

/**
 * P7 in a browser: the subject teacher drafts a paper's marks, cannot submit
 * while anybody is blank, submits once everybody has a mark, an absence or an
 * exemption, and then changes a mark only with a reason. A save whose answer
 * is lost is confirmed by asking, not sent twice. The class teacher reads a
 * subject she does not teach but cannot type into it.
 *
 * A synthetic exam on the QA teacher's class, deleted afterwards with all its
 * marks, log and commands.
 */

test.describe.configure({ mode: "serial" });

const EXAM = randomUUID();
const PAPER = randomUUID();
const NOT_HERS = randomUUID();
let sessionLabel = "";

test.beforeAll(async () => {
  sessionLabel = await currentSessionLabel();
  const scene = await ownClassOf("teacher");
  const teacherId = scene.staffProfileId;

  const { data: taught } = await db()
    .from("teaching_assignments")
    .select("subject_id")
    .eq("session_label", sessionLabel)
    .eq("staff_profile_id", teacherId)
    .eq("class_id", scene.classId);
  const mine = new Set((taught ?? []).map((row) => row.subject_id as string));
  const { data: subjects } = await db().from("subjects").select("id, code").eq("is_active", true);
  const assigned = (subjects ?? []).find((row) => mine.has(row.id));
  const other = (subjects ?? []).find((row) => !mine.has(row.id));
  expect(assigned && other, "the QA teacher teaches one subject in her class and not another").toBeTruthy();

  await db().from("assessments").delete().like("code", "QA-P7E-%");
  const { error: examError } = await db().from("assessments").insert({
    id: EXAM,
    session_label: sessionLabel,
    term: "QA",
    code: `QA-P7E-${EXAM.slice(0, 8)}`,
    label_hi: "QA परीक्षा",
    label_en: "QA exam",
    status: "open",
  });
  if (examError) throw new Error(examError.message);
  const { error } = await db().from("assessment_subjects").insert([
    { id: PAPER, assessment_id: EXAM, class_id: scene.classId, class_label: scene.className, subject_id: assigned!.id, subject_code: assigned!.code, max_marks: 40, mark_step: 0.5, allow_exempt: true },
    { id: NOT_HERS, assessment_id: EXAM, class_id: scene.classId, class_label: scene.className, subject_id: other!.id, subject_code: other!.code, max_marks: 40, mark_step: 0.5, allow_exempt: true },
  ]);
  if (error) throw new Error(error.message);
});

test.afterAll(async () => {
  await db().from("assessments").delete().eq("id", EXAM);
});

async function asAccount(browser: Browser, key: string, next: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, key, next);
  return { context, page };
}

async function paper() {
  const { data } = await db().from("assessment_subjects").select("entry_status, entry_revision").eq("id", PAPER).single();
  return data as { entry_status: string; entry_revision: number };
}

test("the subject teacher drafts, cannot submit with blanks, submits, then corrects with a reason", async ({ browser }) => {
  test.setTimeout(240_000);
  const { context, page } = await asAccount(browser, "teacher", `/assessments/marks/${PAPER}`);

  const rows = page.locator("li[data-student]");
  const count = await rows.count();
  expect(count).toBeGreaterThan(3);

  /* ------------------------------------------- 1. a draft with gaps in it */

  await rows.nth(0).locator('input[inputmode="decimal"]').fill("0");
  await rows.nth(1).getByRole("button", { name: /^(Absent|अनुपस्थित)$/ }).click();
  await rows.nth(2).getByRole("button", { name: /^(Exempt|छूट)$/ }).click();
  await page.getByRole("button", { name: /^(Save draft|मसौदा सहेजें)$/ }).click();
  await expect(page.locator('[data-marks-receipt="draft"]')).toBeVisible({ timeout: 30_000 });

  const { data: drafted } = await db().from("marks").select("value, absent, exempt").eq("assessment_subject_id", PAPER);
  expect(drafted ?? [], "three cells, not a row per child").toHaveLength(3);
  expect((await paper()).entry_status).toBe("open");

  /* ---------------------------- 2. submitting with blanks says who, and stops */

  await page.getByRole("button", { name: /^(Submit marks|अंक जमा करें)$/ }).click();
  await expect(page.locator("[data-marks-blank] li")).toHaveCount(count - 3);
  await expect(page.getByRole("button", { name: /^(Yes, submit|हाँ, जमा करें)$/ })).toBeDisabled();
  await page.getByRole("button", { name: /Back to the marks|अंकों पर लौटें/ }).click();

  /* ------------------------------------------- 3. everybody, then submit */

  for (let index = 3; index < count; index += 1) {
    await rows.nth(index).locator('input[inputmode="decimal"]').fill(String((index % 40) + 0.5));
  }
  await page.getByRole("button", { name: /^(Submit marks|अंक जमा करें)$/ }).click();
  await page.getByRole("button", { name: /^(Yes, submit|हाँ, जमा करें)$/ }).click();
  await expect(page.locator('[data-marks-receipt="submit"]')).toBeVisible({ timeout: 30_000 });
  expect(await paper()).toMatchObject({ entry_status: "submitted" });

  /* -------------------------------------- 4. a change now needs a reason */

  await page.getByRole("button", { name: /Correct submitted marks|जमा अंक सुधारें/ }).click();
  await rows.nth(3).locator('input[inputmode="decimal"]').fill("39");
  const save = page.getByRole("button", { name: /Save the correction|सुधार सहेजें/ });
  await expect(save, "a correction without a reason cannot be saved").toBeDisabled();
  await page.locator("#marks-correction-reason").fill("Re-totalled the paper");
  await save.click();
  await expect(page.locator('[data-marks-receipt="correction"]')).toBeVisible({ timeout: 30_000 });

  const { data: log } = await db().from("marks_change_log").select("reason").eq("assessment_subject_id", PAPER).eq("reason", "Re-totalled the paper");
  expect(log ?? []).toHaveLength(1);
  expect((await paper()).entry_status, "a correction keeps the paper submitted").toBe("submitted");
  await context.close();
});

test("a draft whose answer is lost is checked, not sent twice", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await asAccount(browser, "exam", `/assessments/marks/${NOT_HERS}`);
  const before = await db().from("marks_commands").select("id").eq("assessment_subject_id", NOT_HERS);

  let lost = false;
  await page.route("**/assessments/marks/**", async (route) => {
    const request = route.request();
    if (!lost && request.method() === "POST" && request.headers()["next-action"]) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.locator("li[data-student]").nth(0).locator('input[inputmode="decimal"]').fill("12.5");
  await page.getByRole("button", { name: /^(Save draft|मसौदा सहेजें)$/ }).click();
  await expect(page.locator('[data-marks-receipt="draft"]')).toBeVisible({ timeout: 45_000 });
  expect(lost).toBe(true);

  const after = await db().from("marks_commands").select("id").eq("assessment_subject_id", NOT_HERS);
  expect((after.data ?? []).length - (before.data ?? []).length, "saved once, not twice").toBe(1);
  await context.close();
});

test("the class teacher reads a subject she does not teach, and cannot type into it", async ({ browser }) => {
  const { context, page } = await asAccount(browser, "teacher", `/assessments/marks/${NOT_HERS}`);
  await expect(page.getByText(/its subject teacher enters these marks|इसके विषय-अध्यापक भरेंगे/).first()).toBeVisible();
  await expect(page.locator('li[data-student] input[inputmode="decimal"]').first()).toBeDisabled();
  await expect(page.getByRole("button", { name: /^(Save draft|मसौदा सहेजें)$/ })).toHaveCount(0);
  await context.close();
});
