import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { currentSessionLabel, db, ownClassOf, signIn } from "./support/harness";

/**
 * P8 in a browser: the exam office approves a term's scheme, sees an unissued
 * card marked Draft, issues it, then reissues it — which asks why and keeps
 * revision 1 in the history.
 *
 * A synthetic term (`QA-P8E-…`) on the QA teacher's class with one paper,
 * submitted through the marks command; its exam, marks, scheme and cards are
 * removed afterwards — the one kind of term the append-only rules allow a test
 * to remove.
 */

test.describe.configure({ mode: "serial" });

const TERM = `QA-P8E-${randomUUID().slice(0, 8)}`;
const EXAM = randomUUID();
const PAPER = randomUUID();
let child = "";

async function cleanup() {
  await db().from("report_card_issues").delete().eq("term", TERM);
  await db().from("report_schemes").delete().eq("term", TERM);
  await db().from("assessments").delete().eq("term", TERM);
}

test.beforeAll(async () => {
  const sessionLabel = await currentSessionLabel();
  const scene = await ownClassOf("teacher");
  const { data: subject } = await db().from("subjects").select("id, code").eq("is_active", true).limit(1).single();

  const { error: examError } = await db().from("assessments").insert({
    id: EXAM, session_label: sessionLabel, term: TERM, code: TERM, label_hi: "QA", label_en: "QA", status: "open",
  });
  if (examError) throw new Error(examError.message);
  const { error: paperError } = await db().from("assessment_subjects").insert({
    id: PAPER, assessment_id: EXAM, class_id: scene.classId, class_label: scene.className,
    subject_id: subject!.id, subject_code: subject!.code, max_marks: 40, mark_step: 0.5, allow_exempt: true,
  });
  if (paperError) throw new Error(paperError.message);

  const { data: roster } = await db().rpc("paper_roster", { p_paper: PAPER });
  const ids = [...(roster as string[])].sort();
  child = ids[0];

  // Submitted through the same command a teacher uses, as the exam office.
  const users = await db().auth.admin.listUsers({ perPage: 1000 });
  const examUser = users.data.users.find((user) => user.email === "qa.exam@qa.vpps.local");
  const { data: office } = await db().from("staff_profiles").select("id").eq("user_id", examUser!.id).single();
  const { data: submitted, error } = await db().rpc("save_marks", {
    p: {
      command_id: randomUUID(),
      actor_staff_id: office!.id,
      paper_id: PAPER,
      kind: "submit",
      expected_revision: 0,
      payload_hash: "e2e",
      entries: ids.map((id, index) => ({ student_id: id, state: "value", value: 20 + (index % 20) })),
    },
  });
  if (error || !(submitted as { ok?: boolean }).ok) throw new Error("Could not submit the synthetic paper.");
});

test.afterAll(async () => {
  await cleanup();
});

test("the exam office approves the scheme, issues a card, and reissues it with a reason", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "exam", `/assessments/scheme?term=${encodeURIComponent(TERM)}`);

  /* ------------------------------------------------- 1. the scheme */

  await page.getByRole("button", { name: /^(Save draft|मसौदा सहेजें)$/ }).click();
  await page.getByRole("button", { name: /Approve the scheme|नियम स्वीकृत करें/ }).click();
  await expect(page.locator("[data-scheme-approved]")).toBeVisible({ timeout: 30_000 });

  /* ---------------------------------- 2. an unissued card says Draft */

  await page.goto(`/assessments/report/${child}?term=${encodeURIComponent(TERM)}`);
  await expect(page.locator('[data-report-state="draft"]')).toBeVisible();
  await expect(page.getByText(/DRAFT — not issued|मसौदा — जारी नहीं/).first()).toBeVisible();

  /* ------------------------------------------------- 3. issue it */

  await page.getByRole("button", { name: /^(Issue this card|जारी करें)$/ }).click();
  await expect(page.locator('[data-report-state="issued"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-report-issued]")).toHaveAttribute("data-report-issued", "1");

  /* ------------------------------------ 4. reissue asks why, keeps 1 */

  const reason = page.locator("#reissue-reason");
  await expect(reason).toBeVisible();
  await reason.fill("Father's name corrected");
  await page.getByRole("button", { name: /^(Issue it again|फिर जारी करें)$/ }).click();
  await expect(page.locator("[data-report-issued]")).toHaveAttribute("data-report-issued", "2", { timeout: 30_000 });

  const { data: lineage } = await db()
    .from("report_card_issues")
    .select("revision, status, reason")
    .eq("term", TERM)
    .eq("student_id", child)
    .order("revision");
  expect(lineage).toEqual([
    { revision: 1, status: "superseded", reason: null },
    { revision: 2, status: "issued", reason: "Father's name corrected" },
  ]);
  await expect(page.getByText(/Father's name corrected/).first()).toBeVisible();
});
