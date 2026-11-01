import { expect, test } from "@playwright/test";

import { qaAccount } from "../fixtures/qa-accounts";
import { db, openAs, signIn } from "./support/harness";

/**
 * Where each role lands, and what the first screen tells them.
 *
 * The three product requirements behind the current role homes:
 *
 *  1. accounts staff open the **School Fees workspace**;
 *  2. a teacher opens **her own class and day**;
 *  3. an administrator opens **Today**, with school activity and fee collection.
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

test.describe("where a role lands", () => {
  test("a teacher opens her own class and day", async ({ page }) => {
    const account = await signIn(page, "teacher", "/");

    // `/` is the bare address, which is where somebody who typed the school's
    // URL arrives. A teacher's Home is her day, not a card with her own email
    // address on it (B-03).
    await expect(page).toHaveURL(/\/teach$/);

    const main = page.getByRole("main");
    await expect(main).toHaveCount(1);
    // The seeded teacher holds a class. Today names that assignment in the
    // greeting, including on days when school is closed, then shows her periods.
    // Locator assertions wait for the streamed page instead of reading its shell.
    await expect(main).toContainText(/class teacher|की कक्षा अध्यापक/);
    await expect(main).toContainText(/My periods today|आज मेरे पीरियड/);

    expect(account.role).toBe("teacher");
  });

  test("an administrator opens Today with school activity and fee collection", async ({ page, browser }) => {
    await openAs(page, browser, "admin", "/dashboard");
    // The legacy bookmark forwards to the admin's current home.
    await expect(page).toHaveURL(/\/$/);

    const main = page.getByRole("main");
    await expect(main).toHaveCount(1);
    await expect(main).toContainText(/Today at school|आज स्कूल में/);
    await expect(main).toContainText(/Teaching exceptions|पढ़ाई में बदलाव/);
    // The native fee module now supplies real TEST-session money to this home.
    await expect(main).toContainText(/Money taken|जमा राशि|Fees collected today|आज जमा फ़ीस/);
    await expect(main.locator('a[href="/payments"]:visible').first()).toBeVisible();
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
