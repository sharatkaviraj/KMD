import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(({ page }) => { page.on("pageerror", error => { throw error; }); });

const openTab = async (page: import("@playwright/test").Page, query = "") => {
  await page.goto(`/student-profile.html?${query}`);
  await page.locator(".s360-tabs").getByRole("link", { name: /^(Documents|दस्तावेज़)$/ }).click();
};
const pdf = { name: "Synthetic certificate.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nSynthetic file\n") };

for (const width of [320, 390, 1280]) for (const theme of ["light", "dark"]) {
  test(`saved files open and adding stays available ${width}/${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await openTab(page, `documents=saved&theme=${theme}`);
    const section = page.getByRole("region", { name: "Uploaded documents" });
    await expect(section.getByRole("button", { name: "Add document", exact: true })).toBeVisible();
    const first = section.getByRole("link", { name: /Open.*Synthetic birth certificate/ });
    await expect(first).toHaveAttribute("href", "/documents/00000000-0000-4000-8000-0000000000d1");
    await expect(first).toHaveAttribute("target", "_blank");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await first.focus(); await expect(first).toBeFocused();
    await page.screenshot({ path: info.outputPath(`documents-${width}-${theme}.png`), animations: "disabled" });
    await section.getByRole("button", { name: "Add document", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add document" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save document", exact: true })).toBeDisabled();
    await dialog.getByRole("radio", { name: "Birth certificate", exact: true }).check();
    await dialog.locator("input[type=file]").setInputFiles(pdf);
    await expect(dialog.getByText(pdf.name, { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save document", exact: true })).toBeEnabled();
    await page.screenshot({ path: info.outputPath(`upload-${width}-${theme}.png`), animations: "disabled" });
    expect((await new AxeBuilder({ page }).include("[role=dialog]").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(section.getByRole("button", { name: "Add document", exact: true })).toBeFocused();
  });
}

test("upload retry preserves the file and identity, edits start a new identity, success stays in the profile", async ({ page }) => {
  await openTab(page);
  const attempts: Record<string, unknown>[] = [];
  let succeed = false;
  await page.route("**/documents/bucket-upload", async route => {
    const body = route.request().postDataJSON();
    if (body.phase === "begin") attempts.push(body);
    await route.fulfill({ json: succeed ? { ok: true, state: "stored" } : { ok: false, reason: "storage_down" } });
  });
  await page.getByRole("button", { name: "Add document", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add document" });
  await dialog.getByRole("radio", { name: "Birth certificate", exact: true }).check();
  await dialog.locator("input[type=file]").setInputFiles(pdf);
  await dialog.getByRole("button", { name: "Save document", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByText(pdf.name, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: /Retry|Resume/ }).click();
  await expect.poll(() => attempts.length).toBe(2);
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(attempts[0].clientRequestId).toBe(attempts[1].clientRequestId);
  await dialog.getByRole("radio", { name: "Aadhaar", exact: true }).check();
  succeed = true;
  await dialog.getByRole("button", { name: "Save document", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Document saved." })).toBeVisible();
  await expect(dialog).not.toBeVisible();
  expect(attempts[2].clientRequestId).not.toBe(attempts[1].clientRequestId);
  expect(attempts[2].studentId).toBe("00000000-0000-4000-8000-000000000001");
  expect(attempts[2].kind).toBe("aadhaar");
  await expect(page).toHaveURL(/tab=documents/);
});

test("invalid files never send and an upload in progress cannot be dismissed", async ({ page }) => {
  await openTab(page);
  await page.getByRole("button", { name: "Add document", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add document" });
  await dialog.getByRole("radio", { name: "Other", exact: true }).check();
  await dialog.locator("input[type=file]").setInputFiles({ ...pdf, buffer: Buffer.from("<html>not a PDF</html>") });
  await dialog.getByRole("button", { name: "Save document", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  let finish!: () => void;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  await page.route("**/documents/bucket-upload", async route => { await wait; await route.fulfill({ json: { ok: true, state: "stored" } }); });
  await dialog.locator("input[type=file]").setInputFiles(pdf);
  await dialog.getByRole("button", { name: "Save document", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  finish();
  await expect(dialog).not.toBeVisible();
});

test("read-only, failed reads and unavailable storage have distinct states", async ({ page }) => {
  await openTab(page, "documents=readonly");
  await expect(page.getByRole("button", { name: "Add document", exact: true })).toHaveCount(0);
  await openTab(page, "documents=error");
  await expect(page.getByRole("region", { name: "Uploaded documents" }).getByRole("alert")).toBeVisible();
  await expect(page.getByRole("region", { name: "Uploaded documents" }).getByText("No documents yet", { exact: true })).toHaveCount(0);
  await openTab(page, "storage=unavailable");
  await page.getByRole("button", { name: "Add document", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add document" }).getByRole("alert")).toBeVisible();
  await expect(page.getByRole("dialog").locator("input[type=file]")).toHaveCount(0);
});

test("removal asks for the filename and a failure keeps the file available", async ({ page }) => {
  await openTab(page, "documents=saved");
  await page.getByRole("button", { name: "Remove Synthetic Aadhaar.png", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Remove document?" });
  await expect(dialog.getByText("Synthetic Aadhaar.png", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Remove document", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("link", { name: /Open.*Synthetic Aadhaar/ })).toBeVisible();
});

test("Hindi upload controls and keyboard file selection work", async ({ page }) => {
  await openTab(page, "locale=hi");
  await page.getByRole("button", { name: "दस्तावेज़ जोड़ें", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const choose = dialog.getByRole("button", { name: "फ़ाइल चुनें", exact: true });
  await choose.focus();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.keyboard.press("Enter")]);
  await chooser.setFiles(pdf);
  await expect(dialog.getByText(pdf.name, { exact: true })).toBeVisible();
});

test("school-issued certificates stay separate below uploaded records", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.route("**/school-office/certificates?**", route => route.fulfill({ json: { rows: [] } }));
  await openTab(page, "documents=saved&certificates=1");
  await expect(page.getByText("No school-issued certificates yet", { exact: true })).toBeVisible();
  const uploaded = await page.getByRole("region", { name: "Uploaded documents" }).boundingBox();
  const issued = await page.getByText("School-issued certificates", { exact: true }).boundingBox();
  expect(issued!.y).toBeGreaterThan(uploaded!.y + uploaded!.height);
  await expect(page.locator(".s360-body").getByRole("button", { name: "Study certificate", exact: true })).toBeVisible();
});

for (const state of ["draft", "retry", "inflight"] as const) test(`fee stream preserves the document ${state}`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openTab(page, "stream=1");
  const attempts: Record<string, unknown>[] = [];
  let finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  await page.route("**/documents/bucket-upload", async route => {
    const body = route.request().postDataJSON();
    if (body.phase === "begin") attempts.push(body);
    if (state === "inflight") await held;
    await route.fulfill({ json: state === "retry" ? { ok: false, reason: "storage_down" } : { ok: true, state: "stored" } });
  });
  await page.getByRole("button", { name: "Add document", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add document" });
  await dialog.getByRole("radio", { name: "Birth certificate", exact: true }).check();
  await dialog.locator("input[type=file]").setInputFiles(pdf);
  await dialog.locator("summary").click();
  await dialog.getByRole("textbox", { name: "Note (optional)" }).fill("Synthetic original note");
  if (state !== "draft") {
    await dialog.getByRole("button", { name: "Save document", exact: true }).click();
    if (state === "retry") await expect(dialog.getByRole("alert")).toBeVisible();
    else await expect.poll(() => attempts.length).toBe(1);
  }
  await page.evaluate(() => window.dispatchEvent(new Event("qa:resolve-fees")));
  await expect(page.locator(".s360-kpis.phone").getByText("₹2,400", { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(pdf.name, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Note (optional)" })).toHaveValue("Synthetic original note");
  if (state === "draft") await expect(dialog.getByRole("textbox", { name: "Note (optional)" })).toBeFocused();
  if (state === "retry") {
    await dialog.getByRole("button", { name: "Retry upload", exact: true }).click();
    await expect.poll(() => attempts.length).toBe(2);
    expect(attempts[0].clientRequestId).toBe(attempts[1].clientRequestId);
  } else if (state === "inflight") {
    await expect(dialog.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    finish();
    await expect(page.getByRole("status").filter({ hasText: "Document saved." })).toBeVisible();
    expect(attempts).toHaveLength(1);
  }
});

test("bilingual upload labels show both account languages", async ({ page }) => {
  await openTab(page, "locale=hi-en");
  await page.getByRole("button", { name: "Add document", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Add document/ });
  await expect(dialog.locator("legend")).toContainText("Document type");
  await expect(dialog.locator("legend")).toContainText("दस्तावेज़ का प्रकार");
  const birth = dialog.getByRole("radio", { name: /Birth certificate/ });
  await birth.check();
  await expect(dialog.getByText("जन्म प्रमाणपत्र", { exact: true })).toBeVisible();
});
