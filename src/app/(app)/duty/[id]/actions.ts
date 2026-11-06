"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import * as m from "@/messages/pairs";
import { assertStaff } from "@/platform/auth/current-staff";
import { t } from "@/platform/i18n/language";
import { respondToDuty, type DutyResponse } from "@/modules/substitutions/data/duty-repo";
import { idleSubsState, type SubsState } from "@/modules/substitutions/domain/form-state";
import { dispatchStaffNotices } from "@/modules/staff-notices/data/dispatcher";

/*
 * The teacher's two answers to a cover duty (P5). Both are POSTs — a link
 * preview, a scanner or a refresh can open the page and change nothing — and
 * both are checked by the database against the duty as it is now: only its
 * current holder may answer, only while it is live and its period has not
 * ended. Answering twice is the same as answering once.
 *
 * No permission beyond being signed-in staff is asked, because the right to
 * answer is holding the duty, and that is a fact about the row, not the role.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const refusals = {
  not_found: t("यह व्यवस्था नहीं मिली।", "That duty was not found."),
  not_yours: t(
    "यह व्यवस्था अब आपकी नहीं है — पेज फिर से खोलें।",
    "This duty is no longer yours — reload the page to see what changed.",
  ),
  over: t("यह पीरियड समाप्त हो चुका है।", "This period has already ended."),
  bad_request: m.notSaved,
};

async function answer(
  actor: { id: string },
  formData: FormData,
  response: DutyResponse,
): Promise<SubsState> {
  const dutyId = (formData.get("dutyId") ?? "").toString();
  const note = (formData.get("note") ?? "").toString();
  if (!UUID.test(dutyId)) return { status: "error", message: m.notSaved };

  let outcome;
  try {
    outcome = await respondToDuty(dutyId, actor.id, response, note);
  } catch {
    return { status: "error", message: m.notSaved };
  }

  if (!outcome.ok) return { status: "error", message: refusals[outcome.reason] };

  // "Cannot cover" tells whoever arranges cover; send that now.
  if (response === "cannot_cover" && !outcome.already) {
    after(() => dispatchStaffNotices({ max: 10 }).catch(() => undefined));
  }

  revalidatePath(`/duty/${dutyId}`);
  revalidatePath("/teach");
  revalidatePath("/substitutions");
  return { ...idleSubsState, status: "saved" };
}

export async function acknowledgeDutyAction(_previous: SubsState, formData: FormData): Promise<SubsState> {
  const actor = await assertStaff();
  return answer(actor, formData, "acknowledge");
}

export async function cannotCoverAction(_previous: SubsState, formData: FormData): Promise<SubsState> {
  const actor = await assertStaff();
  return answer(actor, formData, "cannot_cover");
}
