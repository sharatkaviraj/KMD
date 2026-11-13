"use server";

import { revalidatePath } from "next/cache";

import { decideParentSuggestions, undoParentSuggestion } from "@/modules/whatsapp/data/parent-suggestions";
import {
  decidedMessage,
  decideRefusal,
  undoneMessage,
  undoRefusal,
  type DecidedVia,
  type RegisterMark,
  type SuggestionKind,
} from "@/modules/whatsapp/domain/parent-suggestions";
import { assertStaff } from "@/platform/auth/current-staff";
import { canAny } from "@/platform/auth/permissions";
import { assertNotPreviewing } from "@/vx/view-as";
import type { Pair } from "@/vx/text";

/*
 * A parent's suggestions (D-598), decided where they show: Needs you and the
 * class teacher's Today. Every write is the database's
 * (`decide_parent_suggestions`, `undo_parent_suggestion`), as the member of
 * staff deciding, and it checks each suggestion again: still waiting, not
 * past its time, and this person may decide it (the class teacher for a
 * child's absence, the office for the rest, an admin for any, always of the
 * session's own kind). Here: someone signed in who could decide one, never
 * an admin looking as someone else, and nothing but ids from the browser.
 */

const MAY_DECIDE = ["attendance:mark", "attendance:correct", "collection:manage", "fees:manage"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACES: readonly DecidedVia[] = ["needs_you", "teacher_home", "register"];
/** One tap's worth: "Mark all" covers a class's morning, never the whole school's year. */
const MAX_AT_ONCE = 60;

const FAILED: Pair = { en: "That did not go through. Nothing was changed.", hi: "यह नहीं हो पाया। कुछ नहीं बदला।" };

export type ParentRefusal = { id: string; message: Pair };

export type ParentDecideResult = { ok: true; decided: string[]; refused: ParentRefusal[]; message: Pair } | { ok: false; refused: ParentRefusal[]; message: Pair };

export type ParentUndoResult = { ok: true; undone: string[]; refused: ParentRefusal[]; message: Pair } | { ok: false; refused: ParentRefusal[]; message: Pair };

function idsFrom(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === "string" && UUID.test(id)))] : [];
}

/** Everything that shows a parent's note, a register's start or an Admissions card. */
function refresh() {
  for (const path of ["/inbox", "/", "/teach", "/teach/attendance", "/admissions"]) revalidatePath(path);
}

export async function decideParentSuggestionsAction(input: {
  ids: string[];
  decision: "apply" | "dismiss";
  /** How an applied absence starts the child on the register. */
  mark?: RegisterMark;
  via: DecidedVia;
  /** For the answer's words only: the database decides what each one is. */
  kind?: SuggestionKind;
  childName?: string | null;
}): Promise<ParentDecideResult> {
  const staff = await assertStaff();
  if (!canAny(staff, MAY_DECIDE)) return { ok: false, refused: [], message: decideRefusal("not_permitted") };
  await assertNotPreviewing();
  const ids = idsFrom(input?.ids);
  const decision = input?.decision;
  const mark = input?.mark;
  if (
    ids.length === 0 ||
    ids.length > MAX_AT_ONCE ||
    (decision !== "apply" && decision !== "dismiss") ||
    (mark !== undefined && mark !== "leave" && mark !== "absent") ||
    !PLACES.includes(input?.via)
  ) {
    return { ok: false, refused: [], message: FAILED };
  }

  const result = await decideParentSuggestions({ actorStaffId: staff.id, ids, decision, mark, via: input.via });
  refresh();
  if (!result.ok) return { ok: false, refused: [], message: decideRefusal(result.reason) };

  const decided = result.results.filter((one) => one.outcome === "applied" || one.outcome === "dismissed").map((one) => one.id);
  const refused = result.results.filter((one) => !decided.includes(one.id)).map((one) => ({ id: one.id, message: decideRefusal(one.outcome, one.reason) }));
  if (decided.length === 0) return { ok: false, refused, message: refused[0]?.message ?? FAILED };
  const kind = result.results.find((one) => one.kind)?.kind ?? input.kind ?? "absence";
  return { ok: true, decided, refused, message: decidedMessage({ decision, kind, mark: mark ?? "leave", count: decided.length, childName: input.childName ?? null }) };
}

/** Take decisions back, one by one, as this member of staff: each waits again until its time has passed. */
export async function undoParentSuggestionsAction(input: { ids: string[] }): Promise<ParentUndoResult> {
  const staff = await assertStaff();
  if (!canAny(staff, MAY_DECIDE)) return { ok: false, refused: [], message: undoRefusal("not_permitted") };
  await assertNotPreviewing();
  const ids = idsFrom(input?.ids);
  if (ids.length === 0 || ids.length > MAX_AT_ONCE) return { ok: false, refused: [], message: FAILED };

  const undone: string[] = [];
  const refused: ParentRefusal[] = [];
  let waiting: "pending" | "undone" = "pending";
  for (const id of ids) {
    const result = await undoParentSuggestion({ actorStaffId: staff.id, id });
    if (result.ok) {
      undone.push(id);
      if (result.status === "undone") waiting = "undone";
    } else {
      refused.push({ id, message: undoRefusal(result.reason) });
    }
  }
  refresh();
  if (undone.length === 0) return { ok: false, refused, message: refused[0]?.message ?? FAILED };
  return { ok: true, undone, refused, message: undoneMessage(waiting, undone.length) };
}
