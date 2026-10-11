import { expect, test, type Page } from "@playwright/test";
import { db } from "../e2e/support/harness";
import { qaAccount } from "../fixtures/qa-accounts";

const studentId = "4f0d0fb5-1714-4dae-af33-998977941d08";
const date = "2026-04-03";
const session = "2026-27";

// Existing synthetic QA account only; ephemeral login, no storage state or trace.
async function signInSafely(page: Page, next: string) {
  const account = qaAccount("accountant");
  const { data, error } = await db().auth.admin.generateLink({ type: "magiclink", email: account.email });
  if (error || !data?.properties?.hashed_token) throw Error("Synthetic accountant sign-in could not be prepared.");
  try {
    await page.goto(`/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=${encodeURIComponent(next)}`);
  } catch { throw Error("Synthetic accountant sign-in navigation failed; auth URL withheld."); }
  expect(page.url().includes("/login")).toBe(false);
}

test("accountant selects the audited synthetic student on touch phone widths without writing", async ({ page }) => {
  const { data: fixture, error } = await db("public").from("students")
    .select("id,admission_no,primary_phone,secondary_phone,email,class_id")
    .eq("id", studentId).single();
  expect(error).toBeNull();
  expect(fixture?.admission_no).toBe("OPS-SCHOOL-20261011-ACCOUNTANT");
  expect(fixture?.primary_phone).toBeNull(); expect(fixture?.secondary_phone).toBeNull();
  expect(fixture?.email).toBe("ops.accountant.20261011@qa.vpps.local");
  const before = await db("public").from("receipts").select("id", { count: "exact", head: true }).eq("student_id", studentId);
  expect(before.error).toBeNull(); expect(before.count).toBe(0);
  const beforeClose = await db().from("fee_day_close_events").select("id", { count: "exact", head: true }).eq("payment_date", date);
  expect(beforeClose.error).toBeNull(); expect(beforeClose.count).toBe(0);
  await signInSafely(page, `/payments?student=${studentId}&session=${session}`);
  await expect(page.locator("#pd-amount")).toBeVisible();
  for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator("#pd-amount")).toBeVisible();
    const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, touch: navigator.maxTouchPoints }));
    expect(geometry.touch).toBeGreaterThan(0); expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
    await page.locator("#pd-amount").tap();
    await expect(page.locator("#pd-amount")).toBeFocused();
  }
  const after = await db("public").from("receipts").select("id", { count: "exact", head: true }).eq("student_id", studentId);
  expect(after.error).toBeNull(); expect(after.count).toBe(before.count);
});
