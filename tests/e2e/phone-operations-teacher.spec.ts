import { expect, test, type Browser } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";

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
const emptyBaselines = new Set<string>();
const ledger: Array<Record<string, unknown>> = [];
const checkpoint = () => writeFileSync(path.resolve("../evidence/class-teacher-ledger.json"), JSON.stringify({ tag: "phoneops-20261011-teacher", database: "wtgxcptmucjerhufzjcf", layer: "DEV phone390 touch", entries: ledger }, null, 2));

async function register(day: string) {
  const { data, error } = await db()
    .from("attendance_registers")
    .select("id, revision, status, taken_by")
    .eq("session_label", sessionLabel)
    .eq("class_id", scene.classId)
    .eq("day", day)
    .is("period", null)
    .maybeSingle();
  expect(error, "register readback must not turn a DB error into an empty register").toBeNull();
  return data as { id: string; revision: number; status: string; taken_by: string | null } | null;
}

async function cleanup() {
  for (const day of days) {
    if (!emptyBaselines.has(day)) continue;
    const row = await register(day);
    if (!row) continue;
    ledger.push({ phase: "before-exact-owned-cleanup", day, registerId: row.id, revision: row.revision }); checkpoint();
    const corrections = await db().from("attendance_corrections").delete().eq("register_id", row.id); expect(corrections.error).toBeNull();
    const revisions = await db().from("attendance_register_revisions").delete().eq("register_id", row.id); expect(revisions.error).toBeNull();
    const removed = await db().from("attendance_registers").delete().eq("id", row.id); expect(removed.error).toBeNull();
    const marks = await db().from("attendance_marks").select("student_id").eq("register_id", row.id); expect(marks.error).toBeNull(); expect(marks.data).toEqual([]);
    ledger.push({ phase: "after-cleanup", day, registerId: row.id, remaining: await register(day) }); checkpoint();
  }
}

test.beforeAll(async () => {
  sessionLabel = await currentSessionLabel();
  scene = await ownClassOf("teacher");

  // Reserve older dates outside the other lanes' nearest-date fixtures.
  // Every selected register is proven absent before any phone UI action.
  days.push(...(await unrecordedSchoolDays(scene.classId, sessionLabel, 2, 28)));
  for (const day of days) { const before = await register(day); expect(before).toBeNull(); emptyBaselines.add(day); ledger.push({ phase: "baseline", day, classId: scene.classId, sessionLabel, register: before }); } checkpoint();
});

test.afterAll(async () => {
  if (process.env.PHONEOPS_PRESERVE_FIXTURES === "1") {
    for (const day of days) ledger.push({phase:"preserved-readback-no-cleanup",day,register:await register(day)});
    checkpoint();
    return;
  }
  await cleanup();
});

async function asAccount(browser: Browser, key: string, next: string) {
  const context = await browser.newContext({ baseURL: "http://localhost:3100", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(150_000);
  try { await signIn(page, key, next); }
  catch { await context.close(); throw new Error("QA teacher authentication or cold route could not complete; auth URL omitted from evidence."); }
  return { context, page };
}

async function assertNoQueuedMessages(registerId: string) {
  const queued = await db().from("parent_message_queue").select("id,status").eq("register_id", registerId);
  expect(queued.error).toBeNull(); expect(queued.data).toEqual([]);
}

async function disableParentAlerts(page: import("@playwright/test").Page) {
  const dialog = page.getByRole("dialog");
  const switches = dialog.getByRole("switch");
  if (await switches.count()) {
    if (await switches.getAttribute("aria-checked") === "true") await switches.tap();
    await expect(switches).toHaveAttribute("aria-checked", "false");
  }
}

test("the class teacher saves the whole roll, reloads it, and corrects it with a reason", async ({ browser }) => {
  test.setTimeout(180_000);
  const day = days[0];
  const { context, page } = await asAccount(browser, "teacher", `/teach/attendance?class=${scene.classId}&day=${day}`);
  try {
    const rows = page.locator("button.t-kid");
    await expect(rows.first()).toBeVisible();
    const count = await rows.count(); expect(count).toBeGreaterThan(2);
    expect(await register(day), "opening the register must not record it").toBeNull();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await rows.nth(0).tap();
    await expect(rows.nth(0)).toHaveClass(/\ba\b/);
    await rows.nth(1).tap(); await expect(rows.nth(1)).toHaveClass(/\ba\b/);
    await rows.nth(1).tap();
    await expect(rows.nth(1)).toHaveClass(/\bh\b/);
    expect(await register(day), "phone marking must remain local until review/save").toBeNull();
    await page.locator(".t-savebar button").tap();
    const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
    await disableParentAlerts(page);
    expect(await register(day), "opening review must not record it").toBeNull();
    await dialog.locator("button.pri").tap();
    await expect.poll(async () => (await register(day))?.revision, {timeout:90000}).toBe(1);
    await expect(page.locator(".t-savebar")).toHaveCount(0, {timeout:45000});
    const saved = await register(day); expect(saved).toMatchObject({revision:1,status:"submitted"});
    const marks = await db().from("attendance_marks").select("student_id,status").eq("register_id", saved!.id); expect(marks.error).toBeNull();
    expect(marks.data).toHaveLength(count);
    expect(marks.data!.filter(mark => mark.status === "absent")).toHaveLength(1);
    expect(marks.data!.filter(mark => mark.status === "half_day")).toHaveLength(1);
    await assertNoQueuedMessages(saved!.id);
    ledger.push({phase:"saved-readback", day, register:saved, marks:marks.data, parentQueue:[]});checkpoint();
    await page.reload();
    await expect(page.locator(".card .serif")).toBeVisible();
    await expect(page.locator(".t-savebar")).toHaveCount(0);
    const change = page.locator("main .card button.btn.big:visible"); await expect(change).toHaveCount(1); await change.tap();
    await rows.nth(0).tap(); await rows.nth(0).tap();
    await expect(rows.nth(0)).toHaveClass(/\bp\b/);
    await page.locator(".t-savebar button").tap();
    await expect(dialog).toBeVisible();
    // The supported correction flow starts with the explicit default reason Came late.
    const saveCorrection = dialog.locator("button.pri"); await expect(saveCorrection).toBeEnabled();
    await dialog.locator("button.chip").first().tap();
    await dialog.getByRole("textbox").fill("phoneops-20261011-teacher arrived after assembly");
    await disableParentAlerts(page);
    await expect(saveCorrection).toBeEnabled(); await saveCorrection.tap();
    await expect.poll(async () => (await register(day))?.revision, {timeout:90000}).toBe(2);
    await expect(page.locator(".t-savebar")).toHaveCount(0, {timeout:45000});
    const corrected = await register(day);
    const revisions = await db().from("attendance_register_revisions").select("revision,kind,reason").eq("register_id", corrected!.id).order("revision"); expect(revisions.error).toBeNull();
    expect(revisions.data).toHaveLength(2);
    expect(revisions.data![0]).toMatchObject({revision:1,kind:"save",reason:null});
    expect(revisions.data![1]).toMatchObject({revision:2,kind:"correction"});
    expect(revisions.data![1].reason).toContain("phoneops-20261011-teacher");
    const updated = await db().from("attendance_marks").select("status").eq("register_id", corrected!.id);expect(updated.error).toBeNull();
    expect(updated.data!.filter(mark => mark.status === "absent")).toHaveLength(0);
    expect(updated.data!.filter(mark => mark.status === "half_day")).toHaveLength(1);
    await assertNoQueuedMessages(corrected!.id);
    ledger.push({phase:"correction-readback",day,register:corrected,revisions:revisions.data,marks:updated.data,parentQueue:[]});checkpoint();
    await page.reload(); await expect(page.locator(".card .serif")).toBeVisible();
  } catch (error) {
    const banners=await page.locator('[role="alert"], [role="status"], .banner').allTextContents();
    ledger.push({phase:"save-failure-ui",day,register:await register(day),banners,dialogVisible:await page.getByRole("dialog").isVisible(),savebarCount:await page.locator(".t-savebar").count()});checkpoint();
    throw error;
  } finally {await context.close();}
});

test("a dropped save response reconciles once and survives phone reload", async ({ browser }) => {
  test.setTimeout(180_000);
  const day=days[1];
  const {context,page}=await asAccount(browser,"teacher",`/teach/attendance?class=${scene.classId}&day=${day}`);
  try {
    await expect(page.locator("button.t-kid").first()).toBeVisible();
    await page.locator(".t-savebar button").tap();
    const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();
    await disableParentAlerts(page);
    let lost=false;
    await page.route("**/teach/attendance**",async route => {
      if(!lost && route.request().method()==="POST" && route.request().headers()["next-action"]) {
        lost=true;await route.fetch();await route.abort("failed");return;
      }
      await route.continue();
    });
    await dialog.locator("button.pri").tap();
    await expect(page.locator(".t-savebar")).toHaveCount(0,{timeout:45000});
    expect(lost).toBe(true);
    const saved=await register(day);expect(saved).toMatchObject({revision:1,status:"submitted"});
    const revisions=await db().from("attendance_register_revisions").select("id,revision,kind").eq("register_id",saved!.id);expect(revisions.error).toBeNull();expect(revisions.data).toHaveLength(1);
    await assertNoQueuedMessages(saved!.id);
    ledger.push({phase:"uncertain-response-reconciled",day,register:saved,revisions:revisions.data,parentQueue:[]});checkpoint();
    await page.reload();await expect(page.locator(".card .serif")).toBeVisible();
    expect((await register(day))!.revision).toBe(1);
  } finally {await context.close();}
});

test("another teacher cannot edit this class and creates no revision",async({browser})=>{
  const day=days[0];const before=await register(day);
  const {context,page}=await asAccount(browser,"teacher2",`/teach/attendance?class=${scene.classId}&day=${day}`);
  try {
    await expect(page.locator(".t-savebar")).toHaveCount(0);
    const buttons=page.locator("button.t-kid");
    for(let index=0;index<await buttons.count();index++) await expect(buttons.nth(index)).toBeDisabled();
    await expect(page.locator("main .card button.btn.big:visible")).toHaveCount(0);
    const after=await register(day);expect(after).toEqual(before);
    ledger.push({phase:"other-teacher-no-pen",day,before,after,path:new URL(page.url()).pathname});checkpoint();
  } finally {await context.close();}
});
