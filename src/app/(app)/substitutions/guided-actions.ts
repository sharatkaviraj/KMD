"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { assertPermission } from "@/platform/auth/current-staff";
import { assertSessionWritable } from "@/platform/auth/test-session-access";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { arrangeDay } from "@/modules/substitutions/data/arrange-day";
import { findCommand } from "@/modules/substitutions/data/cover-repo";
import {
  approvedLeaveOn,
  buildGuidedPreview,
  readCommitted,
  type CommittedLesson,
  type GuidedPreview,
} from "@/modules/substitutions/data/guided";
import { toCoverReceipt, type CoverReceipt } from "@/modules/substitutions/domain/cover-state";
import { absencePeriods, normalizeChoices, type GuidedChoice } from "@/modules/substitutions/domain/guided";
import type { SaveRefusal } from "@/modules/substitutions/domain/guided-flow";
import { dispatchStaffNotices } from "@/modules/staff-notices/data/dispatcher";
import { isIsoDay } from "@/platform/dates";
import { assertNotPreviewing } from "@/vx/view-as";

/*
 * The guided cover flow (review C01): look, then confirm.
 *
 * `previewGuidedCoverAction` works the day out with the absence and the
 * coordinator's choices and writes nothing. `confirmGuidedCoverAction` is the
 * one write — the same cover command every cover screen uses (`arrangeDay` →
 * `commit_cover_command`), so the absence, every duty and every staff notice
 * commit together or not at all. It commits only the plan that was reviewed:
 * the day's revision and the plan's fingerprint must both still match.
 *
 * Every write here, like every cover write, needs `substitutions:manage`
 * (administrators and the academic coordinator) — this flow does not widen it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINGERPRINT = /^\d{1,4}-[0-9a-z]{1,16}$/;

export type GuidedPreviewResult =
  | { ok: true; preview: GuidedPreview }
  | { ok: false; reason: "no_session" | "no_timetable" | "no_timetable_day" | "bad_request" | "failed" };

export type GuidedSaved = { receipt: CoverReceipt; committed: CommittedLesson[] | null };

export type GuidedConfirmResult =
  | ({ status: "saved" } & GuidedSaved)
  | { status: "stale" }
  | { status: "plan_changed" }
  | { status: "refused"; reason: SaveRefusal }
  /** No definite answer: it may have committed. The screen checks before offering a retry. */
  | { status: "unknown" };

export type GuidedCheckResult = ({ status: "saved" } & GuidedSaved) | { status: "not_found" };

type Absence = { day: string; staffProfileId: string; periods: number[] };

function absenceFrom(input: { day?: unknown; staffProfileId?: unknown; periods?: unknown }): Absence | null {
  if (typeof input.day !== "string" || !isIsoDay(input.day)) return null;
  if (typeof input.staffProfileId !== "string" || !UUID.test(input.staffProfileId)) return null;
  if (!Array.isArray(input.periods) || input.periods.some((period) => typeof period !== "number")) return null;
  const periods = absencePeriods("periods", input.periods as number[]);
  if (periods.length === 0 || periods.length !== new Set(input.periods).size) return null;
  return { day: input.day, staffProfileId: input.staffProfileId, periods };
}

/** Work the day out with this absence and these choices. Writes nothing. */
export async function previewGuidedCoverAction(input: {
  day: string;
  staffProfileId: string;
  periods: number[];
  choices?: GuidedChoice[];
}): Promise<GuidedPreviewResult> {
  const actor = await assertPermission("substitutions:manage");
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return { ok: false, reason: "no_session" };
  await assertSessionWritable(actor, sessionLabel);

  const absence = absenceFrom(input);
  const choices = normalizeChoices(input.choices);
  if (!absence || !choices) return { ok: false, reason: "bad_request" };

  try {
    return await buildGuidedPreview({ sessionLabel, ...absence, choices });
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Save the reviewed plan: the absence, every duty and their notices, as one command. */
export async function confirmGuidedCoverAction(input: {
  commandId: string;
  day: string;
  dayRevision: number;
  staffProfileId: string;
  periods: number[];
  choices: GuidedChoice[];
  fingerprint: string;
}): Promise<GuidedConfirmResult> {
  const actor = await assertPermission("substitutions:manage");
  await assertNotPreviewing();
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return { status: "refused", reason: "bad_request" };
  await assertSessionWritable(actor, sessionLabel);

  const absence = absenceFrom(input);
  const choices = normalizeChoices(input.choices);
  if (
    !absence ||
    !choices ||
    typeof input.commandId !== "string" ||
    !UUID.test(input.commandId) ||
    !Number.isInteger(input.dayRevision) ||
    input.dayRevision < 0 ||
    typeof input.fingerprint !== "string" ||
    !FINGERPRINT.test(input.fingerprint)
  ) {
    return { status: "refused", reason: "bad_request" };
  }

  let outcome;
  try {
    const leave = await approvedLeaveOn(sessionLabel, absence.day);
    delete leave[absence.staffProfileId];
    outcome = await arrangeDay({
      actorStaffId: actor.id,
      sessionLabel,
      day: absence.day,
      commandId: input.commandId,
      intent: { kind: "absence", staffProfileId: absence.staffProfileId, periods: absence.periods, choices },
      expectedDayRevision: input.dayRevision,
      expectedPlan: input.fingerprint,
      onLeave: leave,
    });
  } catch {
    // Not "nothing happened": the commit may have landed before the error.
    return { status: "unknown" };
  }

  if (!outcome.ok) {
    switch (outcome.reason) {
      case "stale":
        revalidatePath("/substitutions");
        revalidatePath("/timetable");
        return { status: "stale" };
      case "plan_changed":
      // The database found a cover that no longer holds: the day moved too.
      case "invalid":
        return { status: "plan_changed" };
      case "failed":
        return { status: "unknown" };
      default:
        return { status: "refused", reason: outcome.reason };
    }
  }

  revalidatePath("/substitutions");
  revalidatePath("/timetable");
  revalidatePath("/teach");

  // Notices go out after the response, never inside the commit, exactly as
  // for every other cover command: the outbox and its switch decide (P4).
  if (outcome.notices_queued > 0) {
    after(() => dispatchStaffNotices({ max: 20 }).catch(() => undefined));
  }

  return {
    status: "saved",
    receipt: toCoverReceipt(outcome),
    committed: await readCommitted(sessionLabel, absence.day, absence.staffProfileId, absence.periods).catch(() => null),
  };
}

/**
 * Did this confirm commit? Asked when its answer never arrived, before the
 * screen offers to try again. Only the person who sent it gets its receipt.
 */
export async function checkGuidedCoverAction(input: {
  commandId: string;
  day: string;
  staffProfileId: string;
  periods: number[];
}): Promise<GuidedCheckResult> {
  const actor = await assertPermission("substitutions:manage");
  await assertNotPreviewing();
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return { status: "not_found" };
  await assertSessionWritable(actor, sessionLabel);
  const absence = absenceFrom(input);
  if (!absence || typeof input.commandId !== "string" || !UUID.test(input.commandId)) return { status: "not_found" };

  // A failed read throws: it is not a statement that nothing was saved.
  const receipt = await findCommand(input.commandId, actor.id);
  if (!receipt) return { status: "not_found" };
  return {
    status: "saved",
    receipt: toCoverReceipt(receipt),
    committed: await readCommitted(sessionLabel, absence.day, absence.staffProfileId, absence.periods).catch(() => null),
  };
}
