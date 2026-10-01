import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { m } from "@/messages";
import { attendanceLabels } from "@/modules/attendance/domain/attendance";
import { primary } from "@/platform/i18n/language";
import { draftKey } from "@/platform/drafts/policy";
import { db, ownClassOf, signIn } from "./support/harness";

test("installation metadata and offline cold-launch fallback", async ({ page, context }) => {
  const account = await signIn(page, "teacher", "/preferences");
  await expect(page.getByRole("heading", { name: primary(m.pwaTitle, account.language) })).toBeVisible();
  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest.id).toBe("/"); expect(manifest.start_url).toBe("/");
  expect(manifest.shortcuts.map((item: { url: string }) => item.url)).toEqual(["/", "/preferences"]);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.goto("/teach", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Reconnect to open VPPS One" })).toBeVisible();
  await context.setOffline(false);
  const privateUrls = await page.evaluate(async () => {
    const names = await caches.keys();
    return (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)))).flat().filter(path => /^(\/api\/|\/teach|\/fees|\/r\/)/.test(path));
  });
  expect(privateUrls).toEqual([]);
});

test("attendance draft survives offline edits and requires scoped recovery", async ({ page, context }) => {
  const scene = await ownClassOf("teacher");
  // An unused historical day, no server submit: only device drafts are changed.
  const day = "2024-04-02";
  const path = `/teach/attendance?class=${scene.classId}&day=${day}`;
  const account = await signIn(page, "teacher", path);
  const button = page.getByRole("button", { name: primary(attendanceLabels.absent, account.language), exact: true }).first();
  await expect(button).toBeEnabled();
  await context.setOffline(true);
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(primary(m.draftWaiting, account.language))).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole("button", { name: primary(m.draftRestore, account.language), exact: true })).toBeVisible();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: primary(m.draftRestore, account.language), exact: true }).click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(primary(m.draftLocal, account.language))).toBeVisible();
  // A different owner key cannot recover this draft.
  const otherKey = draftKey("other-account", scene.sessionLabel, `attendance/${scene.classId}/${day}/daily`);
  expect(await page.evaluate(async key => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("vppsone-drafts", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    return await new Promise(resolve => { const r = db.transaction("drafts").objectStore("drafts").get(key); r.onsuccess = () => { resolve(r.result ?? null); db.close(); }; });
  }, otherKey)).toBeNull();
  await page.reload();
  await page.getByRole("button", { name: primary(m.draftDiscard, account.language), exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: primary(m.draftRestore, account.language), exact: true })).toHaveCount(0);
});

test("desktop directory details switch locally and keyboard search remains reusable", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page, "admin", "/students");
  const detail = page.locator("aside").filter({ has: page.getByRole("heading", { level: 2 }) }).last();
  await expect(detail).toBeVisible();
  const links = page.locator('main ul a[href^="/teach/student/"]');
  const expectedName = await links.nth(1).locator("span.font-medium").innerText();
  let requests = 0;
  const listener = (request: { url(): string }) => { if (/^\/(students|teach\/student\/)/.test(new URL(request.url()).pathname)) requests++; };
  page.on("request", listener);
  await links.nth(1).click();
  await expect(detail.getByRole("heading", { name: expectedName, exact: true })).toBeVisible();
  page.off("request", listener);
  expect(requests).toBe(0);
  await page.screenshot({ path: "test-results/smooth-directory-desktop.png" });
  await expect(page).toHaveURL(/\/students$/);
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("payment drafts recover only after review and never post while offline", async ({ page, context }) => {
  const { data: student, error } = await db("public").from("students").select("id").eq("status", "active").limit(1).single();
  if (error || !student) throw new Error("An active dev student is required for the payment draft case.");
  const account = await signIn(page, "accountant", `/fees/payments?studentId=${student.id}`);
  const amount = page.getByRole('textbox', { name: 'Amount received', exact: true });
  await expect(amount).toBeEnabled();
  const receiptCount = () => db("public").from("receipts").select("id", { count: "exact", head: true }).eq("student_id", student.id);
  const before = await receiptCount();
  if (before.error) throw new Error("Could not read the dev receipt count.");
  await context.setOffline(true);
  await amount.fill("123");
  await expect(page.getByText(primary(m.draftWaiting, account.language), { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Collect / })).toBeDisabled();
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole("button", { name: primary(m.draftRestore, account.language), exact: true })).toBeVisible();
  await expect(amount).toHaveValue("");
  await page.getByRole("button", { name: primary(m.draftRestore, account.language), exact: true }).click();
  await expect(amount).toHaveValue("123");
  await page.screenshot({ path: "test-results/smooth-payment-phone.png" });
  await page.reload();
  await page.getByRole("button", { name: primary(m.draftDiscard, account.language), exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: primary(m.draftRestore, account.language), exact: true })).toHaveCount(0);
  const after = await receiptCount();
  expect(after.error).toBeNull();
  expect(after.count).toBe(before.count);
});

test("worker updates wait for user choice and recover persisted drafts after reload", async ({ page }) => {
  test.skip(Boolean(process.env.APP_ORIGIN && !["localhost", "127.0.0.1"].includes(new URL(process.env.APP_ORIGIN).hostname)), "The update fixture must run against a local production server.");
  const scene = await ownClassOf("teacher");
  const day = "2024-04-03";
  const account = await signIn(page, "teacher", `/teach/attendance?class=${scene.classId}&day=${day}`);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const absent = page.getByRole("button", { name: primary(attendanceLabels.absent, account.language), exact: true }).first();
  await absent.click();
  await expect(page.getByText(primary(m.draftLocal, account.language))).toBeVisible();
  // Browser update-script fetches bypass Playwright routing. Change the public
  // fixture on our local production server and restore it even on failure.
  const original = readFileSync("public/service-worker.js", "utf8");
  writeFileSync("public/service-worker.js", original.replaceAll("vppsone-public-v4", "vppsone-public-v5"));
  try {
    await page.evaluate(async () => { const registration = await navigator.serviceWorker.ready; await registration.update(); });
    await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true);
    await expect(page.getByRole("button", { name: primary(m.pwaReload, account.language) })).toBeVisible();
    await expect(absent).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true);
    const reopened = page.waitForEvent("domcontentloaded", { timeout: 15000 }).catch(async error => {
      const state = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return { waiting: registration?.waiting?.state, active: registration?.active?.state, controller: navigator.serviceWorker.controller?.state, online: navigator.onLine };
      });
      await test.info().attach("update-worker-state", { body: JSON.stringify(state), contentType: "application/json" });
      throw error;
    });
    await Promise.all([reopened, page.getByRole("button", { name: primary(m.pwaReload, account.language) }).click()]);
    await expect(page.getByRole("button", { name: primary(m.draftRestore, account.language), exact: true })).toBeVisible();
    await page.getByRole("button", { name: primary(m.draftDiscard, account.language), exact: true }).click();
  } finally { writeFileSync("public/service-worker.js", original); }
});

test("marks drafts recover offline edits and clear only after a confirmed save", async ({ page, context }) => {
  const scene = await ownClassOf("teacher");
  const examId = randomUUID(); const paperId = randomUUID();
  const { data: subject, error: subjectError } = await db().from("subjects").select("id, code").limit(1).single();
  if (subjectError || !subject) throw new Error("A dev subject is required for the marks draft case.");
  const { error: examError } = await db().from("assessments").insert({ id: examId, session_label: scene.sessionLabel, term: "QA", code: `QA-DRAFT-${examId}`, label_hi: "QA", label_en: "QA", status: "open" });
  if (examError) throw new Error(examError.message);
  try {
    const { error: paperError } = await db().from("assessment_subjects").insert({ id: paperId, assessment_id: examId, class_id: scene.classId, class_label: "QA class", subject_id: subject.id, subject_code: subject.code, max_marks: 100 });
    if (paperError) throw new Error(paperError.message);
    const account = await signIn(page, "admin", `/assessments/marks/${paperId}`);
    const cell = page.locator('input[inputmode="decimal"]').first();
    await expect(cell).toBeEnabled();
    await context.setOffline(true);
    await cell.fill("37.5");
    await expect(page.getByText(primary(m.draftWaiting, account.language))).toBeVisible();
    await expect(page.getByRole("button", { name: primary(m.marksSaveRow, account.language), exact: true })).toBeDisabled();
    await context.setOffline(false);
    await page.reload();
    await page.getByRole("button", { name: primary(m.draftRestore, account.language), exact: true }).click();
    await expect(cell).toHaveValue("37.5");
    await page.getByRole("button", { name: primary(m.marksSaveRow, account.language), exact: true }).click();
    await expect(page.getByText(primary(m.draftSchool, account.language), { exact: true })).toBeVisible();
    const { data: marks, error } = await db().from("marks").select("value, absent").eq("assessment_subject_id", paperId);
    expect(error).toBeNull();
    expect(marks).toHaveLength(1);
    expect(Number(marks![0].value)).toBe(37.5);
    expect(marks![0].absent).toBe(false);
    await page.reload();
    await expect(cell).toHaveValue("37.5");
    await expect(page.getByRole("button", { name: primary(m.draftRestore, account.language), exact: true })).toHaveCount(0);
  } finally {
    const { error } = await db().from("assessments").delete().eq("id", examId);
    if (error) throw new Error(`QA marks cleanup failed: ${error.message}`);
  }
});
