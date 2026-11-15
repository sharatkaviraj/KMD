import "server-only";

import { assertActorStaff } from "@/platform/auth/verified-actor";
import { withVerifiedActor } from "@/platform/auth/verified-actor-context";
import { schoolToday } from "@/platform/dates";
import { sessionLabelForActor } from "@/modules/academics/data/academics-repo";
import { listStaffAs } from "@/modules/staff/data/staff-repo";
import { absencesOnAs } from "@/modules/substitutions/data/absences-repo";
import { dutiesOnAs, liveOnly } from "@/modules/substitutions/data/cover-repo";
import { currentBells } from "@/modules/substitutions/data/school-rules-repo";
import { DEFAULT_PERIOD_COUNT } from "@/modules/substitutions/domain/engine";
import { askedLeaveForActor, boardForActor } from "@/vx/screens/admin/data";
import type { McpActor, ToolRuntime } from "@/modules/mcp/domain/tools";

/**
 * The AI connection's tools, wired to the readers the One screens use — each
 * through its verified-actor twin, which repeats the screen's own check
 * against the actor the pipeline resolved this call. The actor arrives typed
 * as the portable core's `McpActor`; `assertActorStaff` refuses anything the
 * resolver (`staff.ts`) did not produce.
 *
 * Every read runs inside `withVerifiedActor`, so the fees-bridge roster
 * projection knows whose read it is (class names and sessions are roster
 * reads under the bridge).
 */
async function asActor<T>(actor: McpActor, read: (verified: ReturnType<typeof assertActorStaff>) => Promise<T>): Promise<T> {
  const verified = assertActorStaff(actor);
  return withVerifiedActor(verified, () => read(verified));
}

export const toolRuntime: ToolRuntime = {
  today: () => schoolToday(),

  schoolDay: (actor, sessionLabel, day) =>
    asActor(actor, async (verified) => {
      const [board, absences, duties] = await Promise.all([
        boardForActor(verified, sessionLabel, day),
        absencesOnAs(verified, sessionLabel, day, { withReason: false }).catch(() => null),
        // The cover half needs `substitutions:view`; without it the summary says so instead of failing.
        dutiesOnAs(verified, sessionLabel, day).catch(() => null),
      ]);
      const unavailable = [...board.unavailable];
      if (!absences) unavailable.push("absences");
      if (!duties) unavailable.push("cover");
      return {
        schoolOpen: board.schoolOpen,
        timetableRuns: board.timetableRuns,
        rows: board.rows.map((row) => ({
          label: row.label,
          recorded: row.recorded,
          roll: row.roll,
          present: row.present,
          absent: row.absent,
          halfDay: row.halfDay,
        })),
        staffAway: absences?.length ?? 0,
        uncovered: liveOnly(duties ?? [])
          .filter((duty) => duty.status === "needs_help")
          .sort((a, b) => a.period - b.period)
          .map((duty) => ({ period: duty.period, classLabels: duty.classLabels })),
        unavailable,
      };
    }),

  absences: (actor, sessionLabel, day) =>
    asActor(actor, async (verified) => {
      const [absences, bells] = await Promise.all([
        absencesOnAs(verified, sessionLabel, day, { withReason: false }),
        currentBells(sessionLabel).catch(() => null),
      ]);
      return {
        periodCount: bells?.periods.length || DEFAULT_PERIOD_COUNT,
        absences: absences.map((absence) => ({ staffName: absence.staffName, periods: absence.periods })),
      };
    }),

  cover: (actor, sessionLabel, day) =>
    asActor(actor, async (verified) => {
      const [duties, staff] = await Promise.all([dutiesOnAs(verified, sessionLabel, day), listStaffAs(verified)]);
      const name = new Map(staff.map((person) => [person.id, person.displayName]));
      return {
        duties: liveOnly(duties)
          .sort((a, b) => a.period - b.period)
          .map((duty) => ({
            period: duty.period,
            classLabels: duty.classLabels,
            absentNames: duty.absentStaffIds.map((id) => name.get(id) ?? "—"),
            substituteName: duty.coveringStaffId ? (name.get(duty.coveringStaffId) ?? "—") : null,
            status: duty.status === "assigned" ? ("assigned" as const) : ("needs_help" as const),
          })),
      };
    }),

  pendingLeave: (actor, sessionLabel) =>
    asActor(actor, async (verified) => {
      const rows = await askedLeaveForActor(verified, sessionLabel);
      return rows.map((row) => ({ staffName: row.staffName, fromDay: row.fromDay, toDay: row.toDay, span: row.span }));
    }),
};

/**
 * Any other read as this actor (D-639). Veer Patta AI's staff desks answer a
 * WhatsApp message, where no cookie names the reader, and under the fees
 * bridge the session list, class names and children's names are roster reads
 * the projection refuses without one. The desk resolves the person afresh for
 * every message (`resolveStaffForUser`), then reads as them here.
 */
export function readAsActor<T>(actor: McpActor, read: () => Promise<T>): Promise<T> {
  return asActor(actor, () => read());
}

/** Step 6: the session for this actor, by the server's own rules (never sorted, never from arguments). */
export function sessionForActor(actor: McpActor): Promise<string | null> {
  return asActor(actor, (verified) => sessionLabelForActor(verified));
}
