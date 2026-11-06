import "server-only";

import { cache } from "react";

import { createAdminClient } from "@/platform/supabase/admin";
import { cleanParentSwitches, DEFAULT_PARENT_SWITCHES, PARENT_SWITCHES_CLOSED, PARENT_SWITCHES_KEY, type ParentSwitches } from "./domain/parent-switches";

/**
 * The admin's parent-message switches, once per request. No row yet is the
 * default (what One did before); a read that fails is closed, so a database
 * hiccup never queues a message the admin may have turned off.
 */
export const readParentSwitches = cache(async (): Promise<ParentSwitches> => {
  const { data, error } = await createAdminClient()
    .from("school_settings")
    .select("value")
    .eq("key", PARENT_SWITCHES_KEY)
    .maybeSingle<{ value: unknown }>();
  if (error) return PARENT_SWITCHES_CLOSED;
  return data ? cleanParentSwitches(data.value) : DEFAULT_PARENT_SWITCHES;
});
