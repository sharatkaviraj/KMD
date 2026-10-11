import { randomUUID, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { currentSessionLabel, db, ownClassOf, signIn } from "../e2e/support/harness";

test.describe.configure({ mode: "serial" });
const examId = randomUUID(), paperId = randomUUID(), otherId = randomUUID();
const ledgerPath = "../evidence/subject-teacher-ledger.json";
const tag = `phoneops-20261011-marks-${examId.slice(0, 8)}`;
const runLedgerPath = `../evidence/subject-teacher-ledger-${tag}.json`;
const ledger: Record<string, unknown>[] = [];
const pendingActions = new Set<string>();
const uncertainActions = new Set<string>();
function audit(action: string, table: string, key: string, before: unknown, after: unknown, cleanup: string) {
  ledger.push({ at: new Date().toISOString(), action, table, key, before, after, cleanup });
  const contents = JSON.stringify({ target: "wtgxcptmucjerhufzjcf", tag, actions: ledger }, null, 2);
  writeFileSync(runLedgerPath, contents);
  writeFileSync(ledgerPath, contents);
}
function watchActions(page: Page, actor: string) {
  let sequence = 0;
  const contextId = randomUUID().slice(0, 8);
  const requests = new WeakMap<object, { key: string; at: number }>();
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.headers()["next-action"]) return;
    const key = `${actor}:${contextId}:${new URL(request.url()).pathname}:${++sequence}`;
    const at = Date.now(); requests.set(request, { key, at });
    pendingActions.add(key);
    audit("action-post-start", "http", key, null, { at }, "No DB cleanup needed");
  });
  page.on("requestfinished", async (request) => {
    const started = requests.get(request); if (!started) return;
    const response = await request.response();
    pendingActions.delete(started.key);
    audit("action-post-finished", "http", started.key, null, { status: response?.status() ?? null, durationMs: Date.now() - started.at }, "No DB cleanup needed");
  });
  page.on("requestfailed", (request) => {
    const started = requests.get(request); if (!started) return;
    pendingActions.delete(started.key); uncertainActions.add(started.key);
    audit("action-post-failed", "http", started.key, null, { durationMs: Date.now() - started.at, error: request.failure()?.errorText ?? "Unknown request failure" }, "No DB cleanup needed");
  });
}
let teacherId = "", coordinatorId = "", classId = "", session = "";
async function state(id = paperId) {
  const [paper, marks, commands, changes] = await Promise.all([
    db().from("assessment_subjects").select("entry_status,entry_revision").eq("id", id).single(),
    db().from("marks").select("student_id,value,absent,exempt").eq("assessment_subject_id", id),
    db().from("marks_commands").select("id,kind").eq("assessment_subject_id", id),
    db().from("marks_change_log").select("reason").eq("assessment_subject_id", id),
  ]);
  for (const result of [paper, marks, commands, changes]) if (result.error) throw Error(result.error.message);
  return { paper: paper.data, marks: marks.data ?? [], commandCount: commands.data?.length ?? 0, changes: changes.data ?? [] };
}

test.beforeAll(async () => {
  session = await currentSessionLabel();
  const scene = await ownClassOf("teacher");
  expect(session).toBe("2026-27");
  expect(scene.classId).toBe("745643d0-aaca-470f-9372-d87397770a77");
  teacherId = scene.staffProfileId; classId = scene.classId;
  const assignments = await db().from("teaching_assignments").select("subject_id").eq("session_label", session).eq("staff_profile_id", teacherId).eq("class_id", classId);
  const subjects = await db().from("subjects").select("id,code").eq("is_active", true);
  if (assignments.error || subjects.error) throw Error("Fixture subject reads failed");
  const mine = new Set(assignments.data?.map((row) => row.subject_id));
  const own = subjects.data?.find((row) => mine.has(row.id));
  const other = subjects.data?.find((row) => !mine.has(row.id));
  expect(own && other).toBeTruthy();
  const users = await db().auth.admin.listUsers({ perPage: 1000 });
  if (users.error) throw Error(users.error.message);
  const qaExam = users.data.users.find((user) => user.email === "qa.exam@qa.vpps.local");
  if (!qaExam) throw Error("Existing QA exam account unavailable");
  const coordinator = await db().from("staff_profiles").select("id").eq("role", "exam_coordinator").eq("user_id", qaExam.id).single();
  if (coordinator.error) throw Error(coordinator.error.message);
  coordinatorId = coordinator.data.id;
  audit("preflight", "assessments", examId, null, { session, classId, teacherId, tag }, `Delete only assessment ${examId}`);
  const exam = await db().from("assessments").insert({ id: examId, session_label: session, term: tag, code: tag, label_hi: "फोन संचालन परीक्षण", label_en: tag, status: "open" });
  if (exam.error) throw Error(exam.error.message);
  audit("insert", "assessments", examId, null, { status: "open" }, `Delete only assessment ${examId}`);
  const papers = await db().from("assessment_subjects").insert([
    { id: paperId, assessment_id: examId, class_id: classId, class_label: scene.className, subject_id: own!.id, subject_code: own!.code, max_marks: 40, mark_step: 0.5, allow_exempt: true },
    { id: otherId, assessment_id: examId, class_id: classId, class_label: scene.className, subject_id: other!.id, subject_code: other!.code, max_marks: 40, mark_step: 0.5, allow_exempt: true },
  ]);
  if (papers.error) throw Error(papers.error.message);
  audit("insert", "assessment_subjects", paperId, null, { entry_status: "open", entry_revision: 0, otherId }, `Cascade from ${examId}`);
});

test.afterAll(async () => {
  const before = await state().catch(() => null);
  if (pendingActions.size || uncertainActions.size) {
    audit("cleanup-held", "assessments", examId, before, { pendingActionCount: pendingActions.size, uncertainActionCount: uncertainActions.size }, "Preserved: independently confirm terminal command state before exact-ID cleanup");
    throw Error("Marks fixture cleanup held because action completion is uncertain; fixture preserved in audit ledger");
  }
  const removed = await db().from("assessments").delete().eq("id", examId);
  if (removed.error) { audit("cleanup-failed", "assessments", examId, before, removed.error.message, `Delete only assessment ${examId}`); throw Error(removed.error.message); }
  const [exams, papers, marks, commands] = await Promise.all([
    db().from("assessments").select("id").eq("id", examId),
    db().from("assessment_subjects").select("id").eq("assessment_id", examId),
    db().from("marks").select("id").in("assessment_subject_id", [paperId, otherId]),
    db().from("marks_commands").select("id").in("assessment_subject_id", [paperId, otherId]),
  ]);
  expect(exams.data ?? []).toHaveLength(0); expect(papers.data ?? []).toHaveLength(0); expect(marks.data ?? []).toHaveLength(0); expect(commands.data ?? []).toHaveLength(0);
  audit("cleanup", "assessments", examId, before, { remaining: 0 }, "Complete; no shared rows touched");
});

test("teacher phone drafts four states, refuses missing, submits; exam office corrects with reason and reopens", async ({ page, browser }) => {
  test.setTimeout(360_000);
  watchActions(page, "teacher");
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "teacher", `/teach/marks?paper=${paperId}`);
  const inputs = page.locator('input[inputmode="decimal"]');
  await expect(inputs.first()).toBeEnabled();
  const count = await inputs.count(); expect(count).toBeGreaterThan(3);
  const labels = await inputs.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")!));
  await inputs.nth(0).fill("0");
  await page.getByRole("button", { name: /^(Absent|अनुपस्थित)$/ }).nth(1).tap();
  await page.getByRole("button", { name: /^(Exempt|छूट)$/ }).nth(2).tap();
  await expect.poll(async () => (await state()).marks.length).toBe(3);
  const draft = await state();
  expect(draft.paper).toMatchObject({ entry_status: "open" });
  expect(draft.marks.filter((m) => !m.absent && !m.exempt && Number(m.value) === 0)).toHaveLength(1);
  expect(draft.marks.filter((m) => m.absent)).toHaveLength(1); expect(draft.marks.filter((m) => m.exempt)).toHaveLength(1);
  audit("draft-ui", "marks", paperId, [], draft, `Cascade from ${examId}`);
  await page.getByRole("button", { name: /^(Check & send|जाँचें और भेजें)$/ }).tap();
  await expect(page.getByRole("button", { name: /^(Send to exam coordinator|परीक्षा प्रभारी को भेजें)$/ })).toBeDisabled();
  await page.getByRole("button", { name: /^(Back to marks|अंकों पर वापस)$/ }).tap();
  for (let i = 3; i < count; i++) {
    const show = page.getByRole("button", { name: /Show|दिखाएँ/ });
    if (await show.count()) await show.tap();
    const input = page.getByRole("textbox", { name: labels[i], exact: true });
    await expect(input).toBeEnabled(); await input.fill("9.5");
  }
  await expect.poll(async () => (await state()).marks.length).toBe(count);
  await page.getByRole("button", { name: /^(Check & send|जाँचें और भेजें)$/ }).tap();
  await page.getByRole("button", { name: /^(Send to exam coordinator|परीक्षा प्रभारी को भेजें)$/ }).tap();
  await expect.poll(async () => (await state()).paper?.entry_status).toBe("submitted");
  await expect(page.getByRole("heading", { name: /^(Marks sent|अंक भेजे गए)$/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  audit("submit-ui", "assessment_subjects", paperId, draft, await state(), `Cascade from ${examId}`);
  const office = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 412, height: 844 } });
  const officePage = await office.newPage();
  watchActions(officePage, "exam");
  await signIn(officePage, "exam", `/exams?view=entry&paper=${paperId}&exam=${examId}`);
  await officePage.getByRole("button", { name: /^(Correct a mark|अंक सुधारें)$/ }).tap();
  await officePage.locator('input[inputmode="decimal"]').nth(3).fill("39");
  const correction = officePage.getByRole("button", { name: /^(Save correction|सुधार सहेजें)$/ });
  await expect(correction).toBeDisabled();
  await officePage.locator("textarea").fill(tag);
  await correction.tap();
  await expect.poll(async () => (await state()).changes.filter((row) => row.reason === tag).length).toBe(1);
  audit("correction-ui", "marks_change_log", paperId, null, await state(), `Cascade from ${examId}`);
  await officePage.getByRole("button", { name: /^(Hand back to teacher|अध्यापक को वापस दें)$/ }).tap();
  await officePage.getByRole("button", { name: /^(Hand back|वापस दें)$/ }).tap();
  await expect.poll(async () => (await state()).paper?.entry_status, { timeout: 120_000 }).toBe("open");
  audit("reopen-ui", "assessment_subjects", paperId, "submitted", await state(), `Cascade from ${examId}`);
  await office.close();
});

test("teacher cannot open unassigned paper; concurrent scoped commands produce one write and one stale refusal", async ({ page }) => {
  await signIn(page, "teacher", `/teach/marks?paper=${otherId}`);
  await expect(page.locator('input[inputmode="decimal"]')).toHaveCount(0);
  expect((await state(otherId)).marks).toHaveLength(0);
  const before = await state();
  const roster = await db().rpc("paper_roster", { p_paper: paperId });
  if (roster.error) throw Error(roster.error.message);
  const studentId = roster.data[3];
  const command = (actor: string, value: number) => {
    const entries = [{ student_id: studentId, state: "value", value }];
    return { command_id: randomUUID(), actor_staff_id: actor, paper_id: paperId, kind: "draft", expected_revision: before.paper!.entry_revision, reason: null, entries, payload_hash: createHash("sha256").update(JSON.stringify(["draft", before.paper!.entry_revision, null, entries])).digest("hex") };
  };
  const results = await Promise.all([db().rpc("save_marks", { p: command(teacherId, 11) }), db().rpc("save_marks", { p: command(coordinatorId, 12) })]);
  for (const result of results) if (result.error) throw Error(result.error.message);
  expect(results.filter((r) => r.data.ok)).toHaveLength(1); expect(results.filter((r) => r.data.reason === "stale")).toHaveLength(1);
  const after = await state(); expect(after.paper!.entry_revision).toBe(before.paper!.entry_revision + 1); expect(after.commandCount).toBe(before.commandCount + 1);
  audit("concurrent-domain", "marks_commands", paperId, before, { after, outcomes: results.map((r) => ({ ok: r.data.ok, reason: r.data.reason })) }, `Cascade from ${examId}`);
});

test("exam office submits remaining papers; only admin finalises and unlocks this tagged class", async ({ page, browser }) => {
  watchActions(page, "exam");
  await page.setViewportSize({ width: 360, height: 844 });
  await signIn(page, "exam", `/exams?view=entry&paper=${otherId}&exam=${examId}`);
  const fields = page.locator('input[inputmode="decimal"]');
  await expect(fields.first()).toBeEnabled();
  const labels = await fields.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")!));
  for (const label of labels) {
    const input = page.getByRole("textbox", { name: label, exact: true });
    await expect(input).toBeEnabled(); await input.fill("10");
  }
  await expect.poll(async () => (await state(otherId)).marks.length).toBe(labels.length);
  await page.getByRole("button", { name: /^(Check & send|जाँचें और भेजें)$/ }).tap();
  await page.getByRole("button", { name: /^(Send to exam coordinator|परीक्षा प्रभारी को भेजें)$/ }).tap();
  await expect.poll(async () => (await state(otherId)).paper?.entry_status).toBe("submitted");
  await page.goto(`/exams?view=entry&paper=${paperId}&exam=${examId}`);
  await page.getByRole("button", { name: /^(Check & send|जाँचें और भेजें)$/ }).tap();
  await page.getByRole("button", { name: /^(Send to exam coordinator|परीक्षा प्रभारी को भेजें)$/ }).tap();
  await expect.poll(async () => (await state()).paper?.entry_status).toBe("submitted");
  await page.goto(`/exam-office/results?view=lock&exam=${examId}`);
  await expect(page.getByText(/Only the admin finalises marks|अंक केवल प्रशासक अंतिम करते हैं/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Lock \d+ classes$|^\d+ कक्षाएँ बंद करें$/ })).toHaveCount(0);
  const admin = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 412, height: 844 } });
  const adminPage = await admin.newPage();
  watchActions(adminPage, "admin");
  await signIn(adminPage, "admin", `/exam-office/results?view=lock&exam=${examId}`);
  await adminPage.getByRole("button", { name: /^(Lock 1 classes|1 कक्षाएँ बंद करें)$/ }).tap();
  await adminPage.getByRole("button", { name: /^(Lock|बंद करें)$/ }).tap();
  const locks = () => db().from("exam_class_locks").select("assessment_id,class_id,locked_by").eq("assessment_id", examId).eq("class_id", classId);
  await expect.poll(async () => (await locks()).data?.length ?? 0).toBe(1);
  audit("finalise-admin-ui", "exam_class_locks", `${examId}/${classId}`, [], (await locks()).data, `Cascade from ${examId}`);
  await page.goto(`/exams?view=entry&paper=${paperId}&exam=${examId}`);
  await expect(page.getByRole("button", { name: /^(Correct a mark|अंक सुधारें)$/ })).toHaveCount(0);
  await adminPage.reload();
  await adminPage.getByRole("button", { name: /^(Unlock|खोलें)$/ }).tap();
  await expect.poll(async () => (await locks()).data?.length ?? 0).toBe(0);
  audit("unlock-admin-ui", "exam_class_locks", `${examId}/${classId}`, "locked", [], `Cascade from ${examId}`);
  await page.reload();
  await expect(page.getByRole("button", { name: /^(Correct a mark|अंक सुधारें)$/ })).toBeEnabled();
  await admin.close();
});
