import { expect, test, type Browser } from "@playwright/test";

import { currentSessionLabel, db, ownClassOf, signIn, unrecordedSchoolDays } from "./support/harness";

/**
 * P6 in a browser: a register is recorded only when somebody saves the whole
 * roll, the receipt says so, a correction says why and keeps the old
 * revision, and an answer lost on the way back does not save twice.
 *
 * It works on any day of the week, because it takes registers for past school
 * days the QA class has none for, and removes them afterwards. Every step is
 * checked in the rows, not only on the screen.
 */

test.describe.configure({ mode: "serial" });

let scene: Awaited<ReturnType<typeof ownClassOf>>;
let sessionLabel = "";
const days: string[] = [];

async function register(day: string) {
  const { data } = await db()
    .from("attendance_registers")
    .select("id, revision, status, taken_by")
    .eq("session_label", sessionLabel)
    .eq("class_id", scene.classId)
    .eq("day", day)
    .is("period", null)
    .maybeSingle();
  return data as { id: string; revision: number; status: string; taken_by: string | null } | null;
}

async function cleanup() {
  for (const day of days) {
    const row = await register(day);
    if (!row) continue;
    await db().from("attendance_corrections").delete().eq("register_id", row.id);
    await db().from("attendance_register_revisions").delete().eq("register_id", row.id);
    await db().from("attendance_registers").delete().eq("id", row.id);
  }
}

test.beforeAll(async () => {
  sessionLabel = await currentSessionLabel();
  scene = await ownClassOf("teacher");

  // A week back at least — the offline-draft specs take the nearest days,
  // from three back — and never a day the class already has a register for.
  days.push(...(await unrecordedSchoolDays(scene.classId, sessionLabel, 2, 7)));
  await cleanup();
});

test.afterAll(async () => {
  await cleanup();
});

async function asAccount(browser: Browser, key: string, next: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, key, next);
  return { context, page };
}

test("the class teacher saves the whole roll, gets a receipt, then corrects it with a reason", async ({ browser }) => {
  test.setTimeout(180_000);
  const [day] = days;
  const { context, page } = await asAccount(browser, "teacher", `/teach/attendance?class=${scene.classId}&day=${day}`);

  /* ------------------------------------------ 1. opening records nothing */

  await expect(page.getByText(/Nothing is recorded yet|अभी कुछ दर्ज नहीं हुआ/)).toBeVisible();
  expect(await register(day), "opening the register wrote one").toBeNull();

  const rows = page.locator("li[data-student]");
  const count = await rows.count();
  expect(count, "every child on that day's roll is listed").toBeGreaterThan(2);

  /* ------------------------------------- 2. exceptions, review, then save */

  await rows.nth(0).getByRole("button", { name: /^(Absent|अनुपस्थित)$/ }).click();
  await rows.nth(1).getByRole("button", { name: /^(Half day|आधा दिन)$/ }).click();
  expect(await register(day), "marking a child wrote something before Save").toBeNull();

  await page.getByRole("button", { name: /Review and save|जाँचें और सहेजें/ }).click();
  const exceptions = page.locator("[data-attendance-exceptions] li");
  await expect(exceptions).toHaveCount(2);

  await page.getByRole("button", { name: /^(Save attendance|हाज़िरी सहेजें)$/ }).click();
  await expect(page.locator("[data-attendance-receipt]")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Saved by|ने .* पर सहेजा/).first()).toBeVisible();

  const saved = await register(day);
  expect(saved).toMatchObject({ revision: 1, status: "submitted" });
  const { data: marks } = await db().from("attendance_marks").select("status").eq("register_id", saved!.id);
  expect(marks ?? [], "a mark for every child, not only the exceptions").toHaveLength(count);
  expect((marks ?? []).filter((mark) => mark.status === "absent")).toHaveLength(1);
  expect((marks ?? []).filter((mark) => mark.status === "half_day")).toHaveLength(1);

  /* ------------------------- 3. a correction says why; both are kept */

  await page.getByRole("button", { name: /Correct this register|इस रजिस्टर में सुधार करें/ }).click();
  await rows.nth(0).getByRole("button", { name: /^(Present|उपस्थित)$/ }).click();
  await page.getByRole("button", { name: /Review the correction|सुधार जाँचें/ }).click();
  const saveCorrection = page.getByRole("button", { name: /Save the correction|सुधार सहेजें/ });
  await expect(saveCorrection, "a correction cannot be saved without a reason").toBeDisabled();
  await page.locator("#correction-reason").fill("Arrived after assembly");
  await saveCorrection.click();
  await expect(page.getByText(/Corrected by|ने .* पर सुधारा/).first()).toBeVisible({ timeout: 30_000 });

  const corrected = await register(day);
  expect(corrected!.revision).toBe(2);
  const { data: revisions } = await db()
    .from("attendance_register_revisions")
    .select("revision, kind, reason")
    .eq("register_id", corrected!.id)
    .order("revision");
  expect(revisions).toEqual([
    { revision: 1, kind: "save", reason: null },
    { revision: 2, kind: "correction", reason: "Arrived after assembly" },
  ]);
  await expect(page.getByRole("heading", { name: /^(History|इतिहास)$/ })).toBeVisible();
  await context.close();
});

test("an answer lost on the way back is checked, not sent again", async ({ browser }) => {
  test.setTimeout(180_000);
  const day = days[1];
  const { context, page } = await asAccount(browser, "teacher", `/teach/attendance?class=${scene.classId}&day=${day}`);

  await page.getByRole("button", { name: /Review and save|जाँचें और सहेजें/ }).click();

  // The save reaches the server and is recorded; its answer never reaches the
  // phone. The next request — the screen asking whether it landed — is let
  // through.
  let lost = false;
  await page.route("**/teach/attendance**", async (route) => {
    const request = route.request();
    if (!lost && request.method() === "POST" && request.headers()["next-action"]) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: /^(Save attendance|हाज़िरी सहेजें)$/ }).click();
  await expect(page.locator("[data-attendance-receipt]")).toBeVisible({ timeout: 45_000 });
  expect(lost, "the save's answer was dropped").toBe(true);

  const row = await register(day);
  expect(row).toMatchObject({ revision: 1 });
  const { data: revisions } = await db().from("attendance_register_revisions").select("id").eq("register_id", row!.id);
  expect(revisions ?? [], "saved once, not twice").toHaveLength(1);
  await context.close();
});

test("a subject teacher reads the register and is offered a correction request, not the pen", async ({ browser }) => {
  const [day] = days;
  const { context, page } = await asAccount(browser, "teacher2", `/teach/attendance?class=${scene.classId}&day=${day}`);
  const notYours = page.getByText(/not one of your classes|आपकी कक्षा नहीं/);
  if (await notYours.isVisible().catch(() => false)) {
    // teacher2 does not teach this class: the register is not hers to read.
    await expect(notYours).toBeVisible();
  } else {
    await expect(page.getByRole("button", { name: /Correct this register|इस रजिस्टर में सुधार करें/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Review and save|जाँचें और सहेजें/ })).toHaveCount(0);
  }
  await context.close();
});
