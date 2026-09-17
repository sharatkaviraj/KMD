import { readFileSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import type { Browser, BrowserContext, Page } from "@playwright/test";

import { qaAccount } from "../../fixtures/qa-accounts";

/**
 * What a workflow test needs before it can press anything: a dev database, a
 * signed-in browser, and a way to look at what was actually written.
 *
 * **Asserting the screen said "saved" is not asserting anything.** Every
 * journey here checks the row, not the toast — PLAN §5 R0 asks for "actual
 * persisted and downstream results", and the bugs this app has actually had
 * (an empty marks row written for every unreached child, a cheerful zero from
 * a swallowed query error) all rendered perfectly while being wrong.
 */

const DEV_PROJECT_REF = "wtgxcptmucjerhufzjcf";
const repoRoot = path.resolve(process.cwd());

function readEnv(): Record<string, string> {
  return Object.fromEntries(
    readFileSync(path.join(repoRoot, ".env.local"), "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );
}

const env = readEnv();

if (!(env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(DEV_PROJECT_REF)) {
  // Rule 3. These journeys write: they mark registers and create requests.
  throw new Error("Refusing to run workflow tests: .env.local is not the dev project.");
}

/**
 * The service-role client, for setting a scene and reading back what landed.
 *
 * The return type is inferred rather than annotated `SupabaseClient`: that
 * type is generic over the schema, so naming it collapses the two schemas into
 * the default one and every `public` read stops type-checking.
 */
export function db(schema: "vppsone" | "public" = "vppsone") {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema },
    auth: { persistSession: false },
  });
}

/**
 * Sign in as one of the QA accounts and land on `next`.
 *
 * A one-time `token_hash` minted by the Supabase admin API, checked by Supabase
 * at `/auth/confirm` — the same door `npm run dev:login` opens (D-86). No
 * password is involved anywhere, and only `@qa.vpps.local` addresses can be
 * minted for.
 */
export async function signIn(page: Page, accountKey: string, next = "/dashboard") {
  const account = qaAccount(accountKey);

  const { data, error } = await db().auth.admin.generateLink({
    type: "magiclink",
    email: account.email,
  });

  if (error) throw new Error(`${account.email}: ${error.message}`);

  await page.goto(
    `/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=${encodeURIComponent(next)}`,
  );

  // A bounce to /login means the session never took, and every assertion after
  // that would be about the login screen.
  if (page.url().includes("/login")) {
    throw new Error(`${account.email}: sign-in bounced to /login`);
  }

  return account;
}

/** The school's own day (+05:30), which is what the app calls today. */
export function schoolToday(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

/** The current session label, derived the way the app derives it. */
export async function currentSessionLabel(): Promise<string> {
  const { data, error } = await db("public").from("classes").select("session_label");
  if (error) throw new Error(`Could not read the sessions: ${error.message}`);

  return [...new Set((data ?? []).map((row) => row.session_label as string))]
    .sort()
    .reverse()[0];
}

/**
 * The class the QA teacher is class teacher of, and its children.
 *
 * Resolved from the database rather than hard-coded, because `qa:seed` chooses
 * the teacher by rule and the answer moves with the timetable.
 */
export async function ownClassOf(accountKey: string) {
  const account = qaAccount(accountKey);
  const sessionLabel = await currentSessionLabel();

  const { data: user, error: userError } = await db()
    .from("staff_profiles")
    .select("id, short_name, display_name, user_id")
    .not("user_id", "is", null);

  if (userError) throw new Error(userError.message);

  const { data: users, error: authError } = await db().auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (authError) throw new Error(authError.message);

  const authUser = users.users.find(
    (candidate) => candidate.email?.toLowerCase() === account.email.toLowerCase(),
  );
  if (!authUser) throw new Error(`${account.email} has no account — run npm run qa:seed`);

  const profile = (user ?? []).find((row) => row.user_id === authUser.id);
  if (!profile) {
    throw new Error(`${account.email} is not bound to a staff profile — run npm run qa:seed`);
  }

  const { data: held, error: heldError } = await db()
    .from("class_teachers")
    .select("class_id")
    .eq("staff_profile_id", profile.id)
    .eq("session_label", sessionLabel)
    .is("effective_to", null);

  if (heldError) throw new Error(heldError.message);

  const classId = held?.[0]?.class_id as string | undefined;
  if (!classId) {
    throw new Error(`${account.email} holds no class — run npm run qa:seed`);
  }

  const [{ data: klass }, { data: roll, error: rollError }] = await Promise.all([
    db("public").from("classes").select("id, class_name").eq("id", classId).maybeSingle(),
    db()
      .from("enrolments")
      .select("student_id")
      .eq("class_id", classId)
      .eq("session_label", sessionLabel)
      .eq("status", "enrolled"),
  ]);

  if (rollError) throw new Error(rollError.message);

  return {
    staffProfileId: profile.id as string,
    classId,
    className: (klass?.class_name as string) ?? classId,
    sessionLabel,
    childCount: (roll ?? []).length,
  };
}

/* ------------------------------------------------- signing in once, not often */

/**
 * The cookies for an account, minted once and reused.
 *
 * `signIn()` asks Supabase for a fresh one-time link every time it is called,
 * and a suite that does that eighteen times in a minute gets rate-limited —
 * which surfaces as "sign-in bounced to /login" on whichever cases happen to
 * run last, and reads exactly like a permission bug. It is not one: it is a
 * fixture asking a real service for more one-time tokens than it will give.
 *
 * So a suite with many cases per account signs in once per account and hands
 * the session to each page. Tests that are *about* signing in keep calling
 * `signIn()` directly, because reusing a session would not test the door.
 */
const sessions = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

export async function sessionCookies(browser: Browser, accountKey: string) {
  const cached = sessions.get(accountKey);
  if (cached) return cached;

  const context = await browser.newContext();
  const page = await context.newPage();

  await signIn(page, accountKey);
  const cookies = await context.cookies();

  await context.close();
  sessions.set(accountKey, cookies);

  return cookies;
}

/** Put an account's session on this page, then go to `path`. */
export async function openAs(
  page: Page,
  browser: Browser,
  accountKey: string,
  path: string,
) {
  await page.context().addCookies(await sessionCookies(browser, accountKey));
  await page.goto(path);

  if (page.url().includes("/login")) {
    throw new Error(`${accountKey}: the reused session did not open ${path}`);
  }

  return qaAccount(accountKey);
}

/**
 * Remove a round the way a round actually comes apart.
 *
 * **B-41: deleting the round does not delete its links.**
 * `collection_requests.round_id` is `ON DELETE SET NULL`, which is right for
 * the app — archiving a round should not silently destroy the answers a
 * teacher already sent — and wrong for a test teardown that assumed a cascade.
 * Three specs carried the same `// Cascades to its links…` comment and none of
 * them did, so every fan-out run left three live requests in the office's list
 * on the shared dev database, forever.
 *
 * It accumulated until a *different* journey failed: `/collection` renders one
 * list, and the office home it was asserting against had filled up with other
 * runs' leftovers. A fixture that does not clean up is a fixture that breaks
 * somebody else's test a week later.
 *
 * Requests are removed first and by `round_id`, so their fields, frozen
 * members and submissions go with them — those *are* cascades.
 */
export async function removeRound(roundId: string | null | undefined) {
  if (!roundId) return;

  const requests = await db()
    .from("collection_requests")
    .delete()
    .eq("round_id", roundId);

  if (requests.error) {
    throw new Error(`Could not remove the round's links: ${requests.error.message}`);
  }

  const round = await db().from("collection_rounds").delete().eq("id", roundId);

  if (round.error) {
    throw new Error(`Could not remove the round: ${round.error.message}`);
  }
}
