import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";

import { toolAccessDecision, type ToolAccess } from "./decisions";
import { readEffectiveEnvironment } from "./marker";

/**
 * May a QA tool — passwordless test sign-in, a Smoke Lab seat, a day-run seat
 * — act as this account right now? (D-346)
 *
 * While this deployment is production — `vppsone.deployment` says so (or
 * cannot be read), or the deployment declares itself production
 * (`readEffectiveEnvironment`) — only an `is_test_account` staff profile. The
 * account is named by its staff profile id, its auth user id, or its email
 * (resolved to the auth user without minting anything). Any read failure is
 * "not a test account": fail closed.
 *
 * Every tool calls this after it has decided *which* account and before it
 * mints a token or a session for it.
 */
export async function toolAccountAccess(account: {
  userId?: string | null;
  staffProfileId?: string | null;
  email?: string | null;
}): Promise<ToolAccess> {
  const environment = await readEffectiveEnvironment();
  if (environment === "dev") return toolAccessDecision({ environment, isTestAccount: null });

  let isTestAccount: boolean | null = null;
  try {
    const admin = createAdminClient();
    let userId = account.userId ?? null;
    if (!account.staffProfileId && !userId && account.email) userId = await authUserIdByEmail(admin, account.email);

    const query = admin.from("staff_profiles").select("is_test_account");
    const { data, error } = account.staffProfileId
      ? await query.eq("id", account.staffProfileId).maybeSingle()
      : userId
        ? await query.eq("user_id", userId).maybeSingle()
        : { data: null, error: null };
    if (!error && data) isTestAccount = (data as { is_test_account?: unknown }).is_test_account === true;
  } catch {
    isTestAccount = null;
  }

  return toolAccessDecision({ environment, isTestAccount });
}

/** The auth user with this email, or null. Pages through the admin API; never creates one. */
async function authUserIdByEmail(admin: ReturnType<typeof createAdminClient>, email: string): Promise<string | null> {
  const wanted = email.trim().toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) return null;
    const found = data.users.find((user) => user.email?.trim().toLowerCase() === wanted);
    if (found) return found.id;
    if (data.users.length < perPage) return null;
  }
  return null;
}
