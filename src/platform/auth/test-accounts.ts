import "server-only";

import { timingSafeEqual } from "node:crypto";

import { QA_ACCOUNTS, QA_EMAIL_DOMAIN } from "../../../tests/fixtures/qa-accounts";
import { currentTargetContext, DEV_PROJECT_REFS, supabaseTargetOf } from "@/platform/supabase/target-guard";

/**
 * Passwordless sign-in for the `@qa.vpps.local` test accounts, asked for by
 * the owner on 10 Oct 2026 so every role can be tried on the deployed app
 * (docs/ui/DECISIONS.md UI-63).
 *
 * It exists only while this deployment points at schoolfees-dev (or a local
 * stack) and is not declared live. At the cutover (VPPSONE_ENV=live, the live
 * fee project) this is false: the page 404s and the action refuses, with no
 * code change. It only ever signs in as an address in the QA domain, so it
 * cannot reach a real member of staff.
 *
 * Off by default: it also needs `QA_LOGIN_KEY` set on the server and the same
 * key in the request, so the page is not open to whoever finds the URL (a QA
 * admin can reach Staff, and the owner's own account is on dev too).
 */
export function testSignInEnabled(key: unknown): boolean {
  if (currentTargetContext().environment === "live") return false;
  const expected = process.env.QA_LOGIN_KEY?.trim();
  if (!expected || expected.length < 24 || typeof key !== "string") return false;
  const given = Buffer.from(key);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return false;
  const target = supabaseTargetOf(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (target.kind === "local") return true;
  return target.kind === "project" && (DEV_PROJECT_REFS as readonly string[]).includes(target.ref);
}

export type TestAccount = { key: string; email: string; role: string };

export const TEST_ACCOUNTS: TestAccount[] = QA_ACCOUNTS.filter(
  (account) => account.canSignIn && account.email.endsWith(QA_EMAIL_DOMAIN),
).map(({ key, email, role }) => ({ key, email, role }));
