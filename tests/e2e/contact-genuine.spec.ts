import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Request, type Route } from "@playwright/test";
import { db, currentSessionLabel, signIn } from "./support/harness";
import { contactCommand, type ContactCommand } from "../../src/vx/screens/family-contact/domain";

const studentId = "4f0d0fb5-1714-4dae-af33-998977941d08";
const owner = "1520b49a-5e25-4a53-8f3d-210a4d35fbeb";
const note = "OPS-CONTACT-20261012 genuine DEV interrupted response; synthetic conversation; no send";
const ledgerPath = path.resolve("../evidence/contact-genuine-20261012-ledger.json");
let outputLedgerPath = ledgerPath;
const entries: Record<string, unknown>[] = [];
const commands: ContactCommand[] = [];
function record(entry: Record<string, unknown>) {
  entries.push({ at: new Date().toISOString(), ...entry });
  mkdirSync(path.dirname(outputLedgerPath), { recursive: true });
  writeFileSync(outputLedgerPath, JSON.stringify({ projectRef: "wtgxcptmucjerhufzjcf", studentId, owner, note, priorLedger: outputLedgerPath === ledgerPath ? null : ledgerPath, commands, entries }, null, 2));
}
const checked = (error: { message: string } | null) => { if (error) throw Error(error.message); };
async function rows() {
  const result = await db().from("student_followups").select("id,created_by,session_label,student_id,kind,outcome,note,agreed_on,note_id,created_at").eq("student_id", studentId).eq("kind", "contact").eq("note", note).order("created_at");
  checked(result.error); return result.data ?? [];
}
test("390px genuine DEV lost response, reload readback, and deliberately separate identical contact", async ({ page, context }) => {
  test.skip(process.env.PHONEOPS_CONTACT_RUN !== "1", "Explicit DEV contact lane opt-in required");
  if (existsSync(ledgerPath)) {
    if (process.env.PHONEOPS_CONTACT_RESUME_ZERO_EFFECT !== "1") throw Error("Existing contact ledger: inspect retained UUIDs before any rerun; never replace or replay blindly");
    const prior = JSON.parse(readFileSync(ledgerPath, "utf8"));
    expect(prior).toMatchObject({ projectRef: "wtgxcptmucjerhufzjcf", studentId, owner, note, commands: [] });
    expect(prior.entries).toHaveLength(1); expect(prior.entries[0].action).toBe("preflight");
    outputLedgerPath = path.resolve(`../evidence/contact-genuine-20261012-resume-${randomUUID().slice(0, 8)}-ledger.json`);
    if (existsSync(outputLedgerPath)) throw Error("Refusing to replace resume ledger");
  }
  const origin = new URL(process.env.PHONEOPS_CONTACT_ORIGIN ?? "http://localhost:3201");
  if (origin.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(origin.hostname)) throw Error("Genuine contact acceptance requires the coordinator-owned local DEV server");
  const student = await db("public").from("students").select("id,admission_no,notes").eq("id", studentId).single(); checked(student.error);
  expect(student.data).toMatchObject({ admission_no: "OPS-SCHOOL-20261011-ACCOUNTANT", notes: "OPS-SCHOOL-20261011-ACCOUNTANT synthetic DEV phone test; no messaging or transfers" });
  const profile = await db().from("staff_profiles").select("id,user_id,role,is_active").eq("id", owner).single(); checked(profile.error);
  expect(profile.data).toMatchObject({ user_id: "3f64f814-5d57-4b1c-a860-725eb65efda7", role: "admin", is_active: true });
  const auth = await db().auth.admin.getUserById(profile.data!.user_id); checked(auth.error); expect(auth.data.user?.email).toBe("qa.admin@qa.vpps.local");
  const sessionLabel = await currentSessionLabel(); expect(sessionLabel).toBe("2026-27");
  expect(await rows()).toEqual([]);
  const noticeBefore = await db().from("staff_notices").select("id", { count: "exact", head: true }); checked(noticeBefore.error);
  record({ action: "preflight", student: student.data, staff: profile.data, sessionLabel, before: [], notices: noticeBefore.count });
  let forbidden = 0;
  const blockedPaths: { origin: string; path: string; method: string }[] = [];
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin.origin || (request.method() !== "GET" && !(request.method() === "POST" && url.pathname === `/students/${studentId}` && request.headers()["next-action"]))) { forbidden++; blockedPaths.push({ origin: url.origin, path: url.pathname, method: request.method() }); return route.abort(); }
    return route.continue();
  });
  const authResponses: { path: string; status: number }[] = [];
  const onAuthResponse = (response: import("@playwright/test").Response) => { const url = new URL(response.url()); if (["/auth/confirm", "/login"].includes(url.pathname)) authResponses.push({ path: url.pathname, status: response.status() }); };
  page.on("response", onAuthResponse);
  try { await signIn(page, "admin", `/students/${studentId}`); }
  catch { record({ action: "auth-failed-zero-contact-command", path: new URL(page.url()).pathname, authResponses, blockedPaths }); await page.goto("about:blank").catch(() => undefined); throw Error("Existing QA admin authentication did not settle; token URL withheld"); }
  finally { page.off("response", onAuthResponse); }
  await expect(page.getByRole("button", { name: "Log family contact", exact: true })).toBeVisible({ timeout: 120_000 });
  const key = `vx-contact:v1:${owner}:${sessionLabel}:${studentId}`;
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  let forwarded = 0, aborted = 0, serverStatus = 0, captured: Request | undefined;
  let settled!: (value: { error?: unknown }) => void, failed!: (value: string) => void;
  const terminal = new Promise<{ error?: unknown }>(resolve => { settled = resolve; });
  const browserFailure = new Promise<string>(resolve => { failed = resolve; });
  const onFailed = (request: Request) => { if (request === captured) failed(request.failure()?.errorText ?? "unknown"); };
  page.on("requestfailed", onFailed);
  const pattern = `**/students/${studentId}**`;
  const handler = async (route: Route) => {
    const request = route.request();
    if (captured || request.method() !== "POST" || !request.headers()["next-action"]) return route.continue();
    captured = request;
    try {
      const raw = await page.evaluate(key => localStorage.getItem(key), key);
      const original = contactCommand(raw ? JSON.parse(raw).payload : null);
      expect(original).toMatchObject({ owner, studentId, sessionLabel, outcome: "spoke", note });
      expect(request.postData()).toContain(original!.attemptId);
      const before = await db().from("student_followups").select("id").eq("id", original!.attemptId); checked(before.error); expect(before.data).toEqual([]);
      commands.push(original!); record({ action: "before-forward", command: original, before: [] });
      ++forwarded; const response = await route.fetch({ maxRetries: 0, maxRedirects: 0, timeout: 90_000 }); serverStatus = response.status();
      expect(serverStatus).toBe(200); expect(await rows()).toHaveLength(1);
      await route.abort("failed"); ++aborted; await response.dispose(); settled({});
    } catch (error) { settled({ error }); }
  };
  await page.route(pattern, handler);
  const compose = async () => {
    await page.getByRole("button", { name: "Log family contact", exact: true }).tap();
    const dialog = page.getByRole("dialog", { name: "Log family contact", exact: true });
    await dialog.getByRole("button", { name: "Spoke with family", exact: true }).tap(); await dialog.locator("textarea").fill(note); return dialog;
  };
  const first = await compose(); await first.getByRole("button", { name: "Save", exact: true }).tap();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { const outcome = await Promise.race([terminal, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Owned contact interruption did not settle")), 120_000); })]); if (outcome.error) throw outcome.error; } finally { if (timer) clearTimeout(timer); }
  let failureTimer: ReturnType<typeof setTimeout> | undefined;
  let failure: string;
  try { failure = await Promise.race([browserFailure, new Promise<never>((_, reject) => { failureTimer = setTimeout(() => reject(Error("Aborted contact request emitted no native browser failure within30s")), 30_000); })]); }
  finally { if (failureTimer) clearTimeout(failureTimer); }
  await page.unroute(pattern, handler); page.off("requestfailed", onFailed);
  record({ action: "committed-response-aborted", forwarded, aborted, serverStatus, failure, after: await rows() });
  await expect(first.getByRole("alert")).toContainText("Could not confirm", { timeout: 30_000 });
  await page.reload(); await page.getByRole("button", { name: "Log family contact", exact: true }).tap();
  const recovered = page.getByRole("dialog", { name: "Log family contact", exact: true });
  await expect(recovered.locator("textarea")).toHaveValue(note); await expect(recovered.locator("textarea")).toBeDisabled();
  await recovered.getByRole("button", { name: "Check original result", exact: true }).tap(); await expect(recovered).not.toBeVisible();
  const afterCheck = await rows(); expect(afterCheck).toHaveLength(1); expect(afterCheck[0].id).toBe(commands[0].attemptId);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull(); record({ action: "reload-original-readback", after: afterCheck });
  let secondForwarded = 0;
  const secondHandler = async (route: Route) => {
    const request = route.request(); if (request.method() !== "POST" || !request.headers()["next-action"]) return route.continue();
    const raw = await page.evaluate(key => localStorage.getItem(key), key); const command = contactCommand(raw ? JSON.parse(raw).payload : null);
    expect(command).toMatchObject({ owner, studentId, sessionLabel, outcome: "spoke", note }); expect(command!.attemptId).not.toBe(commands[0].attemptId);
    expect(request.postData()).toContain(command!.attemptId); ++secondForwarded;
    commands.push(command!); record({ action: "before-deliberate-separate-contact", command, before: await rows() }); await route.continue();
  };
  await page.route(pattern, secondHandler); const second = await compose(); await second.getByRole("button", { name: "Save", exact: true }).tap(); await expect(second).not.toBeVisible(); await page.unroute(pattern, secondHandler);
  const final = await rows(); expect(final).toHaveLength(2); expect(new Set(final.map(row => row.id))).toEqual(new Set(commands.map(command => command.attemptId)));
  expect(commands).toHaveLength(2); expect(forwarded).toBe(1); expect(aborted).toBe(1); expect(secondForwarded).toBe(1);
  for (const row of final) expect(row).toMatchObject({ created_by: owner, session_label: sessionLabel, student_id: studentId, kind: "contact", outcome: "spoke", note, agreed_on: null, note_id: null });
  const noticeAfter = await db().from("staff_notices").select("id", { count: "exact", head: true }); checked(noticeAfter.error);
  expect(noticeAfter.count).toBe(noticeBefore.count);
  expect(forbidden).toBe(0); record({ action: "final-readback", final, forbidden, firstSaveForwarded: forwarded, secondSaveForwarded: secondForwarded, noticesBefore: noticeBefore.count, noticesAfter: noticeAfter.count, mutations: "Two deliberately separate contacts; original UUID persisted once; no messages or financial changes" });
});
