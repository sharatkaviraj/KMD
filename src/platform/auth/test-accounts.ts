import "server-only";

import { timingSafeEqual } from "node:crypto";

import { QA_ACCOUNTS, QA_EMAIL_DOMAIN } from "../../../tests/fixtures/qa-accounts";
import { ONE_MAIN_PROJECT_REF, supabaseTargetOf } from "@/platform/supabase/target-guard";

/**
 * Passwordless sign-in for the `@qa.vpps.local` test accounts, asked for by
 * the owner on 10 Oct 2026 so every role can be tried on the deployed app
 * (docs/ui/DECISIONS.md UI-63).
 *
 * It exists only while this deployment points at One's main project (or a
 * local stack). That project is production from go-live (D-338), and the tool
 * is CONFINED there, not banned (D-346): while `vppsone.deployment` says
 * production, `testSignInAction` signs in only an `is_test_account` profile
 * (`toolAccountAccess`, checked after the account is chosen and before a
 * session is minted). It only ever signs in as an address in the QA domain,
 * so it cannot reach a real member of staff.
 *
 * Off by default: it also needs `QA_LOGIN_KEY` set on the server and the same
 * key in the request, so the page is not open to whoever finds the URL (a QA
 * admin can reach Staff, and the owner's own account is on dev too).
 */
export function testSignInEnabled(key: unknown): boolean {
  if (!qaToolsEnabled()) return false;
  const expected = process.env.QA_LOGIN_KEY?.trim() ?? "";
  if (typeof key !== "string") return false;
  const given = Buffer.from(key);
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * The deployment-level half of the gate, without a key: pointed at One's main
 * project (or a local stack), and `QA_LOGIN_KEY` configured. The QA clock
 * reads it for every request from a QA account (`qa-clock.ts`). It no longer
 * turns off under VPPSONE_ENV=live: on production the tool is confined to test
 * accounts instead (D-346) — and "production" is the database marker OR the
 * deployment's own declaration (VERCEL_ENV=production / VPPSONE_ENV=live), so a
 * live deployment that goes out before the marker flips is confined too
 * (`readEffectiveEnvironment`, used by `toolAccountAccess`).
 */
export function qaToolsEnabled(): boolean {
  const expected = process.env.QA_LOGIN_KEY?.trim();
  if (!expected || expected.length < 24) return false;
  const target = supabaseTargetOf(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (target.kind === "local") return true;
  return target.kind === "project" && target.ref === ONE_MAIN_PROJECT_REF;
}

/** Is this one of the `@qa.vpps.local` test accounts? */
export function isQaEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(QA_EMAIL_DOMAIN);
}

export type TestAccount = { key: string; email: string; role: string };

export const TEST_ACCOUNTS: TestAccount[] = QA_ACCOUNTS.filter(
  (account) => account.canSignIn && account.email.endsWith(QA_EMAIL_DOMAIN),
).map(({ key, email, role }) => ({ key, email, role }));
