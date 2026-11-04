import { expect, test, type Page } from "@playwright/test";

/*
 * Review C01: the guided cover flow on a phone and a desk. Synthetic fixture
 * (tests/mobile-ui/guided-cover.*): nothing is saved and nothing is sent; the
 * stubbed actions record what the screen asked for on `window.qaGuided`.
 */
test.setTimeout(60_000);

type Recorded = { previews: { periods: number[] }[]; confirms: { commandId: string; fingerprint: string; dayRevision: number }[]; checks: string[] };
const recorded = (page: Page) => page.evaluate(() => (window as unknown as { qaGuided: Recorded }).qaGuided);
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

const teacherPicker = (page: Page, label: RegExp = /Teacher who is away/) => page.getByRole("combobox", { name: label });

async function toReview(page: Page) {
  await teacherPicker(page).selectOption({ label: "Test Teacher Asha" });
  await page.getByRole("button", { name: "Show their lessons" }).click();
  await expect(page.getByRole("heading", { name: "Lessons & cover" })).toBeFocused();
  await expect(page.getByText("Proposed: Test Teacher Meera")).toBeVisible();
  await page.getByRole("radiogroup", { name: "Who covers P1" }).getByRole("radio", { name: /Test Teacher Kavita/ }).click();
  await expect(page.getByText("Your choice: Test Teacher Kavita")).toBeVisible();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check before saving" })).toBeFocused();
}

for (const width of [320, 390, 1280]) {
  test(`who → lessons → review → confirm, and the result is the server's (${width}px)`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?view=guided-cover&locale=en");
    expect(await noSideScroll(page)).toBe(0);
    await toReview(page);
    expect(await noSideScroll(page)).toBe(0);

    // Before Confirm: every assignment, and who will get a WhatsApp message.
    await expect(page.getByText("Nothing is saved until you press Confirm.")).toBeVisible();
    await expect(page.getByText(/Confirming queues 2 WhatsApp messages to 2 teachers/)).toBeVisible();
    await expect(page.getByText(/no WhatsApp number — assigned, but not messaged/)).toBeVisible();
    expect((await recorded(page)).confirms).toHaveLength(0);

    await page.getByRole("button", { name: "Confirm and save" }).click();
    await expect(page.getByRole("heading", { name: "Saved" })).toBeVisible();
    await expect(page.getByText(/2 WhatsApp messages queued for 2 teachers\. Queued is not delivered yet/)).toBeVisible();
    await expect(page.getByText("→ Test Teacher Meera")).toBeVisible();
    expect((await recorded(page)).confirms).toHaveLength(1);
    expect(await noSideScroll(page)).toBe(0);
  });
}

test("a partial day sends only the chosen periods", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/?view=guided-cover&locale=en");
  await teacherPicker(page).selectOption({ label: "Test Teacher Asha" });
  await page.getByRole("radio", { name: "Some periods" }).click();
  await page.getByRole("button", { name: /^Period 3:/ }).click();
  await page.getByRole("button", { name: /^Period 6:/ }).click();
  await expect(page.getByRole("button", { name: /^Period 3:/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Show their lessons" }).click();
  await expect(page.getByRole("heading", { name: "Lessons & cover" })).toBeVisible();
  expect((await recorded(page)).previews.at(-1)!.periods).toEqual([2, 5]);
  await expect(page.getByRole("radiogroup", { name: "Who covers P1" })).toHaveCount(0);
  expect(await noSideScroll(page)).toBe(0);
});

test("a day somebody else changed is said plainly, reloaded and confirmed as a new command", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=guided-cover&locale=en&confirm=stale");
  await toReview(page);
  await page.getByRole("button", { name: "Confirm and save" }).click();
  await expect(page.getByText(/Somebody else changed cover for this day after you looked\. Nothing was saved\./)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saved" })).toHaveCount(0);
  await page.getByRole("button", { name: "Confirm and save" }).click();
  await expect(page.getByRole("heading", { name: "Saved" })).toBeVisible();
  const { confirms } = await recorded(page);
  expect(confirms).toHaveLength(2);
  expect(confirms[1].commandId).not.toBe(confirms[0].commandId);
  expect(confirms[1].dayRevision).toBe(confirms[0].dayRevision + 1);
});

test("a lost answer is checked, stays visible, and Try again resends the same command (Hindi)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=guided-cover&locale=hi&confirm=lost");
  await teacherPicker(page, /अनुपस्थित शिक्षक/).selectOption({ label: "Test Teacher Asha" });
  await page.getByRole("button", { name: "उनके पीरियड देखें" }).click();
  await page.getByRole("button", { name: "जाँचें", exact: true }).click();
  await page.getByRole("button", { name: "पुष्टि करें और सहेजें" }).click();
  await expect(page.getByRole("alert").getByText(/सहेजा नहीं गया।/)).toBeVisible();
  const first = await recorded(page);
  expect(first.checks).toEqual([first.confirms[0].commandId]);
  await page.getByRole("alert").getByRole("button", { name: "फिर आज़माएँ" }).click();
  await expect(page.getByRole("heading", { name: "सहेजा गया" })).toBeVisible();
  const { confirms } = await recorded(page);
  expect(confirms.map((c) => c.commandId)).toEqual([confirms[0].commandId, confirms[0].commandId]);
  expect(await noSideScroll(page)).toBe(0);
});
