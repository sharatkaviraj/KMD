import "server-only";

import { classLabelsForJob } from "@/modules/academics/data/academics-repo";
import { isEffectiveOn } from "@/modules/attendance/domain/class-scope";
import { toolRuntime } from "@/modules/mcp/data/runtime";
import { resolveStaffForUser } from "@/modules/mcp/data/staff";
import type { StaffLanguage } from "@/modules/whatsapp/domain/helper-handoff";
import { inNeedsYou, suggestionCard } from "@/modules/whatsapp/domain/parent-suggestions";
import {
  feeFactsFrom,
  pickPracticeSeat,
  type AwayFacts,
  type CoverFacts,
  type DeskRead,
  type FeeFacts,
  type LeaveFacts,
  type LinkedStaff,
  type NeedsYouFacts,
  type SchoolFacts,
} from "@/modules/whatsapp/domain/staff-desk";
import { isStaffHat, type StaffHat } from "@/modules/whatsapp/domain/staff-words";
import { DAYRUN, accountForAlias } from "@/platform/auth/dayrun-policy";
import type { StaffRole } from "@/platform/auth/permissions";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import type { VerifiedActor } from "@/platform/auth/verified-actor";
import { FEE_SCHEMA } from "@/platform/env";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { whatsappDb } from "@/platform/whatsapp/store";

import { parentReaderFor } from "./parent-suggestion-views";
import { waitingSuggestions } from "./parent-suggestions";

/**
 * The reads behind Veer Patta AI's staff desks (D-607), each for one person
 * and only what their screens would show them:
 *
 *  - the school today, staff away, cover and leave asked: through the same
 *    verified-actor readers as the AI connection's tools (`toolRuntime`),
 *    which repeat each screen's own check against the person, resolved
 *    from their sign-in afresh for every message;
 *  - Needs you: the parents' suggestions they decide, by Needs you's own
 *    rule (`inNeedsYou`), and a class teacher's own class's absences;
 *  - fees: `vppsone.staff_helper_fees`, for a TEST session only. A real
 *    year's figures are the Fees app's, which a webhook cannot read for
 *    anybody, so the reply sends them to One.
 *
 * Also the chat's hat (which way it is answered now) and the owner's
 * practice seats. Nothing here writes, except the hat.
 */

type Db = ReturnType<typeof whatsappDb>;

/* ------------------------------------------------------------- the hat */

/** Which way this chat is answered now (`parent_helper_chats.hat`); null when unset or unreadable. */
export async function readStaffHat(from: string, db: Db = whatsappDb()): Promise<StaffHat | null> {
  try {
    const { data, error } = await db.from("parent_helper_chats").select("hat").eq("from_e164", from).maybeSingle<{ hat: string | null }>();
    if (error || !data) return null;
    return isStaffHat(data.hat) ? data.hat : null;
  } catch {
    return null;
  }
}

/**
 * The chat answered another way from now on. What the parents' helper was
 * waiting for (a message for the teacher, a visit's day) is let go: it was
 * asked of the other side of the chat.
 */
export async function saveStaffHat(from: string, hat: StaffHat | null, at: Date, db: Db = whatsappDb()): Promise<void> {
  const { error } = await db
    .from("parent_helper_chats")
    .upsert({ from_e164: from, hat, awaiting: null, awaiting_until: null, updated_at: at.toISOString() }, { onConflict: "from_e164" });
  if (error) throw new Error(`Could not save the chat's role: ${error.message}`);
}

/* ------------------------------------------------- the owner's practice seats */

type SeatRow = { id: string; user_id: string | null; display_name: string | null; short_name: string | null; role: string | null; is_teaching: boolean | null };

/** The day-run QA accounts for a role, in the order the day-run lists them. */
function dayrunSeats(role: StaffRole): string[] {
  return DAYRUN.aliases
    .map((alias) => accountForAlias(alias))
    .filter((account) => account?.role === role && account.staffProfileId)
    .map((account) => account!.staffProfileId as string);
}

/** The seats that are class teacher of some class today (a test account's classes are the test year's). */
async function seatsHoldingClass(ids: readonly string[], day: string, db: Db): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await fetchInChunks<{ staff_profile_id: string; effective_from: string | null; effective_to: string | null }>(ids, IN_FILTER_CHUNK_SIZE, (chunk) =>
    db.from("class_teachers").select("staff_profile_id, effective_from, effective_to").in("staff_profile_id", chunk),
  );
  // Unreadable: no preference, never no seat.
  if (error) return new Set();
  return new Set(data.filter((row) => isEffectiveOn({ effectiveFrom: row.effective_from, effectiveTo: row.effective_to }, day)).map((row) => row.staff_profile_id));
}

/**
 * The test account the owner's number answers as in `role` (D-607): an
 * active one with a sign-in, so every check runs on it as on its screens.
 * Its records are the practice year's; the language is the owner's own.
 */
export async function readPracticeSeat(role: StaffRole, language: StaffLanguage, day: string, db: Db = whatsappDb()): Promise<LinkedStaff | null> {
  try {
    const { data: rows, error } = await db
      .from("staff_profiles")
      .select("id, user_id, display_name, short_name, role, is_teaching")
      .eq("role", role)
      .eq("is_test_account", true)
      .eq("is_active", true)
      .not("user_id", "is", null)
      .limit(100)
      .returns<SeatRow[]>();
    if (error || !rows) return null;
    // A teacher's desk is mostly their class: a seat that holds one shows it.
    const holding = role === "teacher" ? await seatsHoldingClass(rows.map((row) => row.id), day, db).catch(() => new Set<string>()) : new Set<string>();
    const seat = pickPracticeSeat(
      rows.map((row) => ({ ...row, displayName: row.display_name })),
      dayrunSeats(role),
      holding,
    );
    if (!seat) return null;
    const { data: granted, error: grantError } = await db.from("role_permissions").select("permission").eq("role", role).returns<Array<{ permission: string }>>();
    if (grantError || !granted) return null;
    return {
      staffId: seat.id,
      userId: seat.user_id,
      name: (seat.display_name ?? seat.short_name ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
      role,
      isTest: true,
      language,
      permissions: granted.map((row) => row.permission),
      isTeaching: seat.is_teaching === true,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- the desk */

/** The classes they hold today (as class teacher), and who they are to parents' suggestions. Null when unreadable. */
export async function readDesk(staff: LinkedStaff, sessionLabel: string, day: string, db: Db = whatsappDb()): Promise<DeskRead | null> {
  try {
    const { data, error } = await db
      .from("class_teachers")
      .select("class_id, effective_from, effective_to")
      .eq("staff_profile_id", staff.staffId)
      .eq("session_label", sessionLabel)
      .returns<Array<{ class_id: string; effective_from: string | null; effective_to: string | null }>>();
    if (error || !data) return null;
    const held = [...new Set(data.filter((row) => isEffectiveOn({ effectiveFrom: row.effective_from, effectiveTo: row.effective_to }, day)).map((row) => row.class_id))];
    const reader = parentReaderFor({ role: staff.role, permissions: staff.permissions, isTestAccount: staff.isTest }, sessionLabel);
    return { held, reader };
  } catch {
    return null;
  }
}

/** How many of the parents' suggestions wait for them, and the oldest few as One's cards word them. Null when unreadable. */
export async function readNeedsYou(staff: LinkedStaff, sessionLabel: string, day: string, now: Date, desk: DeskRead, db: Db = whatsappDb()): Promise<NeedsYouFacts | null> {
  try {
    const held = new Set(desk.held);
    const reader = desk.reader;
    if (!reader && held.size === 0) return { count: 0, items: [], classTeacher: true };
    const rows = reader ? await waitingSuggestions(sessionLabel, { now }, db) : await waitingSuggestions(sessionLabel, { classIds: desk.held, now }, db);
    const mine = rows.filter((row) => (reader !== null && inNeedsYou(row, reader)) || (row.kind === "absence" && row.classId !== null && held.has(row.classId)));
    const first = mine.slice(0, 5);
    const ids = [...new Set(first.filter((row) => row.kind !== "visit" && row.studentId).map((row) => row.studentId as string))];
    const [labels, students] = await Promise.all([
      classLabelsForJob(sessionLabel).catch(() => new Map<string, string>()),
      ids.length
        ? fetchInChunks<{ id: string; full_name: string | null }>(ids, IN_FILTER_CHUNK_SIZE, (chunk) => db.schema(FEE_SCHEMA).from("students").select("id, full_name").in("id", chunk))
        : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null }>, error: null }),
    ]);
    const nameOf = new Map((students.error ? [] : students.data).map((row) => [row.id, (row.full_name ?? "").trim()]));
    const items = first.map((row) => {
      const childName =
        row.kind === "visit" ? String(row.payload.child_name ?? "").trim() || "A child" : (row.studentId ? nameOf.get(row.studentId) : null) || "A child";
      const card = suggestionCard({ kind: row.kind, payload: row.payload, childName, classLabel: row.classId ? (labels.get(row.classId) ?? null) : null, today: day });
      return {
        title: { en: card.title.en, hi: card.title.hi ?? card.title.en },
        line: { en: card.line.en, hi: card.line.hi ?? card.line.en },
        urgent: card.urgent,
      };
    });
    return { count: mine.length, items, classTeacher: reader === null };
  } catch {
    return null;
  }
}

/* ---------------------------------------------- the reads that check a person */

/** The person, as the screens' checks see them now; null when they cannot be (no sign-in, inactive, another profile). */
async function actorFor(staff: LinkedStaff): Promise<VerifiedActor | null> {
  if (!staff.userId) return null;
  const actor = await resolveStaffForUser(staff.userId).catch(() => null);
  if (!actor || !actor.isActive || actor.id !== staff.staffId) return null;
  return actor;
}

export async function readSchoolToday(staff: LinkedStaff, sessionLabel: string, day: string): Promise<SchoolFacts | null> {
  try {
    const actor = await actorFor(staff);
    if (!actor) return null;
    const read = await toolRuntime.schoolDay(actor, sessionLabel, day);
    return {
      day,
      schoolOpen: read.schoolOpen,
      timetableRuns: read.timetableRuns,
      rows: read.rows,
      staffAway: read.unavailable.includes("absences") ? null : read.staffAway,
      uncovered: read.unavailable.includes("cover") ? null : read.uncovered,
    };
  } catch {
    return null;
  }
}

export async function readStaffAway(staff: LinkedStaff, sessionLabel: string, day: string): Promise<AwayFacts | null> {
  try {
    const actor = await actorFor(staff);
    if (!actor) return null;
    const read = await toolRuntime.absences(actor, sessionLabel, day);
    return { day, periodCount: read.periodCount, absences: read.absences };
  } catch {
    return null;
  }
}

export async function readCoverToday(staff: LinkedStaff, sessionLabel: string, day: string): Promise<CoverFacts | null> {
  try {
    const actor = await actorFor(staff);
    if (!actor) return null;
    const read = await toolRuntime.cover(actor, sessionLabel, day);
    return { day, duties: read.duties };
  } catch {
    return null;
  }
}

export async function readLeaveAsked(staff: LinkedStaff, sessionLabel: string): Promise<LeaveFacts | null> {
  try {
    const actor = await actorFor(staff);
    if (!actor) return null;
    return await toolRuntime.pendingLeave(actor, sessionLabel);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ fees */

/** The fee figures for a TEST session; "elsewhere" for a real year (the Fees app's); null when unreadable. */
export async function readFeeFigures(sessionLabel: string, day: string, query: string | null, db: Db = whatsappDb()): Promise<FeeFacts | "elsewhere" | null> {
  if (!isTestSessionLabel(sessionLabel)) return "elsewhere";
  try {
    const { data, error } = await db.rpc("staff_helper_fees", { p_session_label: sessionLabel, p_day: day, p_query: query });
    if (error) return null;
    if (data === null) return "elsewhere";
    return feeFactsFrom(data);
  } catch {
    return null;
  }
}
