import { expect, test, type Page } from "@playwright/test";

import { db, signIn } from "./support/harness";

/**
 * Phase 3 (D-340, D-346): the test-session fence, in a browser.
 *
 * These journeys run against a local `next dev`, which is a CONFINED
 * deployment: every account is fenced to TEST-2026-27 there, an admin
 * included, and the QA accounts are test accounts anyway. So what a browser
 * can check is the test-account side of the matrix — the side a leak would
 * show on — in both directions a URL can reach:
 *
 *  - `?session=2026-27` lands on TEST-2026-27, the pill says TEST and marks
 *    itself as the test session (`data-test-session`);
 *  - a real (2026-27) student, its edit page, its ledger print and a real
 *    receipt, opened by id or number, are "not found"; a TEST student opens;
 *  - the confined banner is on every screen, a test admin's included;
 *  - a test admin asking for 2026-27 still lands on TEST (role admin is not
 *    enough, critique0 #14);
 *  - a test teacher DOES get the pill, showing TEST-2026-27 — on production it
 *    is the only thing on a teacher's screen saying they are in the test bed
 *    (a real teacher gets none; see test-session-policy.test.ts);
 *  - the phone width gets the phone pill.
 *
 * Writes are not driven from here (a server action cannot be called by URL);
 * a test admin's write into 2026-27 is refused by assertSessionWritable /
 * assert*Visible (tests/test-session-access.test.ts, the architecture test)
 * and, over PostgREST, by the database (scripts/verify-test-session-fence.sql
 * cases E and J–N). The real-staff side (office never sees TEST; a real admin
 * sees both) needs an unconfined deployment and a non-test account: the unit
 * matrix (tests/test-session-policy.test.ts) and the SQL proof cover it.
 */

/**
 * "Not found", however the page says it. A route with a `loading.tsx` streams:
 * the 200 is on the wire before the page calls `notFound()`, so the status
 * stays 200 and the not-found screen arrives in the stream (seen on
 * `/fees/students/[id]`, Phase C). Either way the record must not show — and
 * on a 200 that is checked, not assumed: `absent` (the real record's admission
 * number) must not be in the page's visible text, so a page that streamed the
 * record and then a not-found heading still fails. Compared as a boolean, so a
 * failure does not print it.
 */
async function expectNotFound(page: Page, status: number | undefined, what: string, absent: string) {
  if (status === 404) return;
  expect(status, what).toBe(200);
  // A screen the account has no permission for (the edit page, for an
  // accountant) refuses before it reads the record — a redirect inside the
  // stream, so it lands after goto() returns. Also not shown.
  const notFound = page.getByRole("heading", { name: /could not find|does not exist|no longer exists|not found|नहीं मिला/i }).first();
  await expect
    .poll(async () => new URL(page.url()).pathname === "/access-denied" || (await notFound.isVisible()), {
      message: what,
      timeout: 60_000,
    })
    .toBe(true);
  const visible = await page.locator("body").innerText();
  expect(visible.includes(absent), `${what} shows the real record`).toBe(false);
}

type StudentRef = { id: string; admissionNo: string };

async function studentIn(session: string): Promise<StudentRef> {
  const { data: classes, error } = await db("public").from("classes").select("id").eq("session_label", session).limit(20);
  if (error || !classes?.length) throw new Error(`No ${session} class to pick a student from`);
  const { data, error: studentError } = await db("public")
    .from("students")
    .select("id, admission_no")
    .in("class_id", classes.map((row) => row.id as string))
    .not("admission_no", "is", null)
    .limit(1)
    .maybeSingle<{ id: string; admission_no: string }>();
  if (studentError || !data) throw new Error(`No ${session} student`);
  return { id: data.id, admissionNo: data.admission_no };
}

async function receiptIn(session: string): Promise<{ receiptNumber: string; admissionNo: string } | null> {
  const student = await studentIn(session);
  const { data } = await db("public")
    .from("receipts")
    .select("receipt_number")
    .eq("student_id", student.id)
    .limit(1)
    .maybeSingle<{ receipt_number: string }>();
  return data ? { receiptNumber: data.receipt_number, admissionNo: student.admissionNo } : null;
}

test("a test account asking for 2026-27 lands on TEST-2026-27", async ({ page }) => {
  await signIn(page, "accountant", "/fees/dashboard?session=2026-27");
  await expect(page.locator(".vx-confined")).toBeVisible();
  await expect(page.locator(".vx-sessionbar")).toContainText("TEST-2026-27");
  await expect(page.locator(".vx-sessionbar")).toHaveAttribute("data-test-session", "true");
  await expect(page.locator(".vx-sessionbar")).not.toContainText(/Live ·/);
});

test("a test admin asking for 2026-27 still lands on TEST-2026-27", async ({ page }) => {
  await signIn(page, "admin", "/fees/dashboard?session=2026-27");
  await expect(page.locator(".vx-confined")).toBeVisible();
  await expect(page.locator(".vx-sessionbar")).toContainText("TEST-2026-27");
});

test("a real student opened by id is not found; a TEST student opens", async ({ page }) => {
  await signIn(page, "accountant", "/fees/dashboard");
  const real = await studentIn("2026-27");
  for (const path of [`/fees/students/${real.id}`, `/fees/students/${real.id}/edit`, `/fees/reports/ledger/${real.id}/print`]) {
    const response = await page.goto(path);
    await expectNotFound(page, response?.status(), path, real.admissionNo);
  }

  const testStudent = await studentIn("TEST-2026-27");
  const ok = await page.goto(`/fees/students/${testStudent.id}`);
  expect(ok?.status()).toBe(200);
});

test("a real receipt opened by number is not found", async ({ page }) => {
  const receipt = await receiptIn("2026-27");
  test.skip(!receipt, "no 2026-27 receipt in the replica");
  await signIn(page, "accountant", "/fees/dashboard");
  const response = await page.goto(`/receipts/${encodeURIComponent(receipt?.receiptNumber ?? "")}`);
  await expectNotFound(page, response?.status(), "receipt", receipt?.admissionNo ?? "");
});

test("a test teacher gets the pill, and it says TEST-2026-27", async ({ page }) => {
  await signIn(page, "teacher", "/teach?session=2026-27");
  await expect(page.locator(".vx-sessionbar")).toContainText("TEST-2026-27");
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the phone pill replaces the dropdown", async ({ page }) => {
    await signIn(page, "accountant", "/fees/dashboard");
    await expect(page.locator(".vx-sessionbar-m")).toBeVisible();
    await expect(page.locator(".vx-sessionbar-d")).toBeHidden();
  });
});
