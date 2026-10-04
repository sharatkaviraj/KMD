import { expect, test, type Browser, type Page } from "@playwright/test";

import { db, signIn } from "./support/harness";

/**
 * P9 in a browser: a parent message is approved against what is true at that
 * moment, a change after approval is reported when the send is recorded (and
 * the send is still recorded), and a number reported as wrong stops being used
 * until an administrator clears it with a note.
 *
 * Synthetic numbers in the unroutable 90000 block; nothing is sent by the app
 * — opening WhatsApp is a link the test never follows.
 */

test.describe.configure({ mode: "serial" });

const APPROVED = "9000000771";
const FLAGGED = "9000000772";

async function cleanup() {
  await db().from("message_sends").delete().in("to_phone", [APPROVED, FLAGGED]);
  await db().from("parent_route_flags").delete().in("phone", [APPROVED, FLAGGED]);
}

test.beforeAll(cleanup);
test.afterAll(cleanup);

async function asAccount(browser: Browser, key: string, next: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, key, next);
  return { context, page };
}

async function queueParentMessage(page: Page, phone: string) {
  const { data: template } = await db().from("message_templates").select("id").eq("code", "vppsone_parent_notice").single();
  const form = page.locator("form").filter({ has: page.locator("#q-template") });
  await page.locator("#q-template").selectOption(template!.id);
  await page.locator("#q-phone").fill(phone);
  await page.locator("#q-name").fill("QA Guardian");
  await page.locator("#q-var-0").fill("QA Child");
  await page.locator("#q-var-1").fill("A synthetic notice");
  await form.locator('button[type="submit"]').click();
  await expect.poll(async () => {
    const { data } = await db().from("message_sends").select("id").eq("to_phone", phone);
    return (data ?? []).length;
  }, { timeout: 30_000 }).toBe(1);
  await page.reload();
  const { data } = await db().from("message_sends").select("id, snapshot, category").eq("to_phone", phone).single();
  return data as { id: string; snapshot: Record<string, unknown> | null; category: string };
}

test("an approval is checked again when the send is recorded, and the send is kept", async ({ browser }) => {
  test.setTimeout(180_000);
  const office = await asAccount(browser, "office", "/collection/messages");

  const send = await queueParentMessage(office.page, APPROVED);
  expect(send.snapshot, "a parent message keeps what it rests on").not.toBeNull();
  expect(send.category).toBe("general");

  const card = office.page.locator(`[data-parent-send="${send.id}"]`);
  await card.getByRole("button", { name: /Approve and open WhatsApp|स्वीकृत करें और व्हाट्सएप खोलें/ }).click();
  await expect(card.getByRole("link", { name: /Open WhatsApp again|व्हाट्सएप फिर खोलें/ })).toHaveAttribute(
    "href",
    new RegExp(`^https://wa\\.me/91${APPROVED}\\?text=`),
  );
  const { data: approved } = await db().from("message_sends").select("approved_at").eq("id", send.id).single();
  expect(approved!.approved_at).not.toBeNull();

  // Between approving and saying it was sent, an administrator changes the policy.
  const admin = await asAccount(browser, "admin", "/collection/policy");
  await admin.page.locator('[data-policy="general"]').getByRole("button", { name: /^(Save|सहेजें)$/ }).click();
  await expect(admin.page.getByText(/Policy saved|नियम सहेजा गया/).first()).toBeVisible({ timeout: 30_000 });
  await admin.context.close();

  await card.getByRole("button", { name: /^(I sent it|मैंने भेज दिया)$/ }).click();
  await expect(office.page.getByText(/Recorded as sent — but this had changed|भेजा गया दर्ज हुआ — पर/).first()).toBeVisible({
    timeout: 30_000,
  });
  const { data: sent } = await db().from("message_sends").select("status, stale_reason").eq("id", send.id).single();
  expect(sent).toMatchObject({ status: "sent", stale_reason: "policy_changed" });

  // Still said after a reload: the correction is owed until somebody sends it.
  await office.page.reload();
  await expect(office.page.locator(`[data-stale-reasons="${send.id}"]`)).toContainText(
    /The parent message policy has changed|अभिभावक संदेश का नियम बदल गया है/,
  );
  await office.context.close();
});

test("a wrong number withdraws what is waiting and is cleared only by an administrator with a note", async ({ browser }) => {
  test.setTimeout(180_000);
  const office = await asAccount(browser, "office", "/collection/messages");
  const send = await queueParentMessage(office.page, FLAGGED);

  const row = office.page.locator("li").filter({ has: office.page.locator(`[data-parent-send="${send.id}"]`) });
  await row.getByRole("button", { name: /^(Wrong number|नंबर गलत है)$/ }).click();
  await row.locator("textarea[name=reason]").fill("Belongs to somebody else");
  await row.getByRole("button", { name: /Report it and stop sending to it|गलत बताएँ और भेजना रोकें/ }).click();
  // What the office is left looking at is the row, not a toast: withdrawn, in
  // their language, and the number at the top of the page as flagged.
  await expect(office.page.locator(`[data-withdrawn="${send.id}"]`)).toHaveText(
    /Withdrawn — this number was reported as wrong|वापस लिया गया — यह नंबर गलत बताया गया है/,
    { timeout: 30_000 },
  );

  const { data: withdrawn } = await db().from("message_sends").select("status, stale_reason").eq("id", send.id).single();
  expect(withdrawn).toMatchObject({ status: "cancelled", stale_reason: "route_flagged" });
  const { data: flags } = await db().from("parent_route_flags").select("id, cleared_at").eq("phone", FLAGGED);
  expect(flags ?? []).toHaveLength(1);

  // The office sees the flag but cannot clear it.
  await office.page.reload();
  await expect(office.page.locator("[data-route-flags]")).toContainText(FLAGGED);
  await expect(office.page.getByRole("button", { name: /Checked — clear it|जाँच ली — हटाएँ/ })).toHaveCount(0);

  // And a new message to that number is refused at the door, not queued to
  // be caught later.
  const { data: template } = await db().from("message_templates").select("id").eq("code", "vppsone_parent_notice").single();
  await office.page.locator("#q-template").selectOption(template!.id);
  await office.page.locator("#q-phone").fill(FLAGGED);
  await office.page.locator("#q-name").fill("QA Guardian");
  await office.page.locator("#q-var-0").fill("QA Child");
  await office.page.locator("#q-var-1").fill("A second synthetic notice");
  await office.page.locator("form").filter({ has: office.page.locator("#q-template") }).locator('button[type="submit"]').click();
  await expect(
    office.page.getByText(/Nothing goes to it until an administrator has checked it|प्रशासक के जाँचने तक इस पर संदेश नहीं जाएगा/),
  ).toBeVisible({ timeout: 30_000 });
  const { data: afterRefusal } = await db().from("message_sends").select("id").eq("to_phone", FLAGGED);
  expect(afterRefusal ?? []).toHaveLength(1);
  await office.context.close();

  const admin = await asAccount(browser, "admin", "/collection/messages");
  const flagCard = admin.page.locator("[data-route-flags] li").filter({ hasText: FLAGGED });
  await flagCard.locator('input[name="note"]').fill("Checked with the class teacher");
  await flagCard.getByRole("button", { name: /Checked — clear it|जाँच ली — हटाएँ/ }).click();
  await expect.poll(async () => {
    const { data } = await db().from("parent_route_flags").select("cleared_at, clear_note").eq("phone", FLAGGED).single();
    return data?.clear_note ?? null;
  }, { timeout: 30_000 }).toBe("Checked with the class teacher");
  await admin.context.close();
});
