import { expect, test } from "@playwright/test";

import { db, signIn } from "./support/harness";

/**
 * Phase 3 (D-340, D-346): the test-session fence, in a browser.
 *
 * These journeys run against a local `next dev`, which is a CONFINED
 * deployment: every account is fenced to TEST-2026-27 there, an admin
 * included, and the QA accounts are test accounts anyway. So what is checked
 * is the test-account side of the matrix — the side a leak would show on:
 *
 *  - `?session=2026-27` lands on TEST-2026-27, and the pill says TEST;
 *  - a real (2026-27) student opened by id is "not found"; a TEST one opens;
 *  - the confined banner is on every screen;
 *  - a teacher gets no pill; the phone width gets the phone pill.
 *
 * The real-staff side (office never sees TEST; a real admin sees both) needs
 * an unconfined deployment and a non-test account, and is covered by the unit
 * matrix (tests/test-session-policy.test.ts, tests/test-session-access.test.ts)
 * and the SQL proof (scripts/verify-test-session-fence.sql).
 */

async function studentIn(session: string): Promise<string> {
  const { data: classes, error } = await db("public").from("classes").select("id").eq("session_label", session).limit(20);
  if (error || !classes?.length) throw new Error(`No ${session} class to pick a student from`);
  const { data, error: studentError } = await db("public")
    .from("students")
    .select("id")
    .in("class_id", classes.map((row) => row.id as string))
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (studentError || !data) throw new Error(`No ${session} student`);
  return data.id;
}

test("a test account asking for 2026-27 lands on TEST-2026-27", async ({ page }) => {
  await signIn(page, "accountant", "/fees/dashboard?session=2026-27");
  await expect(page.locator(".vx-confined")).toBeVisible();
  await expect(page.locator(".vx-sessionbar")).toContainText("TEST-2026-27");
  await expect(page.locator(".vx-sessionbar")).not.toContainText(/Live ·/);
});

test("a real student opened by id is not found; a TEST student opens", async ({ page }) => {
  await signIn(page, "accountant", "/fees/dashboard");
  const real = await studentIn("2026-27");
  const response = await page.goto(`/fees/students/${real}`);
  expect(response?.status()).toBe(404);

  const testStudent = await studentIn("TEST-2026-27");
  const ok = await page.goto(`/fees/students/${testStudent}`);
  expect(ok?.status()).toBe(200);
});

test("a teacher gets no session pill", async ({ page }) => {
  await signIn(page, "teacher", "/teach");
  await expect(page.locator(".vx-sessionbar")).toHaveCount(0);
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the phone pill replaces the dropdown", async ({ page }) => {
    await signIn(page, "accountant", "/fees/dashboard");
    await expect(page.locator(".vx-sessionbar-m")).toBeVisible();
    await expect(page.locator(".vx-sessionbar-d")).toBeHidden();
  });
});
