import { expect, test, type Page } from "@playwright/test";

import { qaAccount } from "../fixtures/qa-accounts";
import { db, openAs, signIn } from "./support/harness";

/**
 * Where each role lands, and what the first screen tells them.
 *
 * The three product requirements behind the Ledger Calm 2 role homes:
 *
 *  1. accounts staff open the **School Fees workspace**;
 *  2. a teacher opens **her own class and day**;
 *  3. an administrator opens the **combined school overview**.
 *
 * Asserted against a signed-in browser rather than against the resolver's unit
 * tests, because the resolver being right and the door using it are different
 * facts — and the last time a landing changed, the thing that broke was the
 * redirect, not the rule (B-38 below).
 */

/** The staff profile behind a QA account, so a preference can be set on it. */
async function profileIdOf(accountKey: string): Promise<string> {
  const account = qaAccount(accountKey);

  const { data: users, error: authError } = await db().auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (authError) throw new Error(authError.message);

  const user = users.users.find(
    (candidate) => candidate.email?.toLowerCase() === account.email.toLowerCase(),
  );
  if (!user) throw new Error(`${account.email} has no account — run npm run qa:seed`);

  const { data, error } = await db()
    .from("staff_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle<{ id: string }>();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(`${account.email} has no staff profile — run npm run qa:seed`);

  return data.id;
}

async function setStart(profileId: string, value: string | null) {
  const { error } = await db()
    .from("staff_profiles")
    .update({ preferred_start: value })
    .eq("id", profileId);

  if (error) throw new Error(`Could not set the start screen: ${error.message}`);
}

/** What the page actually says, without the shell. */
async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").innerText()).replace(/\s+/g, " ");
}

test.describe("where a role lands", () => {
  test("a teacher opens her own class and day", async ({ page }) => {
    const account = await signIn(page, "teacher", "/");

    // `/` is the bare address, which is where somebody who typed the school's
    // URL arrives. A teacher's Home is her day, not a card with her own email
    // address on it (B-03).
    await expect(page).toHaveURL(/\/teach$/);

    const text = await mainText(page);

    // Her class is named on the first screen — the design's "Your class VI A".
    expect(text).toMatch(/Your class|आपकी कक्षा/);
    // And the day, which is the other half of "class and day".
    expect(text).toMatch(/Today's timetable|आज का समय-चक्र/);

    expect(account.role).toBe("teacher");
  });

  test("an administrator opens the combined school overview", async ({ page, browser }) => {
    await openAs(page, browser, "admin", "/dashboard");

    const text = await mainText(page);

    // The five things the design's administrator home puts together.
    expect(text).toMatch(/School overview|स्कूल की स्थिति/);
    expect(text).toMatch(/Needs attention|ध्यान चाहिए/);
    expect(text).toMatch(/Today at school|आज स्कूल में/);
    expect(text).toMatch(/Your workspaces|आपके कार्यक्षेत्र/);
    expect(text).toMatch(/Fee collection|फ़ीस का हिसाब/);

    // **No invented rupees.** The fee source is not read here until R6, and
    // the handoff is explicit: unavailable with a next step, never ₹0.
    expect(text).not.toMatch(/₹/);
    await expect(page.locator('[aria-labelledby="admin-workspaces"] a[href="/fees"]')).toBeVisible();
  });

  test("accounts staff open the School Fees workspace", async ({ request }) => {
    // Not a role: an explicit preference on an office account, which is the
    // whole point — `accountant` is the fee app's identity and nothing here
    // can grant it.
    const profileId = await profileIdOf("office");
    await setStart(profileId, "app:schoolfees");

    try {
      // A legacy preference must redirect to the native fee workspace.
      // Read the Location header to test the callback before /fees redirects.
      const response = await request.get(await signInUrl("office"), {
        maxRedirects: 0,
      });

      expect(response.status()).toBe(307);
      const landing = new URL(response.headers().location, response.url());
      expect(landing.origin).toBe(new URL(response.url()).origin);
      expect(landing.pathname).toBe("/fees");
    } finally {
      await setStart(profileId, null);
    }
  });

  test("a deep link still beats the start screen", async ({ page }) => {
    const profileId = await profileIdOf("office");
    await setStart(profileId, "app:schoolfees");

    try {
      await signIn(page, "office", "/students?q=Test");

      // Somebody who followed a link to a particular screen is asking for that
      // screen, not for their landing page.
      await expect(page).toHaveURL(/\/students\?q=Test$/);

      // **B-38.** The query survived. It used to be assigned to `URL.pathname`,
      // which percent-encodes a `?` — so every issued link carrying a query
      // landed on `/students%3Fq=Test`, which is a 404.
      expect(page.url()).not.toContain("%3F");
    } finally {
      await setStart(profileId, null);
    }
  });

  test("a start screen the role may not use is ignored", async ({ page }) => {
    // A teacher has no fees:view permission, so a stored fee preference must
    // fall back to her classroom home.
    const profileId = await profileIdOf("teacher");
    await setStart(profileId, "app:schoolfees");

    try {
      await signIn(page, "teacher", "/");
      await expect(page).toHaveURL(/\/teach$/);
    } finally {
      await setStart(profileId, null);
    }
  });
});

/**
 * A one-time sign-in URL, for the one case that must not follow the app's own
 * navigation afterwards.
 */
async function signInUrl(accountKey: string): Promise<string> {
  const account = qaAccount(accountKey);

  const { data, error } = await db().auth.admin.generateLink({
    type: "magiclink",
    email: account.email,
  });

  if (error) throw new Error(`${account.email}: ${error.message}`);

  return `/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink`;
}
