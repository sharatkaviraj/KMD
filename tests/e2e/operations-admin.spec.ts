import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page, type Response } from "@playwright/test";
import { db, ownClassOf, signIn } from "./support/harness";
import { interruptOneAdminResponse } from "./support/admin-response-interruption";

const runUuid = randomUUID();
let runTag = `phoneops-20261011-admin-followup-${runUuid.slice(0, 8)}`;
const studentId = "0c9f719c-7c5e-4cf4-a621-bce758236697";
const classId = "745643d0-aaca-470f-9372-d87397770a77";
const fields: string[] = [];
const requests: string[] = [];
const ledger: Record<string, unknown>[] = [];
let ledgerPath = path.resolve(`../evidence/admin-ledger-${runTag}.json`);
let wroteLedger = false;
function record(entry: Record<string, unknown>) {
  if (!wroteLedger && existsSync(ledgerPath)) throw new Error("Refusing to replace an existing admin ledger");
  mkdirSync(path.dirname(ledgerPath), { recursive: true });
  ledger.push({ at: new Date().toISOString(), ...entry });
  writeFileSync(ledgerPath, JSON.stringify({ runTag, target: "wtgxcptmucjerhufzjcf", studentId, classId, entries: ledger }, null, 2));
  wroteLedger = true;
}
function checked(error: { message: string } | null) { if (error) throw new Error(error.message); }
async function login(page: Page, actor: string) {
  let authStatus = 0;
  const onResponse = (response: Response) => { if (new URL(response.url()).pathname === "/auth/confirm") authStatus = response.status(); };
  page.on("response", onResponse);
  try {
    await signIn(page, actor, "/collection/review");
    if (authStatus < 200 || authStatus >= 400) throw new Error("Authentication did not succeed");
    await page.waitForURL(url => url.pathname === "/collection/review" || (actor === "teacher" && url.pathname === "/access-denied" && url.searchParams.get("permission") === "collection:view"), { timeout: 90_000 });
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 90_000 });
    record({ action: "auth-route-settled", actor, authStatus, path: new URL(page.url()).pathname, headings: await page.locator("h1").count() });
  } catch { throw new Error(`Existing QA ${actor} authentication/review route did not settle (HTTP ${authStatus || "unknown"}, path ${new URL(page.url()).pathname}); token URL withheld`); }
  finally { page.off("response", onResponse); }
}

test("admin selected decisions, cached reviewer, conflict and interrupted response persist safely on phone", async ({ browser }, testInfo) => {
  test.skip(process.env.OPS_ADMIN_RUN_MUTATIONS !== "1", "Explicit lane opt-in required; retained DEV fixture cleanup approval is pending");
  test.setTimeout(900_000);
  if (process.env.OPS_ADMIN_PRESERVE_FIXTURES === "0") throw new Error("Admin follow-up cannot delete retained audit fixtures; pending cleanup approval is separate");
  const baseURL = process.env.OPS_ADMIN_ORIGIN ?? "http://localhost:3100";
  const origin = new URL(baseURL);
  if (origin.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error("Admin follow-up requires the coordinator-owned local DEV server");
  const contexts: BrowserContext[] = [];
  try {
    const width = testInfo.project.use.viewport?.width ?? 390;
    expect([360, 390]).toContain(width);
    const resumePath = width === 360 && process.env.OPS_ADMIN_RESUME_LEDGER ? path.resolve(process.env.OPS_ADMIN_RESUME_LEDGER) : null;
    if (resumePath) {
      const evidenceRoot = path.resolve("../evidence") + path.sep;
      if (!resumePath.startsWith(evidenceRoot) || !path.basename(resumePath).startsWith("admin-ledger-phoneops-20261011-admin-followup-")) throw new Error("Resume requires this lane's retained follow-up ledger");
      const prior = JSON.parse(readFileSync(resumePath, "utf8")) as { runTag: string; target: string; studentId: string; classId: string; entries: { action: string; table: string; key: string }[] };
      expect(prior.target).toBe("wtgxcptmucjerhufzjcf"); expect(prior.studentId).toBe(studentId); expect(prior.classId).toBe(classId);
      expect(prior.runTag).toMatch(/^phoneops-20261011-admin-followup-[a-f0-9]{8}$/);
      runTag = prior.runTag;
      ledgerPath = path.resolve(`../evidence/admin-resume-ledger-${runTag}-${runUuid.slice(0, 8)}.json`);
      fields.push(...prior.entries.filter(e => e.action === "fixture-create" && e.table === "collection_fields").map(e => e.key));
      requests.push(...prior.entries.filter(e => e.action === "fixture-create" && e.table === "collection_requests").map(e => e.key));
      expect(fields).toHaveLength(3); expect(requests).toHaveLength(2);
    }
    const owned = await ownClassOf("teacher");
    expect(owned.classId).toBe(classId);
    expect(owned.sessionLabel).toBe("2026-27");
    const enrolment = await db().from("enrolments").select("student_id").eq("student_id", studentId).eq("class_id", classId).eq("session_label", owned.sessionLabel).eq("status", "enrolled").single();
    checked(enrolment.error);
    record({ action: "preflight", table: "enrolments", key: studentId, before: enrolment.data, after: "Existing QA assigned child confirmed; ordinary records untouched" });
    for (const suffix of resumePath ? [] : ["A", "B", "C"]) {
      // Database keys allow at most 41 characters; full audit tags stay in labels.
      const fieldKey = `qa_ops_${runUuid.replaceAll("-", "").slice(0, 16)}_${suffix.toLowerCase()}`;
      expect(fieldKey).toMatch(/^[a-z][a-z0-9_]{1,40}$/);
      const created = await db().from("collection_fields").insert({ key: fieldKey, label_hi: `${runTag} ${suffix}`, label_en: `${runTag} ${suffix}`, input_type: "text", is_active: false }).select("id,key,is_active").single();
      checked(created.error); fields.push(created.data!.id);
      record({ action: "fixture-create", table: "collection_fields", key: created.data!.id, before: null, after: created.data });
    }
    for (const suffix of resumePath ? [] : ["current", "older"]) {
      const created = await db().from("collection_requests").insert({ session_label: owned.sessionLabel, title_hi: `${runTag} ${suffix}`, title_en: `${runTag} ${suffix}`, class_id: classId, class_label: "QA admin assigned class", audience_kind: "class", audience_label: "QA admin assigned class", token: `OPSADMIN${randomUUID().replaceAll("-", "")}`, status: "open", opened_at: new Date().toISOString(), assigned_staff_id: owned.staffProfileId }).select("id").single();
      checked(created.error); requests.push(created.data!.id);
      record({ action: "fixture-create", table: "collection_requests", key: created.data!.id, before: null, after: { title: `${runTag} ${suffix}`, classId, session: owned.sessionLabel } });
    }
    const old = ["old-a", "old-b", "old-c"].map(value => `${runTag}-${value}`);
    const incoming = ["new-a", "new-b", "new-c"].map(value => `${runTag}-${value}`);
    const corrected = `${runTag}-office-correction`;
    const seededRecords = fields.map((field_id, index) => ({ session_label: owned.sessionLabel, student_id: studentId, field_id, value: index === 2 ? corrected : old[index], source: "office" }));
    if (!resumePath) {
      checked((await db().from("student_records").insert(seededRecords)).error);
      record({ action: "fixture-create", table: "student_records", key: fields, before: null, after: seededRecords });
    }
    const pending = resumePath
      ? await db().from("collection_submissions").select("id,field_id,status,previous_value,value,student_id").eq("request_id", requests[0])
      : await db().from("collection_submissions").insert(fields.map((field_id, index) => ({ request_id: requests[0], student_id: studentId, field_id, previous_value: old[index], value: incoming[index], status: "pending", submitted_at: new Date().toISOString() }))).select("id,field_id,status");
    checked(pending.error);
    const olderValue = `${runTag}-older-c`;
    const older = resumePath
      ? await db().from("collection_submissions").select("id,field_id,status,previous_value,value,student_id").eq("request_id", requests[1]).single()
      : await db().from("collection_submissions").insert({ request_id: requests[1], student_id: studentId, field_id: fields[2], previous_value: old[2], value: olderValue, status: "pending", submitted_at: new Date(Date.now() - 86_400_000).toISOString() }).select("id").single();
    checked(older.error);
    if (resumePath) {
      const [fieldRows, requestRows, recordRows, historyRows] = await Promise.all([
        db().from("collection_fields").select("id,label_en,is_active").in("id", fields),
        db().from("collection_requests").select("id,class_id,session_label,title_en").in("id", requests),
        db().from("student_records").select("field_id,value,source").eq("student_id", studentId).in("field_id", fields),
        db().from("student_record_history").select("id").eq("student_id", studentId).in("field_id", fields),
      ]);
      for (const result of [fieldRows, requestRows, recordRows, historyRows]) checked(result.error);
      expect(fieldRows.data).toHaveLength(3); expect(requestRows.data).toHaveLength(2); expect(recordRows.data).toHaveLength(3); expect(historyRows.data).toHaveLength(0);
      for (const [i, field] of fields.entries()) {
        expect(fieldRows.data!.find(row => row.id === field)).toMatchObject({ label_en: `${runTag} ${["A", "B", "C"][i]}`, is_active: false });
        expect(recordRows.data!.find(row => row.field_id === field)).toMatchObject({ value: seededRecords[i].value, source: "office" });
        expect(pending.data!.find(row => row.field_id === field)).toMatchObject({ status: "pending", previous_value: old[i], value: incoming[i], student_id: studentId });
      }
      expect(pending.data).toHaveLength(3);
      expect(older.data).toMatchObject({ field_id: fields[2], status: "pending", previous_value: old[2], value: olderValue, student_id: studentId });
      for (const [i, request] of requests.entries()) expect(requestRows.data!.find(row => row.id === request)).toMatchObject({ class_id: classId, session_label: owned.sessionLabel, title_en: `${runTag} ${["current", "older"][i]}` });
      record({ action: "resume-preflight", before: { fields: fieldRows.data, requests: requestRows.data, records: recordRows.data, pending: pending.data, older: older.data, history: historyRows.data }, after: "No reseeding or terminal replay; only untouched exact fixture proceeds" });
    } else record({ action: "fixture-create", table: "collection_submissions", key: pending.data!.map(row => row.id).concat(older.data!.id), before: null, after: "Four tagged pending answers; C is stale and its older answer superseded" });
    const mobile = { baseURL, viewport: { width, height: width === 360 ? 800 : 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" as const };
    const admin = await browser.newContext(mobile); contexts.push(admin);
    const reviewer = await browser.newContext({ ...mobile, viewport: { width: 360, height: 800 } }); contexts.push(reviewer);
    const teacher = await browser.newContext(mobile); contexts.push(teacher);
    const page = await admin.newPage(); const cached = await reviewer.newPage(); const limited = await teacher.newPage();
    await login(page, "admin");
    await login(cached, "admin");
    await login(limited, "teacher");
    record({ action: "phone-contexts", actual: { width, hasTouch: true, isMobile: true, physical: false }, ledgerPath });
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
    // Cache only this new fixture's C command for a supported stale-reviewer
    // retry; no command from the retained original run is reused.
    await cached.reload();
    const cachedC = cached.locator("li").filter({ hasText: incoming[2] }).filter({ has: cached.locator("form") });
    await expect(cachedC.getByRole("button", { name: /Accept and replace|नया मान/ })).toBeVisible();
    const interruption = await interruptOneAdminResponse(page);
    await currentC.getByRole("button", { name: /Accept and replace|नया मान/ }).tap();
    const interruptionEvidence = await interruption.finish();
    expect(interruptionEvidence).toMatchObject({ forwarded: 1, aborted: 1 });
    expect(interruptionEvidence.browserFailure).toMatch(/failed/i);
    record({ action: "response-interruption-settled", actual: interruptionEvidence, expected: "One forward; its browser response genuinely failed before reload" });
    await expect.poll(async () => (await readRecords()).find(row => row.field_id === fields[2])?.value, { timeout: 45_000 }).toBe(incoming[2]);
    await page.reload();
    await expect(page.locator("li").filter({ hasText: incoming[2] }).filter({ has: page.locator("form") })).toHaveCount(0);
    const writesC = await db().from("student_record_history").select("id,outcome,old_value,new_value,old_source").eq("field_id", fields[2]).eq("outcome", "written"); checked(writesC.error);
    expect(writesC.data).toHaveLength(1);
    expect(writesC.data![0]).toMatchObject({ old_value: corrected, new_value: incoming[2], old_source: "office" });
    const submissionC = await db().from("collection_submissions").select("id,status,value").eq("id", pending.data!.find(row => row.field_id === fields[2])!.id).single(); checked(submissionC.error);
    expect(submissionC.data).toMatchObject({ status: "accepted", value: incoming[2] });
    record({ action: "explicit-replace-interrupted-response", table: "student_record_history", key: fields[2], before: corrected, after: writesC.data, expected: "Persisted once; reload removes decided row despite interrupted response" });
    const retryResponse = cached.waitForResponse(response => response.request().method() === "POST" && Boolean(response.request().headers()["next-action"]));
    await cachedC.getByRole("button", { name: /Accept and replace|नया मान/ }).tap();
    await retryResponse;
    await cached.reload();
    await expect(cached.locator("li").filter({ hasText: incoming[2] }).filter({ has: cached.locator("form") })).toHaveCount(0);
    const afterRetry = await db().from("student_record_history").select("id,outcome,old_value,new_value,old_source").eq("field_id", fields[2]).eq("outcome", "written"); checked(afterRetry.error);
    expect(afterRetry.data).toEqual(writesC.data);
    record({ action: "interrupted-command-stale-reviewer-retry", table: "student_record_history", key: fields[2], before: writesC.data, after: afterRetry.data, expected: "Same one audit ID/effect after supported stale form retry and reload" });
    const finalRecords = await readRecords();
    expect(finalRecords.find(row => row.field_id === fields[1])?.value).toBe(old[1]);
    const finalSubmissions = await db().from("collection_submissions").select("field_id,status").eq("request_id", requests[0]); checked(finalSubmissions.error);
    expect(Object.fromEntries(finalSubmissions.data!.map(row => [row.field_id, row.status]))).toEqual({ [fields[0]]: "accepted", [fields[1]]: "pending", [fields[2]]: "accepted" });
    const untouchedHistory = await db().from("student_record_history").select("id").eq("field_id", fields[1]); checked(untouchedHistory.error);
    expect(untouchedHistory.data).toHaveLength(0);
    const allWritten = await db().from("student_record_history").select("id,field_id,outcome").in("field_id", fields).eq("outcome", "written"); checked(allWritten.error);
    expect(allWritten.data!.map(row => row.id).sort()).toEqual([writesA.data![0].id, writesC.data![0].id].sort());
    record({ action: "final-invariants", table: "student_records", key: fields, after: finalRecords, expected: "A and C intentionally accepted once; B remains untouched" });
  } catch (error) {
    record({ action: "test-error", actual: (error instanceof Error ? error.message.slice(0, 1500) : String(error)).replace(/token_hash=[a-f0-9]+/gi, "token_hash=REDACTED") });
    throw error;
  } finally {
    // Teardown cannot trigger destructive cleanup or replace retained evidence.
    const closed = await Promise.allSettled(contexts.map(context => context.close()));
    for (const result of closed) if (result.status === "rejected") {
      record({ action: "browser-close-error", actual: "Browser context already disposed during failed test; exact tagged fixtures stay retained" });
    }
    record({ action: "cleanup-preserved", after: "Exact newly tagged fixtures retained; original ledger and pending cleanup approval untouched" });
  }
});
