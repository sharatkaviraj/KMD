import "server-only";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { schoolNow } from "@/platform/auth/qa-clock";
import { logWarn } from "@/platform/observability/log";

import { needsView, type NeedsView } from "../data/board";
import type { NeedsSource } from "../data/sources";
import type { NeedsRole } from "../domain/types";
import { NeedsStripLazy } from "./strip-lazy";

/**
 * The strip on a person's Today, drawn on the server inside its own Suspense
 * boundary (D-630): Today shows at once and the strip follows. A failure
 * leaves it out; Today never waits on Needs you or breaks for it.
 */
export async function NeedsStripSlot({
  staff,
  role,
  source,
  sessionLabel,
}: {
  staff: CurrentStaff;
  role: NeedsRole;
  source: NeedsSource | Promise<NeedsSource>;
  sessionLabel: string | null;
}) {
  if (!sessionLabel) return null;
  let view: NeedsView | null = null;
  try {
    view = await needsView(staff, { role, source, sessionLabel, now: await schoolNow(staff) });
  } catch (caught) {
    logWarn("needs_you.strip_failed", { error: caught instanceof Error ? caught.message.slice(0, 120) : "unknown" });
  }
  return view ? <NeedsStripLazy view={view} /> : null;
}

/** What Today shows while the strip is on its way: a quiet placeholder of the same height. */
export function NeedsStripWaiting() {
  return <div className="skel" aria-hidden="true" style={{ height: 76, borderRadius: 18 }} />;
}
