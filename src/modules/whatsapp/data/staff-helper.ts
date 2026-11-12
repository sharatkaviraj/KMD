import "server-only";

import { isSchoolOpen, timetableRuns, type CalendarDayKind } from "@/modules/academics/domain/calendar";
import { rankOf } from "@/modules/academics/domain/class-order";
import { classLabelsForJob, sessionLabelForStaff } from "@/modules/academics/data/academics-repo";
import { parentNotesOn } from "@/modules/attendance/data/parent-notes";
import { isEffectiveOn } from "@/modules/attendance/domain/class-scope";
import { lessonsToday } from "@/modules/attendance/domain/today";
import { hasConsent } from "@/modules/staff-notices/domain/gates";
import { myDutiesOn } from "@/modules/substitutions/data/duty-repo";
import { currentBells } from "@/modules/substitutions/data/school-rules-repo";
import type { BellSchedule } from "@/modules/timetable/domain/bells";
import { periodNumber } from "@/modules/timetable/domain/periods";
import { matchDayHeader } from "@/modules/timetable/domain/weekday";
import { MAX_TURNS_PER_NUMBER_PER_DAY, type ChatPatch } from "@/modules/whatsapp/domain/helper-plan";
import { staffAlertText, staffLanguage, type StaffLanguage } from "@/modules/whatsapp/domain/helper-handoff";
import { helperMessageBody, plainVersion, type HelperMessage } from "@/modules/whatsapp/domain/helper-messages";
import {
  QUESTIONS_AT_ONCE,
  STAFF_INTENTS,
  absentReply,
  linkFirstReply,
  questionsReply,
  staffCommandIn,
  staffMenuReply,
  staffSorryReply,
  stoppedReply,
  todayReply,
  type AbsentFacts,
  type AwayChild,
  type AwayStatus,
  type ClassDay,
  type DayCover,
  type DayFacts,
  type DayLesson,
  type ParentNote,
  type StaffCommand,
  type StaffContext,
} from "@/modules/whatsapp/domain/staff-helper";
import { testAccountFlags } from "@/platform/auth/current-staff";
import { can, resolveStaffRole, type StaffRole } from "@/platform/auth/permissions";
import { SCHOOL_UTC_OFFSET_MINUTES, schoolToday } from "@/platform/dates";
import { FEE_SCHEMA, getSiteUrl } from "@/platform/env";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { logInfo } from "@/platform/observability/log";
import { readWhatsAppConfig, type WhatsAppConfig } from "@/platform/whatsapp/config";
import { maskNumber, toE164 } from "@/platform/whatsapp/numbers";
import { textMessageBody } from "@/platform/whatsapp/payload";
import { checkWhatsAppSend, type WhatsAppSwitches } from "@/platform/whatsapp/policy";
import { HUB_CODES, providerFor, type ClaimResult, type ProviderSendResult } from "@/platform/whatsapp/providers";
import { readSwitches, whatsappDb } from "@/platform/whatsapp/store";
import type { WebhookInbound } from "@/platform/whatsapp/webhook";
import { subjectNamer } from "@/vx/screens/exams/domain/groups";
import { leaveNow } from "@/vx/screens/teach/domain/today";

import { insertAlert, readOpenHandoffsFor, type AlertRecord, type OpenHandoff } from "./helper-handoffs";
import { finishTurn, readBudget, readHelperSettings, saveChat, startTurn, type TurnFinish } from "./helper-store";

/**
 * The teachers' own Veer Patta AI (D-591), the database and the WhatsApp
 * side. The words and the rules are in `domain/staff-helper.ts`.
 *
 * Who is asking is the phone, never the message: the number must be on a
 * staff record that linked it from that very phone (a used Link my WhatsApp
 * code sent from it, D-582), the person must be active and must not have
 * turned WhatsApp off. A number that is on a staff record only because
 * somebody typed it is asked to link itself first and is shown nothing.
 *
 * Everything is read with the service role, for that one person: their own
 * periods and cover, the hand-offs that are theirs, the register of the class
 * they hold (with `attendance:view`, as on their screen). Real staff read
 * the school's active year, a test account `TEST-2026-27`. Nothing here writes
 * except the turn's ledger row, the chat's last time, and, for *questions*,
 * the alert rows that let a swipe on a waiting question answer it. The reply
 * goes only when the helper may answer this number at all (its switch,
 * practice mode, real recipients), as every message is.
 */

type Db = ReturnType<typeof whatsappDb>;

export type LinkedStaff = {
  staffId: string;
  name: string;
  role: StaffRole;
  /** A test account, or every account on a confined deployment. */
  isTest: boolean;
  language: StaffLanguage;
  /** The role's permissions from the matrix (Staff → Roles), as on their screens. */
  permissions: string[];
};

export type StaffIdentity =
  /** No active member of staff has this number: an ordinary message. */
  | { state: "none" }
  /** On a staff record, but never linked from this phone. */
  | { state: "unproven"; language: StaffLanguage; isTest: boolean }
  /** Linked from this phone, then WhatsApp was turned off. */
  | { state: "stopped"; language: StaffLanguage; isTest: boolean }
  | { state: "linked"; staff: LinkedStaff };

type ProfileRow = {
  id: string;
  display_name: string | null;
  short_name: string | null;
  role: string | null;
  is_active: boolean | null;
  is_test_account: boolean | null;
  preferred_language: string | null;
  whatsapp_opt_in_at: string | null;
  whatsapp_opt_out_at: string | null;
};

const PROFILE_COLUMNS =
  "id, display_name, short_name, role, is_active, is_test_account, preferred_language, whatsapp_opt_in_at, whatsapp_opt_out_at";

const INDIAN_MOBILE = /^\+91[6-9]\d{9}$/;

/**
 * Who this number is, as staff. When it links more than one profile (a
 * person who linked their phone to a test account as well as their own), the
 * newest link from this phone is the one that stands. Null when it could not
 * be read.
 */
export async function readLinkedStaff(from: string, db: Db = whatsappDb()): Promise<StaffIdentity | null> {
  if (!INDIAN_MOBILE.test(from)) return { state: "none" };
  try {
    // Link my WhatsApp writes the last ten digits (`link_staff_whatsapp`).
    const { data: rows, error } = await db
      .from("staff_profiles")
      .select(PROFILE_COLUMNS)
      .eq("whatsapp_phone", from.slice(-10))
      .limit(10)
      .returns<ProfileRow[]>();
    if (error || !rows) return null;
    const active = rows.filter((row) => row.is_active === true);
    if (active.length === 0) return { state: "none" };

    const { data: links, error: linkError } = await db
      .from("staff_whatsapp_links")
      .select("staff_profile_id, used_at")
      .eq("used_from", from)
      .not("used_at", "is", null)
      .in(
        "staff_profile_id",
        active.map((row) => row.id),
      )
      .order("used_at", { ascending: false })
      .limit(10)
      .returns<Array<{ staff_profile_id: string; used_at: string }>>();
    if (linkError || !links) return null;

    const proven = links.map((link) => active.find((row) => row.id === link.staff_profile_id)).find((row): row is ProfileRow => Boolean(row));
    const first = proven ?? active[0];
    const language = staffLanguage(first.preferred_language);
    const isTest = testAccountFlags(first.is_test_account === true).isTestAccount;
    if (!proven) return { state: "unproven", language, isTest };
    if (hasConsent({ optInAt: proven.whatsapp_opt_in_at, optOutAt: proven.whatsapp_opt_out_at }) !== "yes") {
      return { state: "stopped", language, isTest };
    }

    const role = resolveStaffRole(proven.role);
    const { data: granted, error: grantError } = await db
      .from("role_permissions")
      .select("permission")
      .eq("role", role)
      .returns<Array<{ permission: string }>>();
    // A matrix that cannot be read refuses, as on every screen: never the seed map.
    if (grantError || !granted) return null;
    return {
      state: "linked",
      staff: {
        staffId: proven.id,
        name: (proven.display_name ?? proven.short_name ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
        role,
        isTest,
        language,
        permissions: granted.map((row) => row.permission),
      },
    };
  } catch {
    return null;
  }
}

/** Minutes since midnight on the school's clock. */
export function schoolMinutesNow(now: Date): number {
  const shifted = new Date(now.getTime() + SCHOOL_UTC_OFFSET_MINUTES * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

type CalendarRow = { kind: CalendarDayKind; label_en: string | null; label_hi: string | null };

async function calendarDay(db: Db, sessionLabel: string, day: string) {
  const { data, error } = await db
    .from("academic_calendar_days")
    .select("kind, label_en, label_hi")
    .eq("session_label", sessionLabel)
    .eq("day", day)
    .maybeSingle<CalendarRow>();
  if (error) return null;
  const entry = data ? { kind: data.kind, name: data.label_en || data.label_hi ? { en: data.label_en, hi: data.label_hi } : null } : null;
  const map = new Map<string, CalendarDayKind>(data ? [[day, data.kind]] : []);
  return { entry, open: isSchoolOpen(day, map), runs: timetableRuns(day, map) };
}

function timeOf(bells: BellSchedule | null, index: number): { starts: string; ends: string } {
  const period = bells?.periods.find((bell) => bell.index === index);
  return { starts: period?.starts ?? "", ends: period?.ends ?? "" };
}

type SlotRow = { day: string; period: number; class_id: string; class_label: string; subject_code: string };
type LeaveRow = { from_day: string; to_day: string; span: string; status: string };

/** Their day: periods, cover, free periods and leave. Null when the calendar or the timetable could not be read. */
export async function readStaffDay(staff: LinkedStaff, sessionLabel: string, now: Date, db: Db = whatsappDb()): Promise<DayFacts | null> {
  const day = schoolToday(now);
  try {
    const [calendar, version, bells, duties, leave] = await Promise.all([
      calendarDay(db, sessionLabel, day),
      db
        .from("timetable_versions")
        .select("id")
        .eq("session_label", sessionLabel)
        .eq("status", "published")
        .maybeSingle<{ id: string }>(),
      currentBells(sessionLabel).catch(() => null),
      myDutiesOn(staff.staffId, sessionLabel, day).catch(() => null),
      db
        .from("teacher_leave")
        .select("from_day, to_day, span, status")
        .eq("staff_profile_id", staff.staffId)
        .eq("session_label", sessionLabel)
        .lte("from_day", day)
        .gte("to_day", day)
        .in("status", ["approved", "asked"])
        .returns<LeaveRow[]>(),
    ]);
    if (!calendar || version.error) return null;

    // Their own slots in the published sheet, and the day's among them: the
    // sheet writes its own day headers, so they are matched, not assumed.
    let slots: SlotRow[] = [];
    if (version.data && calendar.open && calendar.runs) {
      const { data, error } = await db
        .from("timetable_slots")
        .select("day, period, class_id, class_label, subject_code")
        .eq("version_id", version.data.id)
        .eq("staff_profile_id", staff.staffId)
        .limit(500)
        .returns<SlotRow[]>();
      if (error || !data) return null;
      const header = matchDayHeader([...new Set(data.map((row) => row.day))], day);
      slots = header ? data.filter((row) => row.day === header) : [];
    }
    const lessons = lessonsToday(
      slots.map((row) => ({ period: row.period, classId: row.class_id, classLabel: row.class_label, subjectCode: row.subject_code })),
    );
    const covers = calendar.open ? duties : [];

    const codes = [...new Set([...lessons.map((lesson) => lesson.subjectCode), ...(covers ?? []).map((cover) => cover.subjectCode)])].filter(Boolean);
    const absentIds = [...new Set((covers ?? []).flatMap((cover) => cover.absentStaffIds))];
    const [subjects, people] = await Promise.all([
      codes.length
        ? db.from("subjects").select("code, name_en, name_hi").in("code", codes).returns<Array<{ code: string; name_en: string | null; name_hi: string | null }>>()
        : Promise.resolve({ data: [], error: null }),
      absentIds.length
        ? db.from("staff_profiles").select("id, display_name, short_name").in("id", absentIds).returns<Array<{ id: string; display_name: string | null; short_name: string | null }>>()
        : Promise.resolve({ data: [], error: null }),
    ]);
    const named = subjectNamer((subjects.data ?? []).map((row) => ({ code: row.code, nameEn: row.name_en, nameHi: row.name_hi })));
    const names = new Map((people.data ?? []).map((row) => [row.id, (row.display_name ?? row.short_name ?? "").trim() || "-"]));

    const dayLessons: DayLesson[] = lessons.map((lesson) => ({
      number: periodNumber(lesson.period),
      ...timeOf(bells, lesson.period),
      subject: named(lesson.subjectCode),
      classes: lesson.classes.map((entry) => entry.classLabel),
    }));
    const dayCovers: DayCover[] | null =
      covers === null
        ? null
        : covers.map((cover) => ({
            number: periodNumber(cover.period),
            ...timeOf(bells, cover.period),
            subject: named(cover.subjectCode),
            classes: cover.classLabels,
            forNames: cover.absentStaffIds.map((id) => names.get(id) ?? "-"),
            seen: cover.acknowledgedAt !== null,
          }));

    const busy = new Set([...lessons.map((lesson) => lesson.period), ...(covers ?? []).map((cover) => cover.period)]);
    const freePeriods = lessons.length > 0 && bells ? bells.periods.filter((bell) => !busy.has(bell.index)).map((bell) => periodNumber(bell.index)) : [];

    const leaveRows = leave.error ? [] : (leave.data ?? []);
    const over = leaveRows.find((row) => row.status === "approved") ?? leaveRows.find((row) => row.status === "asked") ?? null;
    const leaveToday = over ? leaveNow([over], day) : null;

    return {
      day,
      calendar: calendar.entry,
      open: calendar.open,
      runs: calendar.runs,
      published: Boolean(version.data),
      lessons: dayLessons,
      covers: dayCovers,
      freePeriods,
      leave:
        over && leaveToday
          ? { ...leaveToday, fullDay: over.from_day !== over.to_day || (over.span !== "first_half" && over.span !== "second_half") }
          : null,
      nowMinutes: schoolMinutesNow(now),
    };
  } catch {
    return null;
  }
}

type MarkRow = { register_id: string; student_id: string; status: AwayStatus | "present" };

/** Rolls sort as numbers when they are numbers ("2" before "10"), then by name. */
function byRoll(a: { rollNo: string | null; name: string }, b: { rollNo: string | null; name: string }): number {
  const ra = Number(a.rollNo);
  const rb = Number(b.rollNo);
  if (a.rollNo && b.rollNo && Number.isFinite(ra) && Number.isFinite(rb) && ra !== rb) return ra - rb;
  if (a.rollNo !== b.rollNo) return (a.rollNo ?? "~").localeCompare(b.rollNo ?? "~", "en", { numeric: true });
  return a.name.localeCompare(b.name, "en");
}

/**
 * Today's register of each class they hold, as on their Attendance screen:
 * who is away, and the parents who told the school first. A teacher reads
 * only the class they hold (owner, 6 Nov 2026). Null when it could not be read.
 */
export async function readStaffAbsent(staff: LinkedStaff, sessionLabel: string, day: string, db: Db = whatsappDb()): Promise<AbsentFacts | null> {
  if (!can({ role: staff.role, permissions: staff.permissions }, "attendance:view")) return { kind: "not_allowed" };
  try {
    const { data: held, error } = await db
      .from("class_teachers")
      .select("class_id, effective_from, effective_to")
      .eq("staff_profile_id", staff.staffId)
      .eq("session_label", sessionLabel)
      .returns<Array<{ class_id: string; effective_from: string | null; effective_to: string | null }>>();
    if (error || !held) return null;
    const classIds = [
      ...new Set(held.filter((row) => isEffectiveOn({ effectiveFrom: row.effective_from, effectiveTo: row.effective_to }, day)).map((row) => row.class_id)),
    ];
    if (classIds.length === 0) return { kind: "no_class" };

    const calendar = await calendarDay(db, sessionLabel, day);
    if (!calendar) return null;
    if (!calendar.open) return { kind: "closed", day, calendar: calendar.entry };

    const [labels, registers, enrolled] = await Promise.all([
      classLabelsForJob(sessionLabel).catch(() => new Map<string, string>()),
      db
        .from("attendance_registers")
        .select("id, class_id, status, revision")
        .eq("session_label", sessionLabel)
        .eq("day", day)
        .is("period", null)
        .in("class_id", classIds)
        .returns<Array<{ id: string; class_id: string; status: string; revision: number }>>(),
      db
        .from("enrolments")
        .select("student_id, class_id, roll_no")
        .eq("session_label", sessionLabel)
        .eq("status", "enrolled")
        .in("class_id", classIds)
        .limit(1000)
        .returns<Array<{ student_id: string; class_id: string; roll_no: string | null }>>(),
    ]);
    if (registers.error || !registers.data || enrolled.error || !enrolled.data) return null;

    const saved = registers.data.filter((row) => row.status === "submitted" || Number(row.revision) >= 1);
    const marks = saved.length
      ? await db
          .from("attendance_marks")
          .select("register_id, student_id, status")
          .in(
            "register_id",
            saved.map((row) => row.id),
          )
          .limit(1000)
          .returns<MarkRow[]>()
      : { data: [] as MarkRow[], error: null };
    if (marks.error || !marks.data) return null;

    const rank = rankOf(labels);
    const rollOf = new Map(enrolled.data.map((row) => [row.student_id, row.roll_no]));
    const notes = await parentNotesOn(sessionLabel, day, [...new Set([...enrolled.data.map((row) => row.student_id), ...marks.data.map((row) => row.student_id)])]);
    const named = [
      ...new Set([
        ...marks.data.filter((row) => row.status !== "present").map((row) => row.student_id),
        ...enrolled.data.filter((row) => notes.has(row.student_id)).map((row) => row.student_id),
      ]),
    ];
    const students = named.length
      ? await fetchInChunks<{ id: string; full_name: string | null }>(named, IN_FILTER_CHUNK_SIZE, (chunk) =>
          db.schema(FEE_SCHEMA).from("students").select("id, full_name").in("id", chunk),
        )
      : { data: [] as Array<{ id: string; full_name: string | null }>, error: null };
    if (students.error) return null;
    const nameOf = new Map(students.data.map((row) => [row.id, (row.full_name ?? "").trim() || "-"]));

    const classes: ClassDay[] = classIds
      .map((classId) => {
        const register = saved.find((row) => row.class_id === classId) ?? null;
        const classLabel = labels.get(classId) ?? "-";
        if (!register) {
          const told = enrolled.data
            .filter((row) => row.class_id === classId && notes.has(row.student_id))
            .map((row) => ({ name: nameOf.get(row.student_id) ?? "-", rollNo: row.roll_no, reason: notes.get(row.student_id) as ParentNote }))
            .sort(byRoll);
          return { classLabel, classId, marked: false, present: 0, total: 0, away: [], told };
        }
        const own = marks.data.filter((row) => row.register_id === register.id);
        const away: AwayChild[] = own
          .filter((row) => row.status !== "present")
          .map((row) => ({
            name: nameOf.get(row.student_id) ?? "-",
            rollNo: rollOf.get(row.student_id) ?? null,
            status: row.status as AwayStatus,
            parentNote: notes.get(row.student_id) ?? null,
          }))
          .sort(byRoll);
        const present = own.filter((row) => row.status === "present" || row.status === "late").length;
        return { classLabel, classId, marked: true, present, total: own.length, away, told: [] };
      })
      // School order (Class 2 before Class 10), as on every class list in One.
      .sort((a, b) => (rank.get(a.classId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.classId) ?? Number.MAX_SAFE_INTEGER));
    return { kind: "classes", day, classes };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ from WhatsApp */

/** Everything a staff command reads and writes, so a test can stand in for each. */
export type StaffHelperDeps = {
  now: () => Date;
  readIdentity: (from: string) => Promise<StaffIdentity | null>;
  readSession: (staff: LinkedStaff) => Promise<string | null>;
  readDay: (staff: LinkedStaff, sessionLabel: string, now: Date) => Promise<DayFacts | null>;
  readQuestions: (staff: LinkedStaff) => Promise<OpenHandoff[] | null>;
  readAbsent: (staff: LinkedStaff, sessionLabel: string, day: string) => Promise<AbsentFacts | null>;
  readSwitches: () => Promise<WhatsAppSwitches | null>;
  readConfig: () => WhatsAppConfig;
  readHelperName: () => Promise<string>;
  readBudget: (from: string, now: Date) => Promise<{ spentUsd: number; turnsToday: number } | null>;
  /** Null when the provider cannot claim a message (only the hub can). */
  claim: ((wamid: string) => Promise<ClaimResult>) | null;
  send: (body: Record<string, unknown>) => Promise<ProviderSendResult>;
  startTurn: typeof startTurn;
  finishTurn: (providerMessageId: string, finish: TurnFinish) => Promise<void>;
  saveChat: (from: string, patch: ChatPatch, at: Date) => Promise<void>;
  insertAlert: (row: AlertRecord) => Promise<boolean>;
  /** Where VPPS One lives, for the links in a reply. */
  origin: () => string;
};

export function liveStaffHelperDeps(config: WhatsAppConfig = readWhatsAppConfig()): StaffHelperDeps {
  const provider = config.ok ? providerFor(config) : null;
  const claimMessage = provider?.claimMessage;
  return {
    now: () => new Date(),
    readIdentity: (from) => readLinkedStaff(from),
    readSession: (staff) => sessionLabelForStaff({ role: staff.role, isTestAccount: staff.isTest }).catch(() => null),
    readDay: (staff, sessionLabel, now) => readStaffDay(staff, sessionLabel, now),
    readQuestions: (staff) => readOpenHandoffsFor(staff.staffId, staff.isTest),
    readAbsent: (staff, sessionLabel, day) => readStaffAbsent(staff, sessionLabel, day),
    readSwitches: () => readSwitches(),
    readConfig: () => config,
    readHelperName: async () => (await readHelperSettings())?.helperName ?? "Veer Patta AI",
    readBudget: (from, now) => readBudget(from, now),
    claim: claimMessage ? (wamid) => claimMessage(wamid) : null,
    send: (body) =>
      provider
        ? provider.send(body)
        : Promise.resolve({ outcome: "unknown", httpStatus: null, errorCode: "network", errorTitle: "WhatsApp is not set up here." }),
    startTurn: (row) => startTurn(row),
    finishTurn: (id, finish) => finishTurn(id, finish),
    saveChat: (from, patch, at) => saveChat(from, patch, at),
    insertAlert: (row) => insertAlert(row),
    origin: () => getSiteUrl().replace(/\/$/, ""),
  };
}

export type StaffCommandOutcome =
  | { outcome: "skipped"; reason: string }
  | { outcome: "not_claimed"; reason: string }
  | { outcome: "answered"; route: "rule"; intent: string; handoff: null }
  | { outcome: "failed"; reason: string };

function claimNote(claim: ClaimResult | null): string {
  if (!claim) return "claim_failed:network";
  if (!claim.ok) return `claim_failed:${claim.httpStatus ?? "network"}`;
  if (claim.staff) return "staff_handling";
  if (claim.stale) return "stale";
  return `taken_by:${claim.takenBy ?? "other"}`;
}

function sendFailure(result: Exclude<ProviderSendResult, { outcome: "accepted" }>): string {
  return result.outcome === "unknown" ? `send_unknown:${result.errorCode}` : `send_rejected:${result.errorCode ?? result.httpStatus}`;
}

/** Meta may refuse an interactive message it would take as plain words; the hub's own refusals stand. */
function worthPlainRetry(result: ProviderSendResult, message: HelperMessage): boolean {
  if (result.outcome !== "rejected" || message.kind === "text") return false;
  const code = result.errorCode ?? "";
  return !(HUB_CODES as readonly string[]).includes(code) && code !== "bad_api_key";
}

type Composed = { message: HelperMessage; intent: string; note: string | null; resend: OpenHandoff[]; staff: LinkedStaff | null };

const UNREACHABLE: ProviderSendResult = { outcome: "unknown", httpStatus: null, errorCode: "network", errorTitle: "The hub could not be reached." };

/** A send that never throws: after the claim, every path must end in a ledger row. */
function safeSend(deps: StaffHelperDeps, body: Record<string, unknown>): Promise<ProviderSendResult> {
  try {
    return deps.send(body).catch(() => UNREACHABLE);
  } catch {
    return Promise.resolve(UNREACHABLE);
  }
}

function safeOrigin(deps: StaffHelperDeps): string {
  try {
    return deps.origin();
  } catch {
    return getSiteUrl().replace(/\/$/, "");
  }
}

async function compose(command: StaffCommand, identity: Exclude<StaffIdentity, { state: "none" }>, deps: StaffHelperDeps, now: Date): Promise<Composed> {
  const helperName = await deps.readHelperName().catch(() => "Veer Patta AI");
  const origin = safeOrigin(deps);
  if (identity.state === "unproven") {
    return { message: linkFirstReply(identity.language, helperName), intent: STAFF_INTENTS.linkFirst, note: null, resend: [], staff: null };
  }
  if (identity.state === "stopped") {
    return { message: stoppedReply(identity.language), intent: STAFF_INTENTS.stopped, note: null, resend: [], staff: null };
  }
  const staff = identity.staff;
  const sorry = (note: string): Composed => ({ message: staffSorryReply(staff.language, origin), intent: STAFF_INTENTS[command], note, resend: [], staff });
  const sessionLabel = await deps.readSession(staff).catch(() => null);
  if (!sessionLabel) return sorry("session_unreadable");
  const ctx: StaffContext = { language: staff.language, name: staff.name, helperName, practice: staff.isTest, sessionLabel, origin };

  switch (command) {
    case "menu":
      return { message: staffMenuReply(ctx), intent: STAFF_INTENTS.menu, note: null, resend: [], staff };
    case "today": {
      const facts = await deps.readDay(staff, sessionLabel, now).catch(() => null);
      if (!facts) return sorry("day_unreadable");
      return { message: todayReply(facts, ctx), intent: STAFF_INTENTS.today, note: null, resend: [], staff };
    }
    case "questions": {
      const open = await deps.readQuestions(staff).catch(() => null);
      if (!open) return sorry("questions_unreadable");
      const resend = open.slice(0, QUESTIONS_AT_ONCE);
      const message = questionsReply(
        {
          count: open.length,
          shown: resend.length,
          oldestAt: open[0]?.createdAt ?? null,
          now,
          canOpenMessages: can({ role: staff.role, permissions: staff.permissions }, "messages:send"),
        },
        ctx,
      );
      return { message, intent: STAFF_INTENTS.questions, note: null, resend, staff };
    }
    case "absent": {
      const facts = await deps.readAbsent(staff, sessionLabel, schoolToday(now)).catch(() => null);
      if (!facts) return sorry("absent_unreadable");
      return { message: absentReply(facts, ctx), intent: STAFF_INTENTS.absent, note: null, resend: [], staff };
    }
  }
}

/**
 * Each waiting question again, as its own message that a swipe answers: the
 * same typed alert the helper sends (marked as a reminder), written down with
 * its message id like every alert. How many went.
 */
async function resendQuestions(input: { to: string; staff: LinkedStaff; open: OpenHandoff[]; helperName: string; deps: StaffHelperDeps }): Promise<number> {
  const { to, staff, open, helperName, deps } = input;
  let sent = 0;
  for (const handoff of open) {
    const text = staffAlertText({
      kind: "reminder",
      language: staff.language,
      staffName: staff.name,
      studentLabel: handoff.studentLabel ?? `${handoff.fromName} (${staff.language === "hi" ? "अभिभावक" : "parent"})`,
      topic: handoff.topic,
      complaint: handoff.complaint,
      words: handoff.body,
      helperName,
      practice: handoff.practice,
    });
    const result = await safeSend(deps, textMessageBody(to, text));
    const accepted = result.outcome === "accepted";
    if (accepted) sent += 1;
    await deps
      .insertAlert({
        handoffId: handoff.id,
        staffId: staff.staffId,
        toE164: to,
        kind: "reminder",
        via: "text",
        status: accepted ? "sent" : "failed",
        reason: accepted ? "asked_questions" : sendFailure(result as Exclude<ProviderSendResult, { outcome: "accepted" }>),
        messageId: accepted ? result.messageId : null,
      })
      .catch(() => false);
  }
  return sent;
}

/**
 * A staff command (D-591). Null when the message is not one, or the number
 * is not a member of staff's: then it is an ordinary message, and the parent
 * helper (or the hub's bot) answers it.
 */
export async function handleStaffCommand(message: WebhookInbound, deps: StaffHelperDeps): Promise<StaffCommandOutcome | null> {
  const command = staffCommandIn(message);
  if (!command) return null;
  const from = toE164(message.from);
  if (!from) return null;
  const identity = await deps.readIdentity(from).catch(() => null);
  if (!identity || identity.state === "none") return null;

  const now = deps.now();
  const sentAt = Date.parse(message.at);
  const wroteAt = Number.isFinite(sentAt) ? new Date(sentAt) : now;
  const switches = await deps.readSwitches().catch(() => null);
  const verdict = checkWhatsAppSend({ feature: "parent_helper", to: from, switches, config: deps.readConfig(), kind: "text", wroteInLast24h: true });
  logInfo("whatsapp.staff_helper", { command, state: identity.state, from: maskNumber(from), reply: verdict.decision });
  // The hub's bot answers when One may not.
  if (verdict.decision === "dry_run") return { outcome: "skipped", reason: "practice_mode" };
  if (verdict.decision === "refuse") return { outcome: "skipped", reason: verdict.code };
  if (!deps.claim) return { outcome: "skipped", reason: "cannot_claim" };

  const budget = await deps.readBudget(from, now).catch(() => null);
  if (!budget) return { outcome: "skipped", reason: "budget_unreadable" };
  if (budget.turnsToday >= MAX_TURNS_PER_NUMBER_PER_DAY) return { outcome: "skipped", reason: "daily_cap" };

  const ledger = await deps.startTurn({
    providerMessageId: message.providerMessageId,
    from,
    receivedAt: wroteAt.toISOString(),
    kind: message.raw?.type === "interactive" ? "tap" : "text",
    // A test account's turns are the practice ones, real staff's the real year's (D-590).
    practice: identity.state === "linked" ? identity.staff.isTest : identity.isTest,
  }).catch(() => "failed" as const);
  if (ledger === "duplicate") return { outcome: "skipped", reason: "duplicate" };
  if (ledger === "failed") return { outcome: "skipped", reason: "ledger_failed" };

  const claim = await deps.claim(message.providerMessageId).catch(() => null);
  if (!claim || !claim.ok || !claim.claimed) {
    const reason = claimNote(claim);
    await deps.finishTurn(message.providerMessageId, { status: "not_claimed", reason, intent: STAFF_INTENTS[command] }).catch(() => undefined);
    return { outcome: "not_claimed", reason };
  }

  // One answers from here on, whatever happens.
  let composed: Composed;
  try {
    composed = await compose(command, identity, deps, now);
  } catch {
    const language = identity.state === "linked" ? identity.staff.language : identity.language;
    composed = { message: staffSorryReply(language, safeOrigin(deps)), intent: STAFF_INTENTS[command], note: "compose_crashed", resend: [], staff: null };
  }
  let note = composed.note;
  let sent = await safeSend(deps, helperMessageBody(from, composed.message));
  if (worthPlainRetry(sent, composed.message)) {
    sent = await safeSend(deps, helperMessageBody(from, plainVersion(composed.message)));
    note = note ?? "sent_as_plain_text";
  }
  if (sent.outcome !== "accepted") {
    const finished = deps.now();
    await deps.finishTurn(message.providerMessageId, {
      status: "failed",
      reason: sendFailure(sent),
      intent: composed.intent,
      route: "rule",
      latencyMs: finished.getTime() - wroteAt.getTime(),
    }).catch(() => undefined);
    return { outcome: "failed", reason: sendFailure(sent) };
  }

  if (composed.staff && composed.resend.length > 0) {
    const helperName = await deps.readHelperName().catch(() => "Veer Patta AI");
    const went = await resendQuestions({ to: from, staff: composed.staff, open: composed.resend, helperName, deps });
    note = note ?? (went === composed.resend.length ? null : `questions_sent:${went}/${composed.resend.length}`);
  }
  const finished = deps.now();
  await deps.finishTurn(message.providerMessageId, {
    status: "answered",
    reason: note,
    intent: composed.intent,
    route: "rule",
    replyMessageId: sent.messageId,
    latencyMs: finished.getTime() - wroteAt.getTime(),
  }).catch(() => undefined);
  // Their chat with the school is open now, so the next alert to them can be typed.
  await deps.saveChat(from, {}, finished).catch(() => undefined);
  return { outcome: "answered", route: "rule", intent: composed.intent, handoff: null };
}
