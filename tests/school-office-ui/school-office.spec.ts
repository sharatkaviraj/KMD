import { test, expect, type Page } from "@playwright/test";
import { O } from "../../src/vx/screens/school-office/text";
import { G, R } from "../../src/vx/screens/school-office/return-text";
import { C } from "../../src/vx/screens/school-office/copilot-text";
import { lead } from "../../src/vx/text";
import { B, APPEARANCE } from "../../src/vx/screens/board-office/text";
import { currentChild, departedChild, unmappedChild } from "./board-data";
const evidence = "D:/Codex/scratch/school-office-release-2026-11-01/browser";
const studentId = "00000000-0000-4000-8000-000000000001";
test.beforeEach(async ({ page }) => {
  // Only loopback fixture traffic is allowed. PDF rendering is a synthetic stub.
  await page.route("**/*", route => {
    const url = route.request().url();
    if (!url.startsWith("http://127.0.0.1:3216/")) return route.abort();
    if (/\/pdf(?:\?|$)/.test(url)) return route.fulfill({ contentType: "text/html", body: "<p>Synthetic stored PDF preview</p>" });
    if (/\/file(?:\?|$)/.test(url)) return route.fulfill({ contentType: "application/octet-stream", body: "Synthetic file only" });
    return route.continue();
  });
});
async function calls(page: Page, name: string) { return page.evaluate(name => window.schoolOfficeCalls.filter(call => call.name === name), name); }
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }))).toMatchObject({ viewport: page.viewportSize()!.width });
  const overflow = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("main,section,.card,.office-form,.office-note,.office-filters,.board-stack,.board-form,.board-note,.board-tools")].filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1).map(element => ({ tag: element.tagName, class: element.className, width: element.clientWidth, scroll: element.scrollWidth })));
  expect.soft(overflow, `Contained layout at ${page.url()}`).toEqual([]);
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Document width at ${page.url()}`).toBe(true);
  const clippedActions = await page.locator(".btn,.pill").evaluateAll(elements => elements.filter(element => element.getClientRects().length && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)).map(element => ({ text: element.textContent, width: element.clientWidth, scrollWidth: element.scrollWidth, height: element.clientHeight, scrollHeight: element.scrollHeight })));
  expect.soft(clippedActions, `Action text fits its control at ${page.url()}`).toEqual([]);
}
for (const width of [360, 390, 430, 1280, 1440]) for (const language of ["en", "hi", "both"] as const) for (const theme of ["light", "dark"] as const) {
  test(`responsive actual office components ${width}px ${language} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 900 ? 844 : 960 });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    for (const screen of ["register", "profile", "certificate", "returns", "destination", "copilot", "batch", "import", "template", "format", "board", "results"]) {
      await page.goto(`/?screen=${screen}&language=${language}&theme=${theme}`);
      await expect(page.locator(".vx-page")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      if (screen === "profile") await expect(page.getByRole("button", { name: lead(O.study, language), exact: true })).toBeVisible();
      if (screen === "register") await expect(page.getByRole("table", { name: lead(O.register, language) })).toBeVisible();
      if (screen === "returns" || screen === "batch") await expect(page.getByText(lead(G.outcomeHint, language), { exact: true })).toBeVisible();
      if (screen === "board" || screen === "results") {
        await expect(page.locator("article")).toHaveCount(3);
        for (const summary of await page.locator("article details > summary").all()) await summary.click();
      }
      await noOverflow(page);
      if ((language === "hi" && theme === "dark" && [360, 1440].includes(width)) || (width === 390 && language === "both" && theme === "light")) await page.screenshot({ path: `${evidence}/${screen}-${width}-${language}-${theme}.png`, fullPage: true, animations: "disabled" });
    }
    expect(errors).toEqual([]);
  });
}
test("profile issues directly with keyboard and browser Back returns to profile", async ({ page }) => {
  await page.goto("/?screen=profile");
  const button = page.getByRole("button", { name: O.study.en, exact: true });
  await button.focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/school-office\/certificates\/synthetic-issue$/);
  expect(await calls(page, "generate")).toHaveLength(1);
  await expect(page.getByRole("button", { name: O.download.en })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goBack(); await expect(button).toBeVisible();
});
test("interrupted certificate response retry retains the exact command ID", async ({ page }) => {
  await page.goto("/?screen=profile&state=retry"); await page.getByRole("button", { name: O.study.en, exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(O.unavailable.en);
  await page.getByRole("button", { name: O.retry.en, exact: true }).click();
  await expect(page).toHaveURL(/\/certificates\/synthetic-issue$/);
  const requested = await calls(page, "generate"); expect(requested).toHaveLength(2);
  expect(requested[0].input).toEqual(requested[1].input);
  expect(requested[0].input).toMatchObject({ studentId, sessionLabel: "TEST-2026-27", commandId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
});
test("blocked child gives exact authoritative correction route and does not issue", async ({ page }) => {
  await page.goto("/?screen=profile&state=blocked&language=hi"); await page.getByRole("button", { name: O.study.hi, exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("प्रवेश / एसआर संख्या");
  const correction = page.getByRole("link", { name: O.fix.hi }); await expect(correction).toHaveAttribute("href", `/admissions/${studentId}`);
  await correction.click(); await expect(page).toHaveURL(new RegExp(`/admissions/${studentId}$`));
  expect(await calls(page, "generate")).toHaveLength(1);
});
test("register filters search/status/student scope and pagination then opens exact issue", async ({ page }) => {
  await page.goto("/?screen=register"); await page.getByRole("searchbox", { name: O.search.en }).fill("Synthetic");
  await page.getByRole("combobox", { name: O.status.en }).selectOption("issued");
  await page.getByRole("button", { name: O.searchButton.en, exact: true }).click();
  await expect(page).toHaveURL(url => url.searchParams.get("q") === "Synthetic" && url.searchParams.get("status") === "issued" && url.searchParams.get("student") === studentId);
  const rows = page.getByRole("table").locator('a[role="row"]'); await expect(rows).toHaveCount(1); await expect(rows).toHaveAttribute("href", "/school-office/certificates/synthetic-issued");
  await rows.click(); await expect(page).toHaveURL(/\/certificates\/synthetic-issued$/);
  await page.goBack(); await expect(page.getByRole("combobox", { name: O.status.en })).toHaveValue("issued");
  await page.goBack(); await page.getByRole("link", { name: O.next.en, exact: true }).click();
  await expect(page).toHaveURL(/page=2/); await expect(page).toHaveURL(new RegExp(`student=${studentId}`));
});
test("readiness board shows progress per destination and types nothing", async ({ page }) => {
  await page.goto("/?screen=returns");
  await expect(page.locator("input,select,textarea")).toHaveCount(0);
  await expect(page.getByText(R.deadlineUnverified.en).first()).toBeVisible();
  await page.getByRole("link", { name: R.open.en }).first().click();
  await expect(page).toHaveURL(/\/school-office\/returns\/d\/psp/);
});
test("heat-grid cell lists exactly those students, linked to their profiles", async ({ page }) => {
  await page.goto("/?screen=destination");
  await expect(page.getByRole("table", { name: R.whoMissing.en })).toBeVisible();
  await page.getByRole("table", { name: R.whoMissing.en }).getByRole("link").first().click();
  await expect(page).toHaveURL(/class=class-9&issue=missing%3AadmissionNo/);
  await expect(page.locator("#students a[href^='/students/']")).toHaveCount(1);
  await expect(page.getByRole("link", { name: R.askTeachers.en })).toHaveAttribute("href", "/collection/rounds/new?class=class-9");
});
test("manual entry prepares only ready rows and opens the assistant", async ({ page }) => {
  await page.goto("/?screen=destination");
  await expect(page.getByText(/2 students who need details or have conflicts are left out/)).toBeVisible();
  await page.getByRole("button", { name: R.startManual.en }).click();
  await expect(page).toHaveURL(/\/returns\/synthetic-batch\/copilot$/);
  expect((await calls(page, "prepare-return"))[0].input).toMatchObject({ excludeBlocked: true, expectedSource: "synthetic-source-revision", schoolCode: "" });
});
test("verified upload cannot be downloaded while rows are blocked", async ({ page }) => {
  await page.goto("/?screen=destination&state=verified");
  await expect(page.getByRole("button", { name: R.downloadUpload.en })).toBeDisabled();
  await expect(page.getByText(R.uploadBlocked.en)).toBeVisible(); expect(await calls(page, "prepare-return")).toEqual([]);
});
test("assistant copies values, marks entered, advances and resumes", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?screen=copilot&state=resume");
  await expect(page.getByText(C.honesty.en, { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Student 2 of 3", { exact: false })).toBeVisible();
  await page.keyboard.press("1"); await expect(page.getByRole("button", { name: /Admission/ })).toContainText(C.copied.en);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("'=SUM(1)");
  await page.getByRole("button", { name: C.markEntered.en }).click();
  await expect(page.getByText("Student 3 of 3", { exact: false })).toBeVisible();
  expect((await calls(page, "mark-copilot"))[0].input).toMatchObject({ state: "entered" });
  await page.keyboard.press("k"); await expect(page.getByText("Student 2 of 3", { exact: false })).toBeVisible();
});
test("download is file-prepared only; portal acceptance requires recorded outcome", async ({ page }) => {
  await page.goto("/?screen=batch"); await expect(page.getByText(G.manual.en, { exact: true })).toBeVisible();
  await expect(page.getByText(G.outcomeHint.en, { exact: true })).toBeVisible();
  await expect(page.getByText("File prepared", { exact: true })).toBeVisible();
  await expect(page.getByText("Acceptance recorded", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: G.download.en })).toHaveAttribute("href", "/school-office/returns/synthetic-batch/file");
  await expect(page.getByRole("combobox", { name: O.status.en }).getByRole("option", { name: G.accepted.en })).toHaveCount(0);
  expect(await calls(page, "record-outcome")).toEqual([]);
});
test("import conflicts prevent Apply; a clean staged preview permits Apply", async ({ page }) => {
  await page.goto("/?screen=import"); await expect(page.getByText(G.conflictHint.en, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: G.apply.en })).toBeDisabled(); expect(await calls(page, "apply-return")).toEqual([]);
  await page.goto("/?screen=import&state=clean"); await page.getByRole("button", { name: G.apply.en }).click();
  expect((await calls(page, "apply-return"))[0].input).toMatchObject({ batchId: "synthetic-batch", revision: 1 });
});
test("source outage disables checking and unavailable register offers retry", async ({ page }) => {
  await page.goto("/?screen=returns&state=source-unavailable"); await expect(page.getByRole("alert")).toHaveText(R.source.en); await expect(page.getByText(R.notChecked.en).first()).toBeVisible();
  await page.goto("/?screen=register&state=unavailable"); await expect(page.getByRole("alert")).toContainText(O.loadFailed.en); await expect(page.getByRole("link", { name: O.retry.en })).toHaveAttribute("href", /page=1/);
});
test("board retains departed registered membership alongside a healthy current roster", async ({ page }) => {
  await page.goto("/?screen=board");
  await expect(page.locator(`article a[href='/students/${currentChild}']`)).toBeVisible();
  const departed = page.locator("article").filter({ has: page.locator(`a[href='/students/${departedChild}']`) });
  await expect(departed).toContainText("Synthetic DepartedRegisteredChildWithLongName");
  await departed.getByText(B.mapping.en, { exact: true }).click();
  await expect(departed.locator(".board-source").first()).toContainText("HIN · ENG");
  await expect(departed.locator('input[name="registration"]')).toHaveCount(0);
  await expect(page.locator(".board-metric").filter({ hasText: B.candidates.en }).locator("strong")).toHaveText("3");
  await page.getByRole("link", { name: B.results.en, exact: true }).click();
  await expect(page).toHaveURL(/\/exam-office\/official-results\?cycle=/);
  await expect(departed).toContainText("PENDING AUTHORITY VERIFICATION");
});
test("official results keep exact raw evidence and pending distinct from zero and unknown appearance", async ({ page }) => {
  await page.goto("/?screen=results");
  const current = page.locator("article").filter({ has: page.locator(`a[href='/students/${currentChild}']`) });
  await expect(current).toContainText("A1 (083/100)");
  await expect(current.getByText("ENG: Pending · AWAITING OFFICIAL RELEASE", { exact: true })).toBeVisible();
  await expect(current.getByText(/ENG:.*(?:\b0\b|0\/100)/)).toHaveCount(0);
  await current.getByText(`${B.history.en} (2)`, { exact: true }).click();
  await expect(current).toContainText("PASS — AS ISSUED");
  await expect(current).toContainText(`${B.appearance.en}: ${APPEARANCE.unknown.en}`);
  await expect(current).toContainText(`${B.appearance.en}: ${APPEARANCE.appeared.en}`);
  await expect(page.locator(".board-metric").filter({ hasText: B.unknown.en }).locator("strong")).toHaveText("1");
  await current.getByText(B.results.en, { exact: true }).click();
  const form = current.locator("form"); await expect(form.locator('[name="rawValue"]')).toBeDisabled(); await expect(form.locator('[name="rawValue"]')).toHaveValue("");
  await form.locator('[name="rawStatus"]').fill("PENDING — EXACT AUTHORITY TEXT"); await form.locator('[name="reference"]').fill("Synthetic official result still pending on checked source");
  await form.getByRole("button", { name: B.save.en, exact: true }).click();
  expect((await calls(page, "save-official-result"))[0].input).toMatchObject({ payload: { status: "pending", rawValue: null, rawStatus: "PENDING — EXACT AUTHORITY TEXT", appearance: "unknown" } });
});
test("registration requires explicit selected subjects and never prefills the entire subject list", async ({ page }) => {
  await page.goto("/?screen=board");
  const article = page.locator("article").filter({ has: page.locator(`a[href='/students/${unmappedChild}']`) });
  await article.getByText(B.mapping.en, { exact: true }).click();
  const form = article.locator("form").filter({ has: page.locator('[name="registration"]') });
  await expect(article.locator('input[name="subject"]:checked')).toHaveCount(0);
  await article.locator('[name="registration"]').fill("SYN-NEW-REG"); await article.locator('[name="roll"]').fill("SYN-NEW-ROLL");
  await article.locator('input[name="subject"][value="HIN"]').check();
  await form.locator('[name="reference"]').fill("Synthetic authority record explicitly lists Hindi only"); await form.locator('[name="verified"]').check();
  await form.getByRole("button", { name: B.save.en, exact: true }).click();
  expect((await calls(page, "save-board-candidate"))[0].input).toMatchObject({ payload: { studentId: unmappedChild, subjects: ["HIN"], verified: true } });
});
test("unconfigured authority sources and unavailable roster invent no deadlines or writable identity", async ({ page }) => {
  await page.goto("/?screen=board&state=unconfigured"); await expect(page.getByText(B.empty.en, { exact: true })).toBeVisible();
  await expect(page.locator('[name="sourceReference"]')).toHaveValue(""); await expect(page.locator('[name="deadline"]')).toHaveValue(""); await expect(page.locator('[name="subjects"]')).toHaveValue("");
  await page.goto("/?screen=board&state=board-source-unavailable"); await expect(page.getByRole("alert")).toHaveText(B.sourceUnavailable.en);
  await expect(page.getByText(B.unverifiedDeadline.en, { exact: true })).toBeVisible();
  await expect(page.locator("form")).toHaveCount(0); await expect(page.locator(".board-metric strong")).toHaveText(["—", "—", "—", "—", "—", "—"]);
});
test("partial acceptance collects the exact accepted SR list and shows individual row outcomes", async ({ page }) => {
  await page.goto("/?screen=batch&state=partial"); await page.getByRole("combobox", { name: O.status.en }).selectOption("partially_accepted");
  const accepted = page.locator('[name="acceptedAdmissionNumbers"]'); await expect(accepted).toHaveAttribute("required", ""); await accepted.fill("SYN-001\nSYN-003");
  await page.locator('[name="acknowledgement"]').fill("Synthetic acknowledgement for exactly two accepted SR numbers");
  await page.locator('[name="evidence"]').setInputFiles({ name: "synthetic-acknowledgement.pdf", mimeType: "application/pdf", buffer: Buffer.from("synthetic evidence, not an official document") });
  await page.getByRole("button", { name: "Partly accepted", exact: true }).click();
  expect((await calls(page, "record-outcome"))[0].input).toMatchObject({ acceptedAdmissionNumbers: "SYN-001\nSYN-003", state: "partially_accepted", batchId: "synthetic-batch" });
  await page.goto("/?screen=batch&state=partial-recorded"); await expect(page.getByText("SYN-001 · Record acceptance", { exact: true })).toBeVisible(); await expect(page.getByText("SYN-003 · Not recorded as accepted", { exact: true })).toBeVisible();
});
test("failed artifact retry resumes its pinned issue and new issue remains an explicit disclosure", async ({ page }) => {
  await page.goto("/?screen=certificate&state=artifact-failed"); await page.getByRole("button", { name: O.retry.en, exact: true }).click();
  expect((await calls(page, "generate"))[0].input).toMatchObject({ resumeIssue: "synthetic-issue", newIssue: false });
  await page.goto("/?screen=certificate"); const fresh = page.getByRole("button", { name: "Issue with a new number", exact: true }); await expect(fresh).toBeHidden();
  await page.getByText("Create another issue", { exact: true }).click(); await fresh.click(); expect((await calls(page, "generate"))[0].input).toMatchObject({ newIssue: true });
});
test("artifact request denial stays on detail and retry retains the exact event command ID before navigation", async ({ page }) => {
  await page.goto("/?screen=certificate&state=event-denied");
  const download = page.getByRole("button", { name: O.download.en, exact: true });
  await download.click(); await expect(page.getByRole("alert")).toHaveText(O.saveFailed.en);
  await expect(page).toHaveURL(/screen=certificate&state=event-denied$/);
  const first = (await calls(page, "certificate-event"))[0].input;
  await download.click(); await expect(page).toHaveURL(/\/certificates\/synthetic-issue\/pdf\?download=1$/);
  const recorded = await page.evaluate(() => JSON.parse(sessionStorage.getItem("synthetic-office-calls") ?? "[]") as { name: string; input: unknown }[]);
  expect(recorded.filter(call => call.name === "certificate-event").map(call => call.input)).toEqual([first, first]);
  expect(first).toMatchObject({ issueId: "synthetic-issue", kind: "download_requested", commandId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
});
