"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import * as m from "@/messages/pairs";
import { assertPermission } from "@/platform/auth/current-staff";
import { decodeMessage, type Localized } from "@/platform/i18n/language";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { arrangeDay, type CoverIntent } from "@/modules/substitutions/data/arrange-day";
import { findCommand, type CommandReceipt } from "@/modules/substitutions/data/cover-repo";
import {
  clearCoverPolicy,
  upsertCoverPolicy,
} from "@/modules/substitutions/data/policies-repo";
import {
  idleCoverState,
  refusalMessages,
  toCoverReceipt,
  type CoverReceipt,
  type CoverState,
} from "@/modules/substitutions/domain/cover-state";
import { coverPolicySchema } from "@/modules/substitutions/domain/policies";
import { dispatchStaffNotices } from "@/modules/staff-notices/data/dispatcher";
import { createAdminClient } from "@/platform/supabase/admin";
import { PERIOD_COUNT } from "@/modules/timetable/domain/parse-timetable";
import {
  idleSubsState,
  type SubsState,
} from "@/modules/substitutions/domain/form-state";

/*
 * Every change to cover is one command (P3, Gate E).
 *
 * "Save absence & arrange cover", "back at school", "assign this teacher",
 * "release this duty" and "arrange again" all go the same way: the server
 * reads the day, applies the intent in memory, works out the whole day's
 * cover and hands it to `commit_cover_command`, which validates and commits it
 * — absence, duties and notice intents — as one transaction, or refuses it.
 *
 * Each form carries a submission id minted once by the browser and the day's
 * revision as the page showed it. The same id again returns the first receipt
 * (a double click, a lost response); a different id against an older revision
 * is stale and nothing is written.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function refused(reason: string): CoverState {
  return {
    status: reason === "stale" ? "stale" : reason === "failed" ? "error" : "refused",
    message: refusalMessages[reason] ?? refusalMessages.failed,
    receipt: null,
  };
}

function toReceipt(receipt: CommandReceipt): CoverReceipt {
  return toCoverReceipt(receipt);
}

function intentFrom(formData: FormData): CoverIntent | null {
  const kind = (formData.get("intent") ?? "").toString();
  const staffProfileId = (formData.get("staffProfileId") ?? "").toString();
  const needKey = (formData.get("needKey") ?? "").toString();
  const coveringStaffId = (formData.get("coveringStaffId") ?? "").toString();

  switch (kind) {
    case "absence": {
      const periods = formData
        .getAll("periods")
        .map((value) => Number(value.toString()))
        .filter((value) => Number.isInteger(value) && value >= 0 && value < PERIOD_COUNT);
      if (!UUID.test(staffProfileId) || periods.length === 0) return null;
      return { kind, staffProfileId, periods: [...new Set(periods)].sort((a, b) => a - b) };
    }
    case "clear_absence":
      return UUID.test(staffProfileId) ? { kind, staffProfileId } : null;
    case "assign":
      return needKey && UUID.test(coveringStaffId) ? { kind, needKey, coveringStaffId } : null;
    case "release":
      return needKey ? { kind, needKey } : null;
    case "refresh":
      return { kind };
    default:
      return null;
  }
}

/** The one cover command. Every cover form posts here. */
export async function coverCommandAction(
  _previous: CoverState,
  formData: FormData,
): Promise<CoverState> {
  const actor = await assertPermission("substitutions:manage");

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return { ...idleCoverState, status: "error", message: m.noSessionFound };

  const commandId = (formData.get("commandId") ?? "").toString();
  const day = (formData.get("day") ?? "").toString();
  const expectedDayRevision = Number((formData.get("dayRevision") ?? "").toString());
  const intent = intentFrom(formData);

  if (!UUID.test(commandId) || !DAY.test(day) || !Number.isInteger(expectedDayRevision) || !intent) {
    return refused("bad_request");
  }

  let outcome;
  try {
    outcome = await arrangeDay({
      actorStaffId: actor.id,
      sessionLabel,
      day,
      commandId,
      intent,
      expectedDayRevision,
    });
  } catch {
    // Not "nothing happened": the commit may have landed before the error.
    // The screen asks `checkCoverCommandAction` before it says so.
    return refused("failed");
  }

  if (!outcome.ok) {
    if (outcome.reason === "stale") revalidatePath("/substitutions");
    return refused(outcome.reason);
  }

  revalidatePath("/substitutions");
  revalidatePath("/teach");

  // Notices go out after the response, never inside the commit: a provider
  // outage cannot undo a valid plan (P4). The nightly job is the safety net.
  if (outcome.notices_queued > 0) {
    after(() => dispatchStaffNotices({ max: 20 }).catch(() => undefined));
  }

  return { status: "saved", message: null, receipt: toReceipt(outcome) };
}

/* ------------------------------------------------------------- notices */

/**
 * A person settles a notice the machine could not: it arrived (they rang
 * and checked), or send it again knowing it may be a duplicate. Recorded as
 * theirs. An Unknown is never re-sent without this (P4).
 */
export async function reconcileNoticeAction(formData: FormData) {
  const actor = await assertPermission("substitutions:manage");
  const noticeId = (formData.get("noticeId") ?? "").toString();
  const resolution = (formData.get("resolution") ?? "").toString();
  if (!UUID.test(noticeId) || !["confirmed_received", "resend"].includes(resolution)) return;

  const { data } = await createAdminClient().rpc("reconcile_staff_notice", {
    p_notice: noticeId,
    p_actor: actor.id,
    p_resolution: resolution,
  });

  if ((data as { ok?: boolean } | null)?.ok && resolution === "resend") {
    after(() => dispatchStaffNotices({ noticeId }).catch(() => undefined));
  }
  revalidatePath("/substitutions");
}

/** Send whatever is waiting now, rather than at the next change or the morning job. */
export async function sendNoticesNowAction() {
  await assertPermission("substitutions:manage");
  await dispatchStaffNotices({ max: 20 });
  revalidatePath("/substitutions");
}

/**
 * The two switches an administrator can throw without deleting anything:
 * stop new cover commands, stop sending notices. Committed duties, notices and
 * their history stay readable either way (PLAN §22, rollback order).
 */
export async function setCoverSwitchAction(formData: FormData) {
  const actor = await assertPermission("jobs:run");
  const key = (formData.get("key") ?? "").toString();
  const enabled = formData.get("enabled") === "true";
  if (!["cover_command", "staff_notice_dispatch"].includes(key)) return;

  await createAdminClient()
    .from("runtime_flags")
    .update({ enabled, updated_by: actor.id, updated_at: new Date().toISOString() })
    .eq("key", key);
  revalidatePath("/substitutions/rules");
  revalidatePath("/substitutions");
}

/**
 * Did this submission commit? Asked by the screen when an answer never came
 * back, before it offers to try again — a lost response is not a failure (P3).
 * Only the person who sent it gets its receipt.
 */
export async function checkCoverCommandAction(commandId: string): Promise<CoverState> {
  const actor = await assertPermission("substitutions:manage");
  if (!UUID.test(commandId)) return refused("bad_request");

  const receipt = await findCommand(commandId, actor.id);
  return receipt
    ? { status: "saved", message: null, receipt: toReceipt(receipt) }
    : idleCoverState;
}

/* ------------------------------------------------------------ policies */

function fieldErrorsFrom(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): Localized {
  return decodeMessage(error.issues[0]?.message ?? "");
}

function numbersFrom(formData: FormData, field: string): number[] {
  return formData
    .getAll(field)
    .map((value) => Number(value.toString()))
    .filter((value) => Number.isInteger(value));
}

export async function saveCoverPolicyAction(
  _previous: SubsState,
  formData: FormData,
): Promise<SubsState> {
  const actor = await assertPermission("substitutions:manage");

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return { status: "error", message: m.noSessionFound };

  const parsed = coverPolicySchema.safeParse({
    staffProfileId: (formData.get("staffProfileId") ?? "").toString(),
    allowedPeriods: numbersFrom(formData, "allowedPeriods"),
    coverRole: (formData.get("coverRole") ?? "normal").toString(),
    maxAutoCovers: (formData.get("maxAutoCovers") ?? "2").toString(),
    note: (formData.get("note") ?? "").toString(),
  });

  if (!parsed.success) return { status: "error", message: fieldErrorsFrom(parsed.error) };

  try {
    await upsertCoverPolicy(parsed.data, sessionLabel, actor.userId);
  } catch {
    return { status: "error", message: m.notSaved };
  }

  revalidatePath("/substitutions/policies");
  return { ...idleSubsState, status: "saved" };
}

export async function clearCoverPolicyAction(formData: FormData) {
  await assertPermission("substitutions:manage");

  const sessionLabel = await resolveSessionLabel();
  const staffProfileId = (formData.get("staffProfileId") ?? "").toString();
  if (!sessionLabel || !staffProfileId) return;

  await clearCoverPolicy(staffProfileId, sessionLabel);
  revalidatePath("/substitutions/policies");
}
