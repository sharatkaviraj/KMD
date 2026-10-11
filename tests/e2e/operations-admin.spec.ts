import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { db, ownClassOf, signIn } from "./support/harness";

const runTag = `phoneops-20261011-admin-${randomUUID().slice(0, 8)}`;
const studentId = "0c9f719c-7c5e-4cf4-a621-bce758236697";
const classId = "745643d0-aaca-470f-9372-d87397770a77";
const fields: string[] = [];
const requests: string[] = [];
const ledger: Record<string, unknown>[] = [];
const ledgerPath = "../evidence/admin-ledger.json";
function record(entry: Record<string, unknown>) {
  ledger.push({ at: new Date().toISOString(), ...entry });
  writeFileSync(ledgerPath, JSON.stringify({ runTag, target: "wtgxcptmucjerhufzjcf", studentId, classId, entries: ledger }, null, 2));
}
function checked(error: { message: string } | null) { if (error) throw new Error(error.message); }
async function login(page: Page, actor: string) {
  try { await signIn(page, actor, "/collection/review"); }
  catch { throw new Error(`Existing QA ${actor} sign-in could not reach or authenticate the local DEV review page`); }
}

test("admin selected decisions, cached reviewer, conflict and interrupted response persist safely on phone", async ({ browser }) => {
  test.skip(process.env.OPS_ADMIN_RUN_MUTATIONS !== "1", "Explicit lane opt-in required; retained DEV fixture cleanup approval is pending");
  test.setTimeout(900_000);
  const contexts: BrowserContext[] = [];
  try {
    const owned = await ownClassOf("teacher");
    expect(owned.classId).toBe(classId);
    expect(owned.sessionLabel).toBe("2026-27");
    const enrolment = await db().from("enrolments").select("student_id").eq("student_id", studentId).eq("class_id", classId).eq("session_label", owned.sessionLabel).eq("status", "enrolled").single();
    checked(enrolment.error);
    record({ action: "preflight", table: "enrolments", key: studentId, before: enrolment.data, after: "Existing QA assigned child confirmed; ordinary records untouched" });
    for (const suffix of ["A", "B", "C"]) {
      const created = await db().from("collection_fields").insert({ key: `qa_${runTag.replaceAll("-", "_")}_${suffix.toLowerCase()}`, label_hi: `${runTag} ${suffix}`, label_en: `${runTag} ${suffix}`, input_type: "text", is_active: false }).select("id,key,is_active").single();
      checked(created.error); fields.push(created.data!.id);
      record({ action: "fixture-create", table: "collection_fields", key: created.data!.id, before: null, after: created.data });
    }
    for (const suffix of ["current", "older"]) {
      const created = await db().from("collection_requests").insert({ session_label: owned.sessionLabel, title_hi: `${runTag} ${suffix}`, title_en: `${runTag} ${suffix}`, class_id: classId, class_label: "QA admin assigned class", audience_kind: "class", audience_label: "QA admin assigned class", token: `OPSADMIN${randomUUID().replaceAll("-", "")}`, status: "open", opened_at: new Date().toISOString(), assigned_staff_id: owned.staffProfileId }).select("id").single();
      checked(created.error); requests.push(created.data!.id);
      record({ action: "fixture-create", table: "collection_requests", key: created.data!.id, before: null, after: { title: `${runTag} ${suffix}`, classId, session: owned.sessionLabel } });
    }
    const old = ["old-a", "old-b", "old-c"].map(value => `${runTag}-${value}`);
    const incoming = ["new-a", "new-b", "new-c"].map(value => `${runTag}-${value}`);
    const corrected = `${runTag}-office-correction`;
    const seededRecords = fields.map((field_id, index) => ({ session_label: owned.sessionLabel, student_id: studentId, field_id, value: index === 2 ? corrected : old[index], source: "office" }));
    checked((await db().from("student_records").insert(seededRecords)).error);
    record({ action: "fixture-create", table: "student_records", key: fields, before: null, after: seededRecords });
    const pending = await db().from("collection_submissions").insert(fields.map((field_id, index) => ({ request_id: requests[0], student_id: studentId, field_id, previous_value: old[index], value: incoming[index], status: "pending", submitted_at: new Date().toISOString() }))).select("id,field_id,status");
    checked(pending.error);
    const olderValue = `${runTag}-older-c`;
    const older = await db().from("collection_submissions").insert({ request_id: requests[1], student_id: studentId, field_id: fields[2], previous_value: old[2], value: olderValue, status: "pending", submitted_at: new Date(Date.now() - 86_400_000).toISOString() }).select("id").single();
    checked(older.error);
    record({ action: "fixture-create", table: "collection_submissions", key: pending.data!.map(row => row.id).concat(older.data!.id), before: null, after: "Four tagged pending answers; C is stale and its older answer superseded" });

    const mobile = { baseURL: "http://localhost:3100", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
    const admin = await browser.newContext(mobile); contexts.push(admin);
    const reviewer = await browser.newContext({ ...mobile, viewport: { width: 360, height: 800 } }); contexts.push(reviewer);
    const teacher = await browser.newContext(mobile); contexts.push(teacher);
    const page = await admin.newPage(); const cached = await reviewer.newPage(); const limited = await teacher.newPage();
    await login(page, "admin");
    await login(cached, "admin");
    await login(limited, "teacher");
    await expect(limited.locator("[data-bulk-decide] button[type=submit]")).toHaveCount(0);
    record({ action: "role-check", role: "teacher", actual: { path: new URL(limited.url()).pathname, decisionControls: 0 }, expected: "No administrative decision controls" });

    const bulk = page.locator("[data-bulk-decide]");
    await expect(bulk).toBeVisible();
    const a = bulk.locator("li").filter({ hasText: incoming[0] });
    const b = bulk.locator("li").filter({ hasText: incoming[1] });
    await expect(a.locator("input[type=checkbox]")).not.toBeChecked();
    await expect(b.locator("input[type=checkbox]")).not.toBeChecked();
    await expect(bulk.locator("li").filter({ hasText: incoming[2] }).locator("input[type=checkbox]")).toHaveCount(0);
    await a.locator("label").tap();
    const aId = pending.data!.find(row => row.field_id === fields[0])!.id;
    await expect(bulk.locator('input[name="submissionIds"]')).toHaveCount(1);
    await expect(bulk.locator('input[name="submissionIds"]')).toHaveValue(aId);
    await bulk.locator('button[type="submit"][value="true"]').tap();
    await expect.poll(async () => {
      const result = await db().from("collection_submissions").select("field_id,status").eq("request_id", requests[0]).order("field_id"); checked(result.error); return Object.fromEntries(result.data!.map(row => [row.field_id, row.status]));
    }, { timeout: 45_000 }).toMatchObject({ [fields[0]]: "accepted", [fields[1]]: "pending", [fields[2]]: "pending" });
    const readRecords = async () => { const result = await db().from("student_records").select("field_id,value,source").in("field_id", fields); checked(result.error); return result.data!; };
    const afterBulk = await readRecords();
    expect(afterBulk.find(row => row.field_id === fields[0])).toMatchObject({ value: incoming[0], source: "teacher" });
    expect(afterBulk.find(row => row.field_id === fields[1])).toMatchObject({ value: old[1], source: "office" });
    record({ action: "selected-bulk-accept", table: "student_records", key: fields, before: seededRecords, after: afterBulk, expected: "Only A changes; unchecked B and conflict C remain pending" });

    const cachedA = cached.locator("li").filter({ hasText: incoming[0] }).filter({ has: cached.locator("form") });
    const cachedDecisionResponse = cached.waitForResponse(response => response.request().method() === "POST" && Boolean(response.request().headers()["next-action"]));
    await cachedA.getByRole("button", { name: /^(Accept|स्वीकार करें)$/ }).tap();
    await cachedDecisionResponse;
    const writesA = await db().from("student_record_history").select("id,old_value,new_value,outcome").eq("field_id", fields[0]).eq("outcome", "written"); checked(writesA.error);
    expect(writesA.data).toHaveLength(1);
    record({ action: "cached-second-reviewer", table: "student_record_history", key: fields[0], before: "A already accepted by selected action", after: writesA.data, expected: "One written effect despite stale cached decision" });

    await page.reload();
    const oldC = page.locator("li").filter({ hasText: olderValue }).filter({ has: page.locator("form") });
    await expect(oldC.getByRole("button", { name: /^(Accept|स्वीकार करें)$/ })).toHaveCount(0);
    await expect(oldC.getByRole("button", { name: /Accept and replace|नया मान/ })).toHaveCount(0);
    await oldC.getByRole("button", { name: /^(Reject|अस्वीकार करें)$/ }).tap();
    await expect.poll(async () => (await db().from("collection_submissions").select("status").eq("id", older.data!.id).single()).data?.status, { timeout: 45_000 }).toBe("rejected");
    await page.reload();
    const currentC = page.locator("li").filter({ hasText: incoming[2] }).filter({ has: page.locator("form") });
    await expect(currentC.getByRole("button", { name: /^(Accept|स्वीकार करें)$/ })).toHaveCount(0);
    let interrupted = false;
    let finishInterruption = () => {};
    const interruptionFinished = new Promise<void>(resolve => { finishInterruption = resolve; });
    await page.route("**/collection/review", async route => {
      if (!interrupted && route.request().method() === "POST" && route.request().headers()["next-action"]) {
        interrupted = true;
        try { await route.fetch(); await route.abort("failed"); }
        finally { finishInterruption(); }
      } else await route.continue();
    });
    await currentC.getByRole("button", { name: /Accept and replace|नया मान/ }).tap();
    // Finish the fault injection before unroute/reload can dispose its request.
    await interruptionFinished;
    await expect.poll(async () => (await readRecords()).find(row => row.field_id === fields[2])?.value, { timeout: 45_000 }).toBe(incoming[2]);
    await page.unroute("**/collection/review");
    await page.reload();
    await expect(page.locator("li").filter({ hasText: incoming[2] }).filter({ has: page.locator("form") })).toHaveCount(0);
    const writesC = await db().from("student_record_history").select("id,outcome,old_value,new_value,old_source").eq("field_id", fields[2]).eq("outcome", "written"); checked(writesC.error);
    expect(writesC.data).toHaveLength(1);
    expect(writesC.data![0]).toMatchObject({ old_value: corrected, new_value: incoming[2], old_source: "office" });
    expect(interrupted).toBe(true);
    record({ action: "explicit-replace-interrupted-response", table: "student_record_history", key: fields[2], before: corrected, after: writesC.data, expected: "Persisted once; reload removes decided row despite interrupted response" });
    const finalRecords = await readRecords();
    expect(finalRecords.find(row => row.field_id === fields[1])?.value).toBe(old[1]);
    record({ action: "final-invariants", table: "student_records", key: fields, after: finalRecords, expected: "A and C intentionally accepted once; B remains untouched" });
  } catch (error) {
    record({ action: "test-error", actual: (error instanceof Error ? error.message.slice(0, 1500) : String(error)).replace(/token_hash=[a-f0-9]+/gi, "token_hash=REDACTED") });
    throw error;
  } finally {
    // Browser teardown errors must never prevent exact-ID fixture cleanup.
    const closed = await Promise.allSettled(contexts.map(context => context.close()));
    for (const result of closed) if (result.status === "rejected") {
      record({ action: "browser-close-error", actual: "Browser context already disposed during failed test; exact-ID cleanup continues" });
    }
    if (process.env.OPS_ADMIN_PRESERVE_FIXTURES !== "0") {
      record({ action: "cleanup-preserved", after: "Exact tagged fixtures retained; destructive cleanup requires its pending approval to resolve before this option may be disabled" });
    } else {
    for (const table of ["student_record_history", "student_records"] as const) if (fields.length) {
      const result = await db().from(table).delete().in("field_id", fields); checked(result.error);
      record({ action: "cleanup", table, key: fields, after: "Tagged rows deleted" });
    }
    if (requests.length) { const result = await db().from("collection_requests").delete().in("id", requests); checked(result.error); record({ action: "cleanup", table: "collection_requests", key: requests, after: "Requests and cascading submissions deleted" }); }
    if (fields.length) { const result = await db().from("collection_fields").delete().in("id", fields); checked(result.error); record({ action: "cleanup", table: "collection_fields", key: fields, after: "Inactive fields deleted" }); }
    for (const table of ["collection_fields", "student_records", "student_record_history"] as const) if (fields.length) {
      const result = await db().from(table).select("id", { count: "exact", head: true }).in(table === "collection_fields" ? "id" : "field_id", fields); checked(result.error); expect(result.count).toBe(0);
    }
    for (const table of ["collection_requests", "collection_submissions"] as const) if (requests.length) {
      const result = await db().from(table).select("id", { count: "exact", head: true }).in(table === "collection_requests" ? "id" : "request_id", requests); checked(result.error); expect(result.count).toBe(0);
    }
    record({ action: "cleanup-verify", after: "Zero tagged fields, requests, submissions, student records and history remain" });
    }
  }
});
