import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";

import { toolAccessDecision, type ToolAccess } from "./decisions";
import { readDeploymentEnvironment } from "./marker";

/**
 * May a QA tool — passwordless test sign-in, a Smoke Lab seat, a day-run seat
 * — act as this account right now? (D-346)
 *
 * While `vppsone.deployment` says production (or cannot be read), only an
 * `is_test_account` staff profile. The account is named by its auth user id or
 * its staff profile id. Any read failure is "not a test account": fail closed.
 *
 * Every tool calls this after it has decided *which* account and before it
 * mints a session for it.
 */
export async function toolAccountAccess(account: {
  userId?: string | null;
  staffProfileId?: string | null;
}): Promise<ToolAccess> {
  const environment = await readDeploymentEnvironment();
  if (environment === "dev") return toolAccessDecision({ environment, isTestAccount: null });

  let isTestAccount: boolean | null = null;
  try {
    const admin = createAdminClient();
    const query = admin.from("staff_profiles").select("is_test_account");
    const { data, error } = account.staffProfileId
      ? await query.eq("id", account.staffProfileId).maybeSingle()
      : account.userId
        ? await query.eq("user_id", account.userId).maybeSingle()
        : { data: null, error: null };
    if (!error && data) isTestAccount = (data as { is_test_account?: unknown }).is_test_account === true;
  } catch {
    isTestAccount = null;
  }

  return toolAccessDecision({ environment, isTestAccount });
}
