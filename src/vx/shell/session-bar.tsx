import { Suspense } from "react";

import type { SessionSwitcherData } from "@/modules/fees/platform/session-context/switcher";
import { MobileSessionPill } from "@/ui/shell/mobile-session-pill";
import { ShellSessionPill, ShellSessionPillSkeleton } from "@/ui/shell/shell-session-pill";

/**
 * The permission-filtered Fees switchers with One's native presentation:
 * a desktop dropdown from 900px and the shared One sheet below it.
 *
 * The list of sessions is a promise resolved inside the boundary, so a cold
 * switcher read (up to 1.2s) never holds the frame — the fees app's reason
 * for `ShellSessionPill`. It is already filtered for the viewer, or for the
 * role an admin is previewing.
 */
export function SessionBar({
  label,
  isTest,
  showLive,
  sessions,
}: {
  label: string;
  isTest: boolean;
  showLive: boolean;
  sessions: Promise<SessionSwitcherData>;
}) {
  return (
    <div className="vx-sessionbar" data-test-session={isTest ? "true" : undefined}>
      <div className="vx-sessionbar-d">
        <Suspense fallback={<ShellSessionPillSkeleton currentLabel={label} isTest={isTest} appearance="one" />}>
          <ShellSessionPill currentLabel={label} isTest={isTest} sessions={sessions} showLive={showLive} appearance="one" />
        </Suspense>
      </div>
      <div className="vx-sessionbar-m">
        <Suspense fallback={<ShellSessionPillSkeleton currentLabel={label} isTest={isTest} appearance="one" />}>
          <MobileSessionPillLoaded label={label} isTest={isTest} sessions={sessions} />
        </Suspense>
      </div>
    </div>
  );
}

async function MobileSessionPillLoaded({
  label,
  isTest,
  sessions,
}: {
  label: string;
  isTest: boolean;
  sessions: Promise<SessionSwitcherData>;
}) {
  const { availableSessions } = await sessions;
  return <MobileSessionPill currentLabel={label} isTest={isTest} initialSessions={availableSessions} appearance="one" />;
}
