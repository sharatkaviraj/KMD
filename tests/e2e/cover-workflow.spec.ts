import { expect, test, type Browser } from "@playwright/test";

import { currentSessionLabel, db, signIn } from "./support/harness";
import { qaAccount } from "../fixtures/qa-accounts";

/**
 * The first complete workflow of the plan pack (P3–P5), pressed in a browser
 * and checked in the rows.
 *
 * A coordinator saves one absence and gets one receipt; the duties exist and
 * are published in the same moment; she gives one duty to a second teacher by
 * hand; that teacher opens the duty — the page a WhatsApp link would open —
 * acknowledges it and then says she cannot cover; the coordinator brings the
 * absent teacher back and every future duty is cancelled.
 *
 * It runs on a school day weeks ahead, so every period is still open whatever
 * the clock says, and removes everything it made for that day afterwards.
 */

test.describe.configure({ mode: "serial" });

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** The first date at least three weeks out that falls on `weekday`. */
function weeksAhead(weekday: string): string {
  const target = WEEKDAYS.findIndex((name) => weekday.toLowerCase().startsWith(name.slice(0, 3)));
  const start = new Date(Date.now() + 330 * 60_000 + 21 * 86_400_000);
  const ahead = (target - start.getUTCDay() + 7) % 7;
  return new Date(start.getTime() + ahead * 86_400_000).toISOString().slice(0, 10);
}

let DAY = "";
let PERIOD = -1;
let sessionLabel = "";

async function profileIdOf(key: string): Promise<string> {
  const email = qaAccount(key).email;
  const { data: users } = await db().auth.admin.listUsers({ perPage: 1000 });
  const user = users.users.find((entry) => entry.email === email);
  const { data } = await db().from("staff_profiles").select("id").eq("user_id", user!.id).single();
  return data!.id;
}

async function cleanup() {
  const { data: duties } = await db().from("cover_duties").select("id").eq("day", DAY);
  const ids = (duties ?? []).map((row) => row.id);
  if (ids.length > 0) {
    const { data: notices } = await db().from("staff_notices").select("id").in("duty_id", ids);
    const noticeIds = (notices ?? []).map((row) => row.id);
    if (noticeIds.length > 0) {
      await db().from("staff_notice_attempts").delete().in("notice_id", noticeIds);
      await db().from("staff_notices").delete().in("id", noticeIds);
    }
    await db().from("cover_duties").update({ supersedes: null }).in("id", ids);
    await db().from("cover_duties").delete().in("id", ids);
  }
  await db().from("cover_commands").delete().eq("day", DAY);
  await db().from("cover_days").delete().eq("day", DAY);
  await db().from("teacher_absence_history").delete().eq("day", DAY);
  await db().from("teacher_absences").delete().eq("day", DAY);
}

/**
 * A day and period where the absent teacher has one ordinary lesson and the
 * second teacher is free — read from the published timetable, so the journey
 * does not depend on which weekday the fixtures happen to leave open.
 */
async function pickDayAndPeriod(away: string, helper: string): Promise<boolean> {
  const { data: version } = await db()
    .from("timetable_versions")
    .select("id")
    .eq("session_label", sessionLabel)
    .eq("status", "published")
    .single();
  const { data: slots } = await db()
    .from("timetable_slots")
    .select("day, period, staff_profile_id, parallel, shared")
    .eq("version_id", version!.id)
    .in("staff_profile_id", [away, helper]);
  for (const weekday of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) {
    const today = (slots ?? []).filter((slot) => slot.day === weekday);
    for (let period = 0; period < 8; period += 1) {
      const awayHere = today.filter((slot) => slot.staff_profile_id === away && slot.period === period);
      const helperHere = today.some((slot) => slot.staff_profile_id === helper && slot.period === period);
      if (awayHere.length === 1 && !awayHere[0].parallel && !awayHere[0].shared && !helperHere) {
        DAY = weeksAhead(weekday);
        PERIOD = period;
        return true;
      }
    }
  }
  return false;
}

test.beforeAll(async () => {
  sessionLabel = await currentSessionLabel();
});

test.afterAll(async () => {
  if (DAY) await cleanup();
});

async function asAccount(browser: Browser, key: string, next: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, key, next);
  return { context, page };
}

test("an absence, its cover, a hand-picked teacher's answer and the return", async ({ browser }) => {
  test.setTimeout(240_000);

  const away = await profileIdOf("teacher");
  const helper = await profileIdOf("teacher2");
  test.skip(!(await pickDayAndPeriod(away, helper)), "no period where the QA teacher teaches alone and the second is free");
  await cleanup();

  /* ------------------------------------------- 1. one save, one receipt */

  const { page, context } = await asAccount(browser, "academic", `/substitutions?day=${DAY}`);
  await page.locator("#absent-staff").selectOption(away);
  await page.getByRole("button", { name: /Save absence|अनुपस्थिति सहेजें/ }).click();

  await expect(page.getByRole("status").filter({ hasText: /Saved|सहेजा गया/ }).first()).toBeVisible({
    timeout: 60_000,
  });

  const { data: day } = await db().from("cover_days").select("revision").eq("day", DAY).single();
  const { data: live } = await db()
    .from("cover_duties")
    .select("id, need_key, period, status, covering_staff_id")
    .eq("day", DAY)
    .in("status", ["assigned", "needs_help"]);
  const { data: absence } = await db().from("teacher_absences").select("periods").eq("day", DAY).single();

  expect(day!.revision).toBe(1);
  expect(absence!.periods).toHaveLength(8);
  expect((live ?? []).length).toBeGreaterThan(0);
  for (const duty of live ?? []) {
    // Nobody covers a lesson while away, and nobody is in two rooms.
    expect(duty.covering_staff_id).not.toBe(away);
  }
  const booked = (live ?? []).filter((d) => d.covering_staff_id).map((d) => `${d.period}|${d.covering_staff_id}`);
  expect(new Set(booked).size).toBe(booked.length);

  /* -------------------- 2. give one duty to the second teacher by hand */

  // The planner may already have given it to her; choosing her by hand then
  // pins it in place. Either way it ends up hers, chosen and pinned.
  const target = (live ?? []).find((duty) => duty.period === PERIOD);
  expect(target, `a duty for period ${PERIOD + 1}`).toBeTruthy();

  const card = page.locator(`[data-duty="${target!.id}"]`);
  await card.locator("select[name=coveringStaffId]").selectOption(helper);
  await card.getByRole("button", { name: /^(Assign|इन्हें दें)$/ }).click();

  // The banner from the first save is still on screen, so wait on the row.
  const hers = async () => {
    const { data } = await db()
      .from("cover_duties")
      .select("id, status, covering_staff_id, source, pinned, revision")
      .eq("day", DAY)
      .eq("need_key", target!.need_key)
      .eq("status", "assigned")
      .maybeSingle();
    return data;
  };
  await expect
    .poll(hers, { timeout: 60_000, message: "the duty becomes hers, chosen by hand" })
    .toMatchObject({ covering_staff_id: helper, source: "manual", pinned: true });
  const mine = await hers();
  await expect(page.getByRole("status").filter({ hasText: /Saved|सहेजा गया/ }).first()).toBeVisible();
  await context.close();

  /* ------------------------- 3. she opens it, acknowledges, then declines */

  const teacher = await asAccount(browser, "teacher2", `/duty/${mine!.id}`);
  await expect(teacher.page.getByRole("heading", { name: /This cover is yours|यह व्यवस्था आपकी है/ })).toBeVisible();

  // Opening the page changes nothing.
  const { data: untouched } = await db().from("cover_duties").select("acknowledged_at").eq("id", mine!.id).single();
  expect(untouched!.acknowledged_at).toBeNull();

  await teacher.page.getByRole("button", { name: /Acknowledge|देख लिया/ }).click();
  await expect(teacher.page.getByText(/You have acknowledged|आपने देख लिया/).first()).toBeVisible();

  await teacher.page.getByRole("button", { name: /I cannot cover|नहीं ले सकता/ }).click();
  await teacher.page.locator("#cannot-cover-note").fill("synthetic test");
  await teacher.page.locator("form").filter({ has: teacher.page.locator("#cannot-cover-note") }).getByRole("button", { name: /I cannot cover|नहीं ले सकता/ }).click();
  await expect(teacher.page.getByText(/coordinator has been told|समन्वयक को बता दिया/).first()).toBeVisible();

  const { data: answered } = await db()
    .from("cover_duties")
    .select("status, covering_staff_id, acknowledged_at, cannot_cover_at")
    .eq("id", mine!.id)
    .single();
  expect(answered!.acknowledged_at).not.toBeNull();
  expect(answered!.cannot_cover_at).not.toBeNull();
  // Saying so does not free her: it is still hers until somebody reassigns it.
  expect(answered).toMatchObject({ status: "assigned", covering_staff_id: helper });
  const { data: escalations } = await db().from("staff_notices").select("id").eq("duty_id", mine!.id).eq("kind", "cover_escalation");
  expect((escalations ?? []).length).toBeGreaterThan(0);

  // A forwarded link is not a permission.
  const stranger = await asAccount(browser, "teacher", `/duty/${mine!.id}`);
  await expect(stranger.page.getByText(/not for your account|आपके खाते के लिए नहीं/)).toBeVisible();
  await stranger.context.close();
  await teacher.context.close();

  /* ----------------------------------------------- 4. she is back at school */

  const back = await asAccount(browser, "academic", `/substitutions?day=${DAY}`);
  await back.page.getByRole("button", { name: /Back at school|स्कूल में हैं/ }).first().click();
  await expect(back.page.getByRole("status").filter({ hasText: /Saved|सहेजा गया/ }).first()).toBeVisible({
    timeout: 60_000,
  });
  const stillLive = async () => {
    const { data } = await db().from("cover_duties").select("id").eq("day", DAY).in("status", ["assigned", "needs_help"]);
    return (data ?? []).length;
  };
  await expect.poll(stillLive, { timeout: 30_000 }).toBe(0);
  const { data: gone } = await db().from("teacher_absences").select("id").eq("day", DAY);
  expect(gone ?? []).toHaveLength(0);
  await back.context.close();
});
