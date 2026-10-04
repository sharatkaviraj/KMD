import "server-only";

import { can, type StaffRole } from "@/platform/auth/permissions";
import { createAdminClient } from "@/platform/supabase/admin";
import { DUTY_COLUMNS, toDuty, type CoverDuty } from "@/modules/substitutions/data/cover-repo";

/**
 * A cover duty as one teacher sees it (P5).
 *
 * The link a teacher opens — from WhatsApp or from Today — names one duty
 * row. Rows are revisions: a duty that changed or was cancelled after the
 * notice went out is a row that is no longer live. So the page never shows a
 * stale instruction as if it stood: it resolves the row to the current state
 * of the same need, and says plainly when the viewer is no longer on it.
 *
 * Reads go through the service role, after the page has authenticated the
 * viewer; who may see what is decided here, from the rows, not from the link.
 * A forwarded link gives the person it was forwarded to nothing.
 */

type Row = Parameters<typeof toDuty>[0];

export type DutyView =
  | { kind: "none" }
  | {
      kind: "holder" | "former_holder" | "manager";
      /** The row the link named. */
      linked: CoverDuty;
      /** The live row for the same need now, if there is one. */
      current: CoverDuty | null;
    };

export async function dutyById(id: string): Promise<CoverDuty | null> {
  const { data, error } = await createAdminClient()
    .from("cover_duties")
    .select(DUTY_COLUMNS)
    .eq("id", id)
    .maybeSingle<Row>();
  if (error) throw new Error(`Could not read that duty: ${error.message}`);
  return data ? toDuty(data) : null;
}

async function currentFor(duty: CoverDuty): Promise<CoverDuty | null> {
  if (duty.status === "assigned" || duty.status === "needs_help") return duty;
  const { data, error } = await createAdminClient()
    .from("cover_duties")
    .select(DUTY_COLUMNS)
    .eq("session_label", duty.sessionLabel)
    .eq("day", duty.day)
    .eq("need_key", duty.needKey)
    .in("status", ["assigned", "needs_help"])
    .maybeSingle<Row>();
  if (error) throw new Error(`Could not read the current duty: ${error.message}`);
  return data ? toDuty(data) : null;
}

/**
 * What this viewer may see of the duty a link names.
 *
 * - the person who holds it now: everything, and the buttons;
 * - the person who held the row the link named: that it changed or was
 *   cancelled, and nothing they are not owed;
 * - somebody who manages or follows cover: the duty;
 * - anybody else: nothing at all, not even that it exists.
 */
export async function viewDuty(
  id: string,
  viewer: { id: string; role: StaffRole },
): Promise<DutyView> {
  const linked = await dutyById(id);
  if (!linked) return { kind: "none" };

  const current = await currentFor(linked);

  if (current?.status === "assigned" && current.coveringStaffId === viewer.id) {
    return { kind: "holder", linked, current };
  }
  if (linked.coveringStaffId === viewer.id) {
    return { kind: "former_holder", linked, current };
  }
  if (can(viewer, "substitutions:view") && viewer.role !== "teacher") {
    return { kind: "manager", linked, current };
  }
  return { kind: "none" };
}

/** A teacher's live duties on a day, for Today. */
export async function myDutiesOn(
  staffId: string,
  sessionLabel: string,
  day: string,
): Promise<CoverDuty[]> {
  const { data, error } = await createAdminClient()
    .from("cover_duties")
    .select(DUTY_COLUMNS)
    .eq("session_label", sessionLabel)
    .eq("day", day)
    .eq("covering_staff_id", staffId)
    .eq("status", "assigned")
    .order("period")
    .returns<Row[]>();
  if (error) throw new Error(`Could not read your cover duties: ${error.message}`);
  return data.map(toDuty);
}

export type DutyResponse = "acknowledge" | "cannot_cover";

export type RespondOutcome =
  | { ok: true; already?: boolean }
  | { ok: false; reason: "not_found" | "not_yours" | "over" | "bad_request" };

/** The teacher's answer. Only the duty's current holder, only while it is live. */
export async function respondToDuty(
  dutyId: string,
  staffId: string,
  response: DutyResponse,
  note?: string | null,
): Promise<RespondOutcome> {
  const { data, error } = await createAdminClient().rpc("respond_to_cover_duty", {
    p_duty: dutyId,
    p_staff: staffId,
    p_response: response,
    p_note: note ?? null,
  });
  if (error) throw new Error(`Could not record that: ${error.message}`);
  return data as RespondOutcome;
}
