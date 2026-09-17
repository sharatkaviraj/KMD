"use server";

import { revalidatePath } from "next/cache";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { roundById } from "@/modules/collection/data/rounds-repo";
import {
  coveredStudentIds,
  createLinks,
  ensureMasterLink,
  markReminded,
  markSent,
  openRound,
  planForRound,
} from "@/modules/collection/data/fan-out-repo";
import { isTooBig } from "@/modules/collection/domain/fan-out";
import type { CollectionState } from "@/modules/collection/domain/form-state";

/**
 * Turning a round into links, from the round's own page.
 *
 * **One button for both "send" and "resume".** A resume *is* "create the
 * groups that are not there yet", so making it the only path means the half
 * that runs after a failure is the same code that ran before it — rather than
 * a second implementation nobody exercises until something has already gone
 * wrong.
 */
export async function createLinksAction(
  _previous: CollectionState,
  formData: FormData,
): Promise<CollectionState> {
  const staff = await requirePermission("collection:manage", "/collection/rounds");
  const roundId = (formData.get("roundId") ?? "").toString();
  const sessionLabel = await resolveSessionLabel();

  if (!roundId || !sessionLabel) {
    return { status: "error", message: m.notSaved };
  }

  const round = await roundById(roundId);
  if (!round) return { status: "error", message: m.notSaved };

  const plan = await planForRound(round, sessionLabel);

  // The cap exists so nobody fans out per-child by accident and mints five
  // hundred tokens. Refused before anything is written, not halfway through.
  if (isTooBig(plan)) return { status: "error", message: m.fanOutTooBig };
  if (plan.ready.length === 0) {
    return { status: "error", message: m.fanOutNoneReady };
  }

  const result = await createLinks(round, plan, staff.userId, sessionLabel);

  // The office's own link over the lot, after the groups rather than with
  // them: it is not a group, has no owner, and covers whatever they cover.
  await ensureMasterLink(round, staff.userId, sessionLabel, coveredStudentIds(plan));

  revalidatePath(`/collection/rounds/${roundId}`);

  // **A partial run is reported as one.** Saying "done" over six of eleven
  // links is how an office finds out in a week that five classes were never
  // asked. The links that were made still work; the message says to run it
  // again for the rest.
  if (result.failed) return { status: "error", message: m.fanOutStopped };

  return { status: "saved", message: m.fanOutMade };
}

/** Turn every one of this round's links on, so its tokens start working. */
export async function openRoundAction(
  _previous: CollectionState,
  formData: FormData,
): Promise<CollectionState> {
  await requirePermission("collection:manage", "/collection/rounds");
  const roundId = (formData.get("roundId") ?? "").toString();
  if (!roundId) return { status: "error", message: m.notSaved };

  await openRound(roundId);
  revalidatePath(`/collection/rounds/${roundId}`);

  return { status: "saved", message: m.saved };
}

/**
 * Write down that a link was handed over, or chased again.
 *
 * **Neither of these sends anything.** VPPS One does not message a parent or a
 * teacher (D-10, D-76); the office hands the link over in WhatsApp itself and
 * ticks it here, so the board reflects what actually happened rather than what
 * this app attempted.
 */
export async function markSentAction(
  _previous: CollectionState,
  formData: FormData,
): Promise<CollectionState> {
  const staff = await requirePermission("collection:manage", "/collection/rounds");
  const requestId = (formData.get("requestId") ?? "").toString();
  const roundId = (formData.get("roundId") ?? "").toString();
  if (!requestId) return { status: "error", message: m.notSaved };

  await markSent(requestId, staff.id);
  revalidatePath(`/collection/rounds/${roundId}`);

  return { status: "saved", message: m.saved };
}

export async function markRemindedAction(
  _previous: CollectionState,
  formData: FormData,
): Promise<CollectionState> {
  const staff = await requirePermission("collection:manage", "/collection/rounds");
  const requestId = (formData.get("requestId") ?? "").toString();
  const roundId = (formData.get("roundId") ?? "").toString();
  const previous = Number.parseInt((formData.get("reminderCount") ?? "0").toString(), 10);
  if (!requestId) return { status: "error", message: m.notSaved };

  await markReminded(requestId, staff.id, Number.isFinite(previous) ? previous : 0);
  revalidatePath(`/collection/rounds/${roundId}`);

  return { status: "saved", message: m.saved };
}
