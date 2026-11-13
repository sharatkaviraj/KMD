import "server-only";

import type { AbsenceReason } from "@/modules/whatsapp/domain/helper-absence";
import {
  suggestionDays,
  type DecidedVia,
  type RegisterMark,
  type SuggestionDraft,
  type SuggestionKind,
  type SuggestionRoute,
  type SuggestionStatus,
} from "@/modules/whatsapp/domain/parent-suggestions";
import { chunkArray, fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { logWarn } from "@/platform/observability/log";
import { whatsappDb } from "@/platform/whatsapp/store";

/**
 * A parent's suggestions (D-598): what Veer Patta AI read in a WhatsApp
 * message that may belong in a record, waiting for a person at school. The
 * helper adds them, staff decide them, and every write a decision makes is
 * the database's (`decide_parent_suggestions`, `undo_parent_suggestion`), as
 * the member of staff deciding, who it re-checks may. Service role: the
 * table is closed to signed-in readers, and every caller has already decided
 * who is asking.
 */

type Db = ReturnType<typeof whatsappDb>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The helper's one write about a child: the suggestion's id, or null when there is nothing to ask or it could not be kept. */
export async function addParentSuggestion(draft: SuggestionDraft, db: Db = whatsappDb()): Promise<string | null> {
  try {
    const { data, error } = await db.rpc("add_parent_suggestion", {
      p: {
        kind: draft.kind,
        session_label: draft.sessionLabel,
        student_id: draft.studentId,
        parent_reply_id: draft.parentReplyId,
        practice: draft.practice,
        payload: draft.payload,
      },
    });
    if (error) {
      logWarn("whatsapp.parent_suggestion_not_kept", { kind: draft.kind, error: error.message.slice(0, 120) });
      return null;
    }
    return typeof data === "string" && UUID.test(data) ? data : null;
  } catch (caught) {
    logWarn("whatsapp.parent_suggestion_not_kept", { kind: draft.kind, error: caught instanceof Error ? caught.message.slice(0, 120) : "unknown" });
    return null;
  }
}

export type SuggestionRow = {
  id: string;
  kind: SuggestionKind;
  status: SuggestionStatus;
  route: SuggestionRoute;
  sessionLabel: string;
  studentId: string | null;
  classId: string | null;
  assignedStaffId: string | null;
  payload: Record<string, unknown>;
  expiresAt: string;
  createdAt: string;
  practice: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  decidedVia: DecidedVia | null;
  decision: Record<string, unknown> | null;
  /** The last time a decision on it was taken back: a suggestion that waits again is a new item to a screen. */
  undoneAt: string | null;
  /** The hand-off it came with, in Messages: the parent's words, WhatsApp name and number. */
  handoff: { body: string; fromName: string | null; fromPhone: string | null } | null;
};

type RawRow = {
  id: string;
  kind: SuggestionKind;
  status: SuggestionStatus;
  route: SuggestionRoute;
  session_label: string;
  student_id: string | null;
  class_id: string | null;
  assigned_staff_id: string | null;
  payload: Record<string, unknown> | null;
  expires_at: string;
  created_at: string;
  practice: boolean;
  decided_by: string | null;
  decided_at: string | null;
  decided_via: DecidedVia | null;
  decision: Record<string, unknown> | null;
  undone_at: string | null;
  parent_replies: { body: string | null; from_name: string | null; from_phone: string | null } | null;
};

const COLUMNS =
  "id, kind, status, route, session_label, student_id, class_id, assigned_staff_id, payload, expires_at, created_at, practice, decided_by, decided_at, decided_via, decision, undone_at, parent_replies(body, from_name, from_phone)";

function rowOf(raw: RawRow): SuggestionRow {
  const handoff = raw.parent_replies;
  return {
    id: raw.id,
    kind: raw.kind,
    status: raw.status,
    route: raw.route,
    sessionLabel: raw.session_label,
    studentId: raw.student_id,
    classId: raw.class_id,
    assignedStaffId: raw.assigned_staff_id,
    payload: raw.payload ?? {},
    expiresAt: raw.expires_at,
    createdAt: raw.created_at,
    practice: raw.practice,
    decidedBy: raw.decided_by,
    decidedAt: raw.decided_at,
    decidedVia: raw.decided_via,
    decision: raw.decision,
    undoneAt: raw.undone_at,
    handoff: handoff ? { body: handoff.body ?? "", fromName: handoff.from_name, fromPhone: handoff.from_phone } : null,
  };
}

type Wanted = { waitingAfter: string } | { decidedSince: string };

/** The session's suggestions, waiting or decided, as wide as `classIds` allows (every class when it is absent). */
async function readRows(sessionLabel: string, wanted: Wanted, classIds: readonly string[] | undefined, db: Db): Promise<SuggestionRow[]> {
  const query = () => {
    const base = db.from("parent_suggestions").select(COLUMNS).eq("session_label", sessionLabel);
    return "waitingAfter" in wanted
      ? base.eq("status", "pending").gt("expires_at", wanted.waitingAfter)
      : base.in("status", ["applied", "dismissed"]).gte("decided_at", wanted.decidedSince);
  };
  if (classIds) {
    if (classIds.length === 0) return [];
    const { data, error } = await fetchInChunks<RawRow>(classIds, IN_FILTER_CHUNK_SIZE, (chunk) => query().in("class_id", chunk).returns<RawRow[]>());
    if (error) throw error;
    return data.map(rowOf);
  }
  const { data, error } = await query().limit(400).returns<RawRow[]>();
  if (error) throw error;
  return (data ?? []).map(rowOf);
}

/**
 * The suggestions still waiting in this session, oldest first: not decided,
 * and not past their time. `classIds` keeps it to those classes' children
 * (a class teacher's own); without it, every one.
 */
export async function waitingSuggestions(
  sessionLabel: string,
  options: { classIds?: readonly string[]; now?: Date } = {},
  db: Db = whatsappDb(),
): Promise<SuggestionRow[]> {
  const rows = await readRows(sessionLabel, { waitingAfter: (options.now ?? new Date()).toISOString() }, options.classIds, db);
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The suggestions decided since `sinceIso` (today's start, for "Decided today"), latest first. */
export async function decidedSince(
  sessionLabel: string,
  sinceIso: string,
  options: { classIds?: readonly string[] } = {},
  db: Db = whatsappDb(),
): Promise<SuggestionRow[]> {
  const rows = await readRows(sessionLabel, { decidedSince: sinceIso }, options.classIds, db);
  return rows.sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""));
}

/** A child's absence still waiting on a register's day (D-601): no parent's words, only what the line needs. */
export type WaitingAbsence = { id: string; studentId: string; payload: Record<string, unknown>; practice: boolean };

/**
 * A class's absences still waiting that cover `day`, for its register, oldest
 * first and one per child. The caller has already decided this reader may
 * decide them.
 */
export async function waitingAbsencesOn(sessionLabel: string, classId: string, day: string, options: { now?: Date } = {}, db: Db = whatsappDb()): Promise<WaitingAbsence[]> {
  if (!UUID.test(classId) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
  const { data, error } = await db
    .from("parent_suggestions")
    .select("id, student_id, payload, practice, created_at")
    .eq("session_label", sessionLabel)
    .eq("class_id", classId)
    .eq("kind", "absence")
    .eq("status", "pending")
    .gt("expires_at", (options.now ?? new Date()).toISOString())
    .order("created_at", { ascending: true })
    .returns<{ id: string; student_id: string | null; payload: Record<string, unknown> | null; practice: boolean }[]>();
  if (error) throw error;
  const seen = new Set<string>();
  const waiting: WaitingAbsence[] = [];
  for (const row of data ?? []) {
    const days = Array.isArray(row.payload?.days) ? row.payload.days : [];
    if (!row.student_id || seen.has(row.student_id) || !days.includes(day)) continue;
    seen.add(row.student_id);
    waiting.push({ id: row.id, studentId: row.student_id, payload: row.payload ?? {}, practice: row.practice });
  }
  return waiting;
}

/**
 * A child's absence a hand-off came with (D-602), whatever became of it:
 * what the buttons on that hand-off's WhatsApp alert decide. No parent's
 * words: those are the hand-off's.
 */
export type HandoffNote = {
  id: string;
  status: SuggestionStatus;
  days: string[];
  reason: AbsenceReason;
  expiresAt: string;
  practice: boolean;
  /** Once applied: how the register starts the child. */
  mark: RegisterMark | null;
  /** Once decided: the name of whoever decided it. */
  decidedByName: string | null;
};

/** The newest absence that came with this message in Messages, or null when it came with none. */
export async function readHandoffNote(parentReplyId: string, db: Db = whatsappDb()): Promise<HandoffNote | null> {
  if (!UUID.test(parentReplyId)) return null;
  const { data, error } = await db
    .from("parent_suggestions")
    .select("id, status, payload, expires_at, practice, decided_by, decision")
    .eq("parent_reply_id", parentReplyId)
    .eq("kind", "absence")
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<
      Array<{
        id: string;
        status: SuggestionStatus;
        payload: Record<string, unknown> | null;
        expires_at: string;
        practice: boolean;
        decided_by: string | null;
        decision: Record<string, unknown> | null;
      }>
    >();
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  const names = row.decided_by ? await staffNames([row.decided_by], db) : new Map<string, string>();
  const mark = row.decision?.mark;
  return {
    id: row.id,
    status: row.status,
    days: suggestionDays(row.payload ?? {}),
    reason: row.payload?.reason === "sick" ? "sick" : "other",
    expiresAt: row.expires_at,
    practice: row.practice === true,
    mark: mark === "leave" || mark === "absent" ? mark : null,
    decidedByName: row.decided_by ? (names.get(row.decided_by) ?? null) : null,
  };
}

/** The names staff go by, for "Leave · Test Teacher". */
export async function staffNames(ids: readonly string[], db: Db = whatsappDb()): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id) => UUID.test(id)))];
  if (wanted.length === 0) return new Map();
  const { data, error } = await fetchInChunks<{ id: string; short_name: string | null; display_name: string | null }>(wanted, IN_FILTER_CHUNK_SIZE, (chunk) =>
    db.from("staff_profiles").select("id, short_name, display_name").in("id", chunk),
  );
  if (error) throw error;
  return new Map(data.map((row) => [row.id, row.short_name || row.display_name || "—"]));
}

export type DecideOutcome = {
  id: string;
  outcome: "applied" | "dismissed" | "already" | "expired" | "not_permitted" | "failed" | "not_found";
  reason?: string;
  kind?: SuggestionKind;
};

export type DecideResult =
  | { ok: true; applied: number; dismissed: number; results: DecideOutcome[] }
  | { ok: false; reason: "bad_request" | "not_permitted" | "unavailable" };

/**
 * Apply or let go, as this member of staff: one, or many at once ("Mark all
 * 4 as Leave"). The database re-checks each (still waiting, not past its
 * time, this person may decide it) and answers each on its own.
 */
export async function decideParentSuggestions(
  input: { actorStaffId: string; ids: readonly string[]; decision: "apply" | "dismiss"; mark?: RegisterMark; via: DecidedVia },
  db: Db = whatsappDb(),
): Promise<DecideResult> {
  const ids = [...new Set(input.ids.filter((id) => UUID.test(id)))];
  if (!UUID.test(input.actorStaffId) || ids.length === 0 || ids.length > 200) return { ok: false, reason: "bad_request" };
  try {
    const { data, error } = await db.rpc("decide_parent_suggestions", {
      p: { actor_staff_id: input.actorStaffId, ids, decision: input.decision, mark: input.mark ?? "leave", via: input.via },
    });
    if (error) {
      logWarn("whatsapp.parent_suggestion_decide_failed", { error: error.message.slice(0, 120) });
      return { ok: false, reason: "unavailable" };
    }
    const answer = (data ?? {}) as { ok?: boolean; reason?: string; applied?: number; dismissed?: number; results?: Array<Record<string, unknown>> };
    if (answer.ok !== true) return { ok: false, reason: answer.reason === "not_permitted" ? "not_permitted" : "bad_request" };
    const results = (answer.results ?? []).map((result) => ({
      id: String(result.id ?? ""),
      outcome: String(result.outcome ?? "failed") as DecideOutcome["outcome"],
      ...(typeof result.reason === "string" ? { reason: result.reason } : {}),
      ...(typeof result.kind === "string" ? { kind: result.kind as SuggestionKind } : {}),
    }));
    const decided = results.filter((result) => result.outcome === "applied" || result.outcome === "dismissed").map((result) => result.id);
    if (decided.length > 0) await stopRemindersFor(decided, db);
    return { ok: true, applied: Number(answer.applied ?? 0), dismissed: Number(answer.dismissed ?? 0), results };
  } catch (caught) {
    logWarn("whatsapp.parent_suggestion_decide_failed", { error: caught instanceof Error ? caught.message.slice(0, 120) : "unknown" });
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * The hand-offs these decided notes came with stop reminding (D-602): nobody
 * is chased on WhatsApp about a note a person has already decided, wherever
 * they decided it. The hand-off itself stays open, and the parent's message
 * stays in Messages as it was, for anyone who still wants to answer it. A
 * courtesy: it never undoes a decision, and an undo does not restart it.
 */
async function stopRemindersFor(ids: readonly string[], db: Db): Promise<void> {
  try {
    const { data, error } = await fetchInChunks<{ parent_reply_id: string | null }>(ids, IN_FILTER_CHUNK_SIZE, (chunk) =>
      db.from("parent_suggestions").select("parent_reply_id").in("id", chunk).returns<{ parent_reply_id: string | null }[]>(),
    );
    if (error) throw error;
    const replies = [...new Set(data.map((row) => row.parent_reply_id).filter((id): id is string => typeof id === "string" && UUID.test(id)))];
    const at = new Date().toISOString();
    for (const chunk of chunkArray(replies, IN_FILTER_CHUNK_SIZE)) {
      const { error: stopError } = await db
        .from("parent_helper_handoffs")
        .update({ next_action: null, next_action_at: null, updated_at: at })
        .in("parent_reply_id", chunk)
        .is("answered_at", null)
        .is("closed_at", null)
        .not("next_action", "is", null);
      if (stopError) throw stopError;
    }
  } catch (caught) {
    logWarn("whatsapp.parent_suggestion_reminders_not_stopped", { error: caught instanceof Error ? caught.message.slice(0, 120) : "unknown" });
  }
}

export type UndoResult = { ok: true; status: "pending" | "undone"; was: "applied" | "dismissed" } | { ok: false; reason: string };

/** Take a decision back, as this member of staff: what an applied one wrote is put back, and it waits again. */
export async function undoParentSuggestion(input: { actorStaffId: string; id: string }, db: Db = whatsappDb()): Promise<UndoResult> {
  if (!UUID.test(input.actorStaffId) || !UUID.test(input.id)) return { ok: false, reason: "bad_request" };
  try {
    const { data, error } = await db.rpc("undo_parent_suggestion", { p: { actor_staff_id: input.actorStaffId, id: input.id } });
    if (error) {
      logWarn("whatsapp.parent_suggestion_undo_failed", { error: error.message.slice(0, 120) });
      return { ok: false, reason: "unavailable" };
    }
    const answer = (data ?? {}) as { ok?: boolean; reason?: string; status?: string; was?: string };
    if (answer.ok !== true) return { ok: false, reason: answer.reason ?? "unavailable" };
    return { ok: true, status: answer.status === "undone" ? "undone" : "pending", was: answer.was === "dismissed" ? "dismissed" : "applied" };
  } catch (caught) {
    logWarn("whatsapp.parent_suggestion_undo_failed", { error: caught instanceof Error ? caught.message.slice(0, 120) : "unknown" });
    return { ok: false, reason: "unavailable" };
  }
}
