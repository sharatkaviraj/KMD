import { expect, test, type BrowserContext, type TestInfo } from "@playwright/test";
import { db, geometry, guardContext, releaseGuard, signInExisting, trustedTap, type GuardEvidence } from "./support";

const receiptId = "f0e10905-66d4-409f-8d6b-2a9c6f53a645";
const accountantStudent = "4f0d0fb5-1714-4dae-af33-998977941d08";
const receiptNumber = "SVP20260403-0003";
const adminRequest = "f03f47aa-0485-436b-8323-ee3c811d926a";
const adminField = "41bc8001-0ac4-45fe-8e12-ac3740c6da3f";
const adminStudent = "0c9f719c-7c5e-4cf4-a621-bce758236697";
const adminTag = "phoneops-20261011-admin-followup-29acbd26";
const teacherStudent = "017b6e4f-d1e2-4433-a2c6-6fdf917f88a5";
const draftPrefix = "PR79-READONLY-UNSAVED-DRAFT";
let deployment: ReturnType<typeof releaseGuard>;

test.beforeAll(() => {
  test.skip(process.env.PR79_READONLY_RUN !== "yes", "Prepared source only; coordinator deployment and browser-slot release required.");
  deployment = releaseGuard();
});

async function finish(context: BrowserContext, guard: GuardEvidence, info: TestInfo, details: Record<string, unknown>) {
  try {
    await info.attach("read-only-phone-evidence", { body: JSON.stringify({ deployment, ...details, browser: guard, screenshots: false, traces: false, physicalDevice: false }, null, 2), contentType: "application/json" });
    expect(guard.blockedWrites, "no browser non-GET may be attempted").toEqual([]);
  } finally { await context.close(); }
}
async function chequeState() {
  const results = await Promise.all([
    db("public").from("receipts").select("id,student_id,receipt_number,payment_date,payment_mode,total_amount,notes").eq("id", receiptId).single(),
    db().from("acc_cheques").select("receipt_id,cheque_no,bank_name,cheque_date").eq("receipt_id", receiptId),
    db().from("acc_cheque_events").select("id,receipt_id,status,deposit_slip_id").eq("receipt_id", receiptId).order("created_at"),
  ]);
  if (results.some(result => result.error)) throw Error("Owned cheque readback unavailable; no mutation allowed.");
  return { receipt: results[0].data, metadata: results[1].data, events: results[2].data };
}

for (const viewport of [{ width: 360, height: 844 }, { width: 390, height: 844 }, { width: 412, height: 844 }, { width: 844, height: 390 }]) {
  test(`accountant Books retained cleared cheque and last-row clearance ${viewport.width}x${viewport.height}`, async ({ browser }, info) => {
    const before = await chequeState();
    expect(before.receipt).toMatchObject({ student_id: accountantStudent, receipt_number: receiptNumber, payment_date: "2026-04-03", payment_mode: "cheque", total_amount: 333 });
    expect(before.receipt?.notes).toContain("OPS-SCHOOL-20261011-FEE-CHEQUE");
    expect(before.events).toHaveLength(2); expect(before.events?.at(-1)?.status).toBe("cleared");
    const context = await browser.newContext({ baseURL: deployment.origin, viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: "block" });
    const guard = await guardContext(context), page = await context.newPage();
    const details: Record<string, unknown> = { actor: "accountant", viewport, route: "/accounts/books", receiptId, status: "incomplete", addDetailsCoverage: "blocked by retained fixture: cleared cheque already has details; no save or clear permitted" };
    try {
      await signInExisting(page, "accountant", "/accounts/books?view=cheques&session=2026-27");
      const cleared = page.getByRole("radio", { name: /^Cleared(?:\s|$)/ });
      await expect(cleared).toBeVisible(); await trustedTap(cleared);
      await expect(cleared).toHaveAttribute("aria-checked", "true");
      const owned = page.locator(".row.ac-ct").filter({ hasText: receiptNumber });
      await expect(owned).toBeVisible(); await expect(owned).toContainText("₹333");
      await expect(owned.getByRole("button", { name: "Add details", exact: true })).toHaveCount(0);
      const rows = page.locator(".row.ac-ct"), lastRow = rows.last();
      const measured = await geometry(lastRow); details.lastRow = measured;
      details.retainedIsLastVisibleRow = await owned.evaluate(element => element === Array.from(document.querySelectorAll(".row.ac-ct")).at(-1));
      expect(measured.coarse).toBe(true); expect(measured.documentWidth).toBeLessThanOrEqual(viewport.width + 1);
      expect(measured.ownsCenter, "actual last row center is reachable").toBe(true);
      expect(measured.navVisible).toBe(true); expect(measured.gap).not.toBeNull(); expect(measured.gap!).toBeGreaterThanOrEqual(12);
      expect(await chequeState()).toEqual(before);
      details.status = "passed read/tab/last-row geometry; Add-details interaction blocked by fixture";
      details.ownedReceiptUnchanged = true; details.writeCount = 0;
    } finally { await finish(context, guard, info, details); }
  });
}

async function adminState() {
  const results = await Promise.all([
    db().from("collection_submissions").select("id,request_id,field_id,student_id,status,value,previous_value").eq("request_id", adminRequest).eq("field_id", adminField).single(),
    db().from("student_records").select("field_id,value,source").eq("student_id", adminStudent).eq("field_id", adminField),
    db().from("student_record_history").select("id,field_id,outcome").eq("student_id", adminStudent).eq("field_id", adminField),
  ]);
  if (results.some(result => result.error)) throw Error("Owned pending admin fixture unavailable; no decisions allowed.");
  return { submission: results[0].data, records: results[1].data, history: results[2].data };
}

test("admin selected retained pending B row read-only at 390px", async ({ browser }, info) => {
  const before = await adminState();
  expect(before.submission).toMatchObject({ request_id: adminRequest, field_id: adminField, student_id: adminStudent, status: "pending" });
  expect(before.submission?.value).toContain(adminTag);
  const context = await browser.newContext({ baseURL: deployment.origin, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const guard = await guardContext(context), page = await context.newPage();
  const details: Record<string, unknown> = { actor: "admin", route: "/collection/review", viewport: { width: 390, height: 844 }, status: "incomplete", submissionId: before.submission!.id };
  try {
    await signInExisting(page, "admin", "/collection/review");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    const bulk = page.locator("[data-bulk-decide]");
    if (await bulk.count() === 0) {
      details.selectionCoverage = "blocked: real bulk UI requires more than one pending change; no extra fixture created";
    } else {
      const selected = bulk.locator('input[type="hidden"][name="submissionIds"]');
      await expect(selected).toHaveCount(0);
      const label = bulk.locator("label").filter({ hasText: before.submission!.value! });
      await expect(label).toHaveCount(1); await expect(label).toBeVisible();
      await trustedTap(label); await expect(label.locator('input[type="checkbox"]')).toBeChecked();
      await expect(selected).toHaveCount(1); await expect(selected).toHaveValue(before.submission!.id);
      const decisions = bulk.locator('button[type="submit"][name="accept"]');
      await expect(decisions).toHaveCount(2);
      const measured = [];
      for (const control of await decisions.all()) { await expect(control).toBeEnabled(); measured.push(await geometry(control)); }
      details.decisionGeometry = measured;
      for (const control of measured) { expect(control.coarse).toBe(true); expect(control.documentWidth).toBeLessThanOrEqual(391); expect(control.height).toBeGreaterThanOrEqual(44); expect(control.ownsCenter).toBe(true); }
      await trustedTap(label); await expect(selected).toHaveCount(0);
      details.selectionCoverage = "passed: only retained B ID selected and cleared; no decision action tapped";
    }
    expect(await adminState()).toEqual(before);
    details.status = "passed read-only route/fixture invariants"; details.fixtureUnchanged = true; details.writeCount = 0;
  } finally { await finish(context, guard, info, details); }
});

async function verifiedTeacherFixture(staffId: string) {
  const own = await db("public").from("students").select("id,admission_no,notes").eq("id", teacherStudent).single();
  if (own.error || !own.data) return false;
  const tag = `${own.data.admission_no ?? ""} ${own.data.notes ?? ""}`;
  if (!/(?:^|\s)(?:QA|TEST|OPS|phoneops)[-_]/i.test(tag)) return false;
  const enrolled = await db().from("enrolments").select("class_id").eq("student_id", teacherStudent).eq("session_label", "2026-27").eq("status", "enrolled");
  if (enrolled.error || !enrolled.data?.length) return false;
  const held = await db().from("class_teachers").select("class_id").eq("staff_profile_id", staffId).eq("session_label", "2026-27").is("effective_to", null);
  return !held.error && Boolean(held.data?.some(row => enrolled.data?.some(entry => entry.class_id === row.class_id)));
}

test("teacher notes composer local draft without Save at 390px", async ({ browser }, info) => {
  const context = await browser.newContext({ baseURL: deployment.origin, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const guard = await guardContext(context), page = await context.newPage();
  const details: Record<string, unknown> = { actor: "teacher", route: "/teach/notes", viewport: { width: 390, height: 844 }, status: "incomplete", physicalKeyboard: false };
  try {
    const identity = await signInExisting(page, "teacher", "/teach/notes");
    await expect(page.locator("button.n-fab")).toBeVisible(); await trustedTap(page.locator("button.n-fab"));
    const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
    const note = dialog.getByRole("textbox", { name: "Note", exact: true });
    await expect(note).toBeVisible(); await note.tap(); await expect(note).toBeFocused();
    await page.setViewportSize({ width: 390, height: 460 });
    await expect(note).toBeFocused();
    const fixtureVerified = await verifiedTeacherFixture(identity.staffId);
    details.fixtureTagAndOwnEnrolmentVerified = fixtureVerified;
    if (fixtureVerified) {
      const before = await db().from("notes").select("id").eq("student_id", teacherStudent).like("body", `${draftPrefix}%`);
      expect(before.error).toBeNull(); expect(before.data).toEqual([]);
      await dialog.getByRole("combobox", { name: "Child", exact: true }).selectOption(teacherStudent);
      await note.fill(`${draftPrefix}: temporary local review; never saved`);
      await dialog.locator("button.pri").tap();
      const save = dialog.getByRole("button", { name: /^(?:Save note|नोट सहेजें)$/ });
      await expect(save).toBeVisible(); const measured = await geometry(save); details.reviewFooterGeometry = measured;
      expect(measured.coarse).toBe(true); expect(measured.height).toBeGreaterThanOrEqual(44); expect(measured.withinViewport).toBe(true); expect(measured.ownsCenter).toBe(true); expect(measured.documentWidth).toBeLessThanOrEqual(391);
      const after = await db().from("notes").select("id").eq("student_id", teacherStudent).like("body", `${draftPrefix}%`);
      expect(after.error).toBeNull(); expect(after.data).toEqual(before.data);
      details.reviewCoverage = "passed local draft/review/footer read; Save never activated; no tagged persisted note";
    } else {
      const next = dialog.locator("button.pri"), measured = await geometry(next); details.emptyComposerFooterGeometry = measured;
      await expect(next).toBeDisabled(); expect(measured.withinViewport).toBe(true); expect(measured.documentWidth).toBeLessThanOrEqual(391);
      details.reviewCoverage = "blocked: retained child could not prove synthetic tag and current own-class enrolment; empty composer only";
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.getByRole("button", { name: "Close", exact: true }).tap(); await expect(dialog).not.toBeVisible();
    details.status = "passed bounded composer read/open/focus/close"; details.writeCount = 0;
  } finally { await finish(context, guard, info, details); }
});

const contactPrefix = "OPS-CONTACT-20261012";
async function ownedContactStudent() {
  const child = await db("public").from("students").select("id,admission_no,notes").eq("id", accountantStudent).single();
  expect(child.error).toBeNull();
  expect(child.data).toMatchObject({ id: accountantStudent, admission_no: "OPS-SCHOOL-20261011-ACCOUNTANT" });
  expect(child.data?.notes).toContain("synthetic DEV phone test; no messaging or transfers");
  return child.data;
}
async function retainedContacts() {
  const ids = (process.env.PR79_READONLY_CONTACT_IDS ?? "").split(",");
  if (ids.length !== 2 || new Set(ids).size !== 2 || ids.some(id => !/^[0-9a-f-]{36}$/.test(id))) throw Error("Exact two retained contact IDs required; no fixture creation allowed.");
  const note = process.env.PR79_READONLY_CONTACT_NOTE ?? "";
  if (!note.startsWith(contactPrefix) || note.length > 400) throw Error("Exact owned contact note required; no broad contact read allowed.");
  const result = await db().from("student_followups").select("id,student_id,session_label,kind,outcome,note,agreed_on,created_by,created_at")
    .eq("student_id", accountantStudent).eq("session_label", "2026-27").eq("kind", "contact").eq("note", note).order("id");
  expect(result.error).toBeNull(); expect(result.data).toHaveLength(2);
  expect(result.data?.map(row => row.id).sort()).toEqual([...ids].sort());
  return { ids, note, rows: result.data };
}

test("admin retained contact read and empty composer open/close without action at 390px", async ({ browser }, info) => {
  test.skip(!process.env.PR79_READONLY_CONTACT_IDS || !process.env.PR79_READONLY_CONTACT_NOTE, "Blocked: coordinator has not supplied verified retained contact IDs/note; no contact fixture is made by this suite.");
  const childBefore = await ownedContactStudent(), before = await retainedContacts();
  const context = await browser.newContext({ baseURL: deployment.origin, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const guard = await guardContext(context), page = await context.newPage();
  const details: Record<string, unknown> = { actor: "admin", studentId: accountantStudent, contactIds: before.ids, route: `/students/${accountantStudent}`, viewport: { width: 390, height: 844 }, status: "incomplete", mutationAcceptance: "not performed: neither Save nor Check original result is activated" };
  try {
    const identity = await signInExisting(page, "admin", `/students/${accountantStudent}`);
    expect(before.rows?.every(row => row.created_by === identity.staffId)).toBe(true);
    const contact = page.locator("[data-family-contact]");
    await expect(contact).toBeVisible(); await expect(contact).toContainText(before.note);
    const open = contact.getByRole("button", { name: /^(?:Log family contact|परिवार संपर्क दर्ज करें)$/ });
    const openerGeometry = await geometry(open); details.openerGeometry = openerGeometry;
    expect(openerGeometry.height).toBeGreaterThanOrEqual(44); expect(openerGeometry.ownsCenter).toBe(true);
    await trustedTap(open);
    const dialog = page.getByRole("dialog", { name: /^(?:Log family contact|परिवार संपर्क दर्ज करें)$/ });
    await expect(dialog).toBeVisible();
    const save = dialog.getByRole("button", { name: /^(?:Save|सहेजें)$/ });
    await expect(save).toBeDisabled(); const saveGeometry = await geometry(save); details.emptySaveGeometry = saveGeometry;
    expect(saveGeometry.height).toBeGreaterThanOrEqual(44); expect(saveGeometry.withinViewport).toBe(true); expect(saveGeometry.ownsCenter).toBe(true); expect(saveGeometry.documentWidth).toBeLessThanOrEqual(391);
    await expect(dialog.getByRole("button", { name: /^(?:Check original result|मूल नतीजा जाँचें)$/ })).toHaveCount(0);
    await trustedTap(dialog.getByRole("button", { name: "Close", exact: true })); await expect(dialog).not.toBeVisible();
    expect(await retainedContacts()).toEqual(before); expect(await ownedContactStudent()).toEqual(childBefore);
    details.status = "passed latest-contact UI read, two exact retained DB rows, empty composer44px open/close and unchanged readbacks";
    details.uiHistoryCoverage = "latest contact only is rendered by this component; the two scoped rows are independently read from DEV";
    details.writeCount = 0;
  } finally { await finish(context, guard, info, details); }
});

test("admin own profile explicit returnTo preserves directory class/filter/page2 through real Next Back at 390px", async ({ browser }, info) => {
  const childBefore = await ownedContactStudent();
  const directory = "/students?q=OPS-SCHOOL-20261011-ACCOUNTANT&class=745643d0-aaca-470f-9372-d87397770a77&view=fees&seg=pending&page=2";
  const profile = `/students/${accountantStudent}?returnTo=${encodeURIComponent(directory)}`;
  const context = await browser.newContext({ baseURL: deployment.origin, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const guard = await guardContext(context), page = await context.newPage();
  const details: Record<string, unknown> = { actor: "admin", studentId: accountantStudent, viewport: { width: 390, height: 844 }, directory, profile, status: "incomplete", familySiblingClickCoverage: "blocked: owned child has no synthetic sibling relation; no family fixture or other family's sibling link is used" };
  try {
    await signInExisting(page, "admin", profile);
    await expect(page.locator("[data-family-contact]")).toBeVisible();
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(directory);
    const back = page.locator("header.only-m").getByRole("link", { name: "Back", exact: true });
    await expect(back).toHaveAttribute("href", directory);
    const measured = await geometry(back); details.backGeometry = measured;
    expect(measured.coarse).toBe(true); expect(measured.height).toBeGreaterThanOrEqual(44); expect(measured.width).toBeGreaterThanOrEqual(44); expect(measured.ownsCenter).toBe(true); expect(measured.documentWidth).toBeLessThanOrEqual(391);
    await trustedTap(back); await expect(page).toHaveURL(`${deployment.origin}${directory}`);
    await expect(page.locator("header.only-m")).toBeVisible();
    expect(`${new URL(page.url()).pathname}${new URL(page.url()).search}`).toBe(directory);
    expect(await ownedContactStudent()).toEqual(childBefore);
    details.status = "passed explicit return context and trusted44px Back on real deployed Next routes";
    details.scope = "profile-to-filtered-directory context; actual Family-to-Sibling production traversal remains blocked by fixture";
    details.writeCount = 0;
  } finally { await finish(context, guard, info, details); }
});
