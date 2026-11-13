import "server-only";

import { getAssistSettings } from "@/modules/assist/data/settings";
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
import { dailyTurnCap, type ChatPatch, type TurnRoute } from "@/modules/whatsapp/domain/helper-plan";
import { staffAlertText, staffLanguage, type StaffLanguage } from "@/modules/whatsapp/domain/helper-handoff";
import { helperMessageBody, plainVersion, type HelperMessage } from "@/modules/whatsapp/domain/helper-messages";
import { messageKind, type MessageKind } from "@/modules/whatsapp/domain/helper-text";
import {
  backToStaffNote,
  collectionReply,
  coverReply,
  deskCommands,
  deskMenuReply,
  deskSubjectOf,
  duesReply,
  feesElsewhereReply,
  firstHatNote,
  firstOnDesk,
  leaveReply,
  needsYouReply,
  notOnDeskNote,
  ownerParentReply,
  parentLikeNote,
  roleListReply,
  rolesOnlyOwnerNote,
  schoolReply,
  staffAwayReply,
  staffParentReply,
  switchedNote,
  typeItNote,
  unclearNote,
  withDeskButtons,
  withLeadNote,
  type AwayFacts,
  type CoverFacts,
  type DeskContext,
  type DeskRead,
  type FeeFacts,
  type LeaveFacts,
  type LinkedStaff,
  type NeedsYouFacts,
  type SchoolFacts,
} from "@/modules/whatsapp/domain/staff-desk";
import {
  QUESTIONS_AT_ONCE,
  STAFF_INTENTS,
  absentReply,
  linkFirstReply,
  questionsReply,
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
} from "@/modules/whatsapp/domain/staff-helper";
import { OWNER_DEFAULT_HAT, ownerPassesAsParent, routeStaffMessage, type StaffRoute, type StaffWho } from "@/modules/whatsapp/domain/staff-route";
import { keywordCommands, readStaffAsk, writesHindi, type StaffCommand, type StaffHat } from "@/modules/whatsapp/domain/staff-words";
import { testAccountFlags } from "@/platform/auth/current-staff";
import { can, resolveStaffRole, type StaffRole } from "@/platform/auth/permissions";
import { SCHOOL_UTC_OFFSET_MINUTES, schoolToday } from "@/platform/dates";
import { FEE_SCHEMA, getSiteUrl } from "@/platform/env";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { logInfo } from "@/platform/observability/log";
import { readWhatsAppConfig, type WhatsAppConfig } from "@/platform/whatsapp/config";
import { maskNumber, sameNumber, toE164 } from "@/platform/whatsapp/numbers";
import { textMessageBody } from "@/platform/whatsapp/payload";
import { checkWhatsAppSend, type WhatsAppSwitches } from "@/platform/whatsapp/policy";
import { HUB_CODES, providerFor, type ClaimResult, type ProviderSendResult } from "@/platform/whatsapp/providers";
import { readSwitches, whatsappDb } from "@/platform/whatsapp/store";
import type { WebhookInbound } from "@/platform/whatsapp/webhook";
import { subjectNamer } from "@/vx/screens/exams/domain/groups";
import { leaveNow } from "@/vx/screens/teach/domain/today";

import { hasClaudeKey } from "./helper-claude";
import { insertAlert, readOpenHandoffsFor, type AlertRecord, type OpenHandoff } from "./helper-handoffs";
import { finishTurn, readBudget, readHelperSettings, saveChat, startTurn, type TurnFinish, type TurnStages } from "./helper-store";
import { askStaffClaude, type StaffClaudeTurn } from "./staff-claude";
import {
  readCoverToday,
  readDesk as readStaffDesk,
  readFeeFigures,
  readLeaveAsked,
  readNeedsYou as readStaffNeedsYou,
  readPracticeSeat,
  readSchoolToday,
  readStaffAway,
  readStaffHat,
  saveStaffHat,
} from "./staff-desk";

/**
 * Veer Patta AI for the school's own people (D-591, D-607), the database and
 * the WhatsApp side. The words are in `domain/staff-words.ts`, who answers
 * as whom in `domain/staff-route.ts`, each role's desk and its answers in
 * `domain/staff-desk.ts` and `domain/staff-helper.ts`.
 *
 * Who is asking is the phone, never the message:
 *
 *  - The owner's test number is answered as the role he is trying, the
 *    admin's until he picks another, through that role's test account (a
 *    practice seat, `data/staff-desk.ts`) on the practice records; or, after
 *    *as parent*, by the parents' helper, as the practice family's parent.
 *  - A number a member of staff linked from that very phone (a used Link my
 *    WhatsApp code sent from it, D-582), active and with WhatsApp on, is
 *    answered as their own role, whatever they type, until they choose to
 *    write to the school as a parent.
 *  - A number that is on a staff record only because somebody typed it is
 *    asked to link itself first when it uses a staff word, and shown nothing.
 *  - Everybody else is the parents' helper's.
 *
 * Every read is for that one person, as their screens would read it: their
 * own periods and cover, the register of the class they hold, the
 * hand-offs that are theirs, Needs you by its own rule, the school's day
 * through the same checks as the AI connection's tools, and fee figures for
 * a TEST session only. Real staff read the school's active year, a test
 * account `TEST-2026-27`. Typed words are understood by Claude when the AI
 * helper is on (it is shown only the words and the names of the asks, and
 * only chooses which ask it is), and by keywords when it is not.
 *
 * Nothing here writes except the turn's ledger row, the chat's last time and
 * its role, and, for *questions*, the alert rows that let a swipe on a
 * waiting question answer it. The reply goes only when the helper may answer
 * this number at all (its switch, practice mode, real recipients), as every
 * message is.
 */

type Db = ReturnType<typeof whatsappDb>;

export type { LinkedStaff } from "@/modules/whatsapp/domain/staff-desk";

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
  user_id: string | null;
  display_name: string | null;
  short_name: string | null;
  role: string | null;
  is_active: boolean | null;
  is_test_account: boolean | null;
  is_teaching: boolean | null;
  preferred_language: string | null;
  whatsapp_opt_in_at: string | null;
  whatsapp_opt_out_at: string | null;
};

const PROFILE_COLUMNS =
  "id, user_id, display_name, short_name, role, is_active, is_test_account, is_teaching, preferred_language, whatsapp_opt_in_at, whatsapp_opt_out_at";

const INDIAN_MOBILE = /^\+91[6-9]\d{9}$/;

/**
 * The ways a number is written on a staff record: Link my WhatsApp writes
 * the last ten digits (`link_staff_whatsapp`); the staff form and older
 * records keep the whole number, with or without its plus.
 */
function phoneForms(from: string): string[] {
  return [...new Set([from.slice(-10), from, from.slice(1)])];
}

/**
 * Who this number is, as staff. When it links more than one profile (a
 * person who linked their phone to a test account as well as their own), the
 * newest link from this phone is the one that stands. Null when it could not
 * be read.
 */
export async function readLinkedStaff(from: string, db: Db = whatsappDb()): Promise<StaffIdentity | null> {
  if (!INDIAN_MOBILE.test(from)) return { state: "none" };
  try {
    const { data: rows, error } = await db
      .from("staff_profiles")
      .select(PROFILE_COLUMNS)
      .in("whatsapp_phone", phoneForms(from))
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
        userId: proven.user_id,
        name: (proven.display_name ?? proven.short_name ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
        role,
        isTest,
        language,
        permissions: granted.map((row) => row.permission),
        isTeaching: proven.is_teaching === true,
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

/** Everything a staff turn reads and writes, so a test can stand in for each. */
export type StaffHelperDeps = {
  now: () => Date;
  readIdentity: (from: string) => Promise<StaffIdentity | null>;
  /** Which way this chat is answered now (D-607): the role the owner's number is trying, or "parent". */
  readHat: (from: string) => Promise<StaffHat | null>;
  saveHat: (from: string, hat: StaffHat | null, at: Date) => Promise<void>;
  /** The test account the owner's number answers as in a role (D-607), on the school's day; null when there is none. */
  readSeat: (role: StaffRole, language: StaffLanguage, day: string) => Promise<LinkedStaff | null>;
  readSession: (staff: Pick<LinkedStaff, "role" | "isTest">) => Promise<string | null>;
  /** The classes they hold today, and who they are to parents' suggestions. */
  readDesk: (staff: LinkedStaff, sessionLabel: string, day: string) => Promise<DeskRead | null>;
  readDay: (staff: LinkedStaff, sessionLabel: string, now: Date) => Promise<DayFacts | null>;
  readQuestions: (staff: LinkedStaff) => Promise<OpenHandoff[] | null>;
  readAbsent: (staff: LinkedStaff, sessionLabel: string, day: string) => Promise<AbsentFacts | null>;
  readNeedsYou: (staff: LinkedStaff, sessionLabel: string, day: string, now: Date, desk: DeskRead) => Promise<NeedsYouFacts | null>;
  readSchool: (staff: LinkedStaff, sessionLabel: string, day: string) => Promise<SchoolFacts | null>;
  readAway: (staff: LinkedStaff, sessionLabel: string, day: string) => Promise<AwayFacts | null>;
  readCover: (staff: LinkedStaff, sessionLabel: string, day: string) => Promise<CoverFacts | null>;
  readLeave: (staff: LinkedStaff, sessionLabel: string) => Promise<LeaveFacts | null>;
  /** A TEST session's fee figures; "elsewhere" for a real year's (the Fees app's). */
  readFees: (sessionLabel: string, day: string, query: string | null) => Promise<FeeFacts | "elsewhere" | null>;
  /** The AI helper's switch and the school's monthly AI budget, or null when unreadable. */
  readAiSettings: () => Promise<{ enabled: boolean; monthlyBudgetUsd: number } | null>;
  hasClaudeKey: () => boolean;
  askClaude: typeof askStaffClaude;
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
    readHat: (from) => readStaffHat(from),
    saveHat: (from, hat, at) => saveStaffHat(from, hat, at),
    readSeat: (role, language, day) => readPracticeSeat(role, language, day),
    readSession: (staff) => sessionLabelForStaff({ role: staff.role, isTestAccount: staff.isTest }).catch(() => null),
    readDesk: (staff, sessionLabel, day) => readStaffDesk(staff, sessionLabel, day),
    readDay: (staff, sessionLabel, now) => readStaffDay(staff, sessionLabel, now),
    readQuestions: (staff) => readOpenHandoffsFor(staff.staffId, staff.isTest),
    readAbsent: (staff, sessionLabel, day) => readStaffAbsent(staff, sessionLabel, day),
    readNeedsYou: (staff, sessionLabel, day, now, desk) => readStaffNeedsYou(staff, sessionLabel, day, now, desk),
    readSchool: (staff, sessionLabel, day) => readSchoolToday(staff, sessionLabel, day),
    readAway: (staff, sessionLabel, day) => readStaffAway(staff, sessionLabel, day),
    readCover: (staff, sessionLabel, day) => readCoverToday(staff, sessionLabel, day),
    readLeave: (staff, sessionLabel) => readLeaveAsked(staff, sessionLabel),
    readFees: (sessionLabel, day, query) => readFeeFigures(sessionLabel, day, query),
    readAiSettings: async () => {
      try {
        const settings = await getAssistSettings();
        return { enabled: settings.enabled, monthlyBudgetUsd: settings.monthlyBudgetUsd };
      } catch {
        return null;
      }
    },
    hasClaudeKey,
    askClaude: askStaffClaude,
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
  | { outcome: "answered"; route: TurnRoute; intent: string; handoff: null }
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

/** A read that never rejects, even when the function itself throws before it can return a promise. */
function quietly<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  return Promise.resolve()
    .then(read)
    .catch(() => fallback);
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

/* ----------------------------------------------------------- who is writing */

function whoIs(owner: boolean, identity: StaffIdentity | null, hat: StaffHat | null): StaffWho {
  if (owner) return { kind: "owner", hat };
  if (!identity || identity.state === "none") return { kind: "none" };
  if (identity.state === "unproven") return { kind: "unproven" };
  if (identity.state === "stopped") return { kind: "stopped" };
  return { kind: "linked", hat };
}

/** Their language in One; the owner's number reads the owner's record the same way, and English when it is on none. */
function profileLanguage(identity: StaffIdentity | null): StaffLanguage {
  if (!identity || identity.state === "none") return "en";
  return identity.state === "linked" ? identity.staff.language : identity.language;
}

/** The owner's number tries the practice records; otherwise a test account's turns are the practice ones (D-590). */
function isPractice(owner: boolean, identity: StaffIdentity | null): boolean {
  if (owner) return true;
  if (!identity || identity.state === "none") return false;
  return identity.state === "linked" ? identity.staff.isTest : identity.isTest;
}

function turnKind(message: WebhookInbound): Exclude<MessageKind, "ignore"> {
  if (message.raw?.type === "interactive") return "tap";
  const kind = messageKind(message.type, message.raw);
  return kind === "ignore" ? "text" : kind;
}

type Answering = Exclude<StaffRoute, { route: "pass" }>;
type DeskRoute = Extract<StaffRoute, { route: "desk" }>;

/** The ledger's word for a turn before it is worked out: what a turn the hub kept was asking. */
function intentOf(route: Answering): string {
  switch (route.route) {
    case "link_first":
      return STAFF_INTENTS.linkFirst;
    case "stopped":
      return STAFF_INTENTS.stopped;
    case "roles":
      return STAFF_INTENTS.roles;
    case "parent":
      return STAFF_INTENTS.hat;
    case "desk":
      if (route.note === "switched" || route.note === "back") return STAFF_INTENTS.hat;
      if (route.note === "roles_owner_only") return STAFF_INTENTS.roles;
      if (route.ask.kind === "command") return STAFF_INTENTS[route.ask.to[0] ?? "menu"];
      if (route.ask.kind === "text") return STAFF_INTENTS.text;
      return STAFF_INTENTS.menu;
  }
}

/* ------------------------------------------------------------- the answer */

/** Who a desk answers as, their year, and their desk. */
type DeskSetup = { staff: LinkedStaff; sessionLabel: string; desk: DeskRead; day: string };

type Prepared = {
  helperName: string;
  /** Null for a turn that needs no desk (linking, a role list, writing as a parent). */
  desk: DeskSetup | { problem: string } | null;
  ai: { enabled: boolean; monthlyBudgetUsd: number } | null;
};

/**
 * The person a desk answers as (the owner's practice seat for the role he is
 * trying, or the member of staff), their year, and the classes they hold.
 */
async function setUpDesk(
  input: { route: DeskRoute; owner: boolean; identity: StaffIdentity | null; language: StaffLanguage; day: string },
  deps: StaffHelperDeps,
): Promise<DeskSetup | { problem: string }> {
  const { route, owner, identity, language, day } = input;
  const staff = owner
    ? await quietly(() => deps.readSeat(route.hat ?? OWNER_DEFAULT_HAT, language, day), null)
    : identity?.state === "linked"
      ? { ...identity.staff, language }
      : null;
  if (!staff) return { problem: owner ? "seat_unreadable" : "not_linked" };
  const sessionLabel = await quietly(() => deps.readSession(staff), null);
  if (!sessionLabel) return { problem: "session_unreadable" };
  const desk = await quietly(() => deps.readDesk(staff, sessionLabel, day), null);
  if (!desk) return { problem: "desk_unreadable" };
  return { staff, sessionLabel, desk, day };
}

/**
 * What every answer needs, read while the hub is asked for the message (as
 * the parents' helper reads a family's records, D-605), so the person waits
 * only for what is left. Never rejects.
 */
function prepare(input: { route: Answering; owner: boolean; identity: StaffIdentity | null; language: StaffLanguage; day: string }, deps: StaffHelperDeps): Promise<Prepared> {
  const { route } = input;
  const desk = route.route === "desk" ? setUpDesk({ ...input, route }, deps).catch(() => ({ problem: "desk_unreadable" })) : Promise.resolve(null);
  const ai = route.route === "desk" && route.ask.kind === "text" ? quietly(() => deps.readAiSettings(), null) : Promise.resolve(null);
  return Promise.all([quietly(() => deps.readHelperName(), "Veer Patta AI"), desk, ai]).then(([helperName, setup, settings]) => ({
    helperName,
    desk: setup,
    ai: settings,
  }));
}

type Composed = {
  message: HelperMessage;
  intent: string;
  /** Why the answer is what it is, for the ledger: a read that failed, an ask not on the desk. */
  reason: string | null;
  resend: OpenHandoff[];
  staff: LinkedStaff | null;
  helperName: string;
  /** Claude's reading of typed words, when it was asked, and how long it took. */
  claude: StaffClaudeTurn | null;
  aiMs: number | null;
  /** How long the reads begun before the claim were still waited for after it. */
  waitedMs: number | null;
};

type ComposeInput = {
  route: Answering;
  from: string;
  owner: boolean;
  language: StaffLanguage;
  now: Date;
  preparing: Promise<Prepared>;
  /** This month's AI spend, against the school's AI budget. */
  spentUsd: number;
};

/** The chat's role, changed; false when it could not be saved (the answer still goes). */
async function saveHat(deps: StaffHelperDeps, from: string, hat: StaffHat | null, at: Date): Promise<boolean> {
  try {
    await deps.saveHat(from, hat, at);
    return true;
  } catch {
    return false;
  }
}

async function compose(input: ComposeInput, deps: StaffHelperDeps): Promise<Composed> {
  const { route, from, owner, language, now } = input;
  const origin = safeOrigin(deps);
  const waitFrom = deps.now().getTime();
  const ready = await input.preparing;
  const waitedMs = deps.now().getTime() - waitFrom;
  const { helperName } = ready;
  const plain = { resend: [] as OpenHandoff[], staff: null, helperName, claude: null, aiMs: null, waitedMs };
  switch (route.route) {
    case "link_first":
      return { ...plain, message: linkFirstReply(language, helperName), intent: STAFF_INTENTS.linkFirst, reason: null };
    case "stopped":
      return { ...plain, message: stoppedReply(language), intent: STAFF_INTENTS.stopped, reason: null };
    case "roles":
      return { ...plain, message: roleListReply({ language, helperName, current: route.current }), intent: STAFF_INTENTS.roles, reason: null };
    case "parent": {
      const saved = await saveHat(deps, from, "parent", now);
      return {
        ...plain,
        message: owner ? ownerParentReply(language, helperName) : staffParentReply(language, helperName),
        intent: STAFF_INTENTS.hat,
        reason: saved ? null : "hat_unsaved",
      };
    }
    case "desk":
      return composeDesk({ ...input, route, ready, origin, waitedMs }, deps);
  }
}

type Decided = { message: HelperMessage; intent: string; reason: string | null; resend?: OpenHandoff[]; noted?: true };

async function composeDesk(
  input: ComposeInput & { route: DeskRoute; ready: Prepared; origin: string; waitedMs: number },
  deps: StaffHelperDeps,
): Promise<Composed> {
  const { route, from, owner, language, now, ready, origin, waitedMs } = input;
  const { helperName } = ready;
  const saved = route.save === undefined || (await saveHat(deps, from, route.save, now));
  const hatProblem = saved ? null : "hat_unsaved";
  const setup = ready.desk;
  if (!setup || "problem" in setup) {
    return {
      message: staffSorryReply(language, origin),
      intent: intentOf(route),
      reason: setup && "problem" in setup ? setup.problem : "desk_unreadable",
      resend: [],
      staff: null,
      helperName,
      claude: null,
      aiMs: null,
      waitedMs,
    };
  }
  const { staff, sessionLabel, desk, day } = setup;
  const commands = deskCommands(deskSubjectOf(staff, desk));
  const ctx: DeskContext = {
    language,
    name: staff.name,
    helperName,
    practice: staff.isTest,
    sessionLabel,
    origin,
    role: staff.role,
    commands,
    ownerHat: owner ? staff.role : null,
  };

  // The line a change of role says before the answer.
  const lead =
    route.note === "switched"
      ? switchedNote({ language, hat: staff.role, seatName: staff.name })
      : route.note === "first"
        ? firstHatNote({ language, hat: staff.role, seatName: staff.name })
        : route.note === "back"
          ? backToStaffNote(language)
          : route.note === "roles_owner_only"
            ? rolesOnlyOwnerNote(language)
            : null;

  const menu = (note: string | null, intent: string, reason: string | null = null): Decided => ({
    message: deskMenuReply(ctx, { owner, canWriteAsParent: !owner, note: [lead, note].filter(Boolean).join("\n\n") || null }),
    intent,
    reason,
    noted: true,
  });
  const done = (command: StaffCommand, message: HelperMessage): Decided => ({ message, intent: STAFF_INTENTS[command], reason: null });
  const sorry = (command: StaffCommand, reason: string): Decided => ({
    message: withDeskButtons(staffSorryReply(language, origin), ctx, command),
    intent: STAFF_INTENTS[command],
    reason,
  });

  const run = async (command: Exclude<StaffCommand, "menu" | "roles">, query: string | null): Promise<Decided> => {
    switch (command) {
      case "today": {
        const facts = await quietly(() => deps.readDay(staff, sessionLabel, now), null);
        return facts ? done(command, withDeskButtons(todayReply(facts, ctx), ctx, command)) : sorry(command, "day_unreadable");
      }
      case "questions": {
        const open = await quietly(() => deps.readQuestions(staff), null);
        if (!open) return sorry(command, "questions_unreadable");
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
        return { ...done(command, withDeskButtons(message, ctx, command)), resend };
      }
      case "absent": {
        const facts = await quietly(() => deps.readAbsent(staff, sessionLabel, day), null);
        return facts ? done(command, withDeskButtons(absentReply(facts, ctx), ctx, command)) : sorry(command, "absent_unreadable");
      }
      case "needs_you": {
        const facts = await quietly(() => deps.readNeedsYou(staff, sessionLabel, day, now, desk), null);
        return facts ? done(command, needsYouReply(facts, ctx)) : sorry(command, "needs_you_unreadable");
      }
      case "school": {
        const facts = await quietly(() => deps.readSchool(staff, sessionLabel, day), null);
        return facts ? done(command, schoolReply(facts, ctx)) : sorry(command, "school_unreadable");
      }
      case "staff_away": {
        const facts = await quietly(() => deps.readAway(staff, sessionLabel, day), null);
        return facts ? done(command, staffAwayReply(facts, ctx)) : sorry(command, "away_unreadable");
      }
      case "cover": {
        const facts = await quietly(() => deps.readCover(staff, sessionLabel, day), null);
        return facts ? done(command, coverReply(facts, ctx)) : sorry(command, "cover_unreadable");
      }
      case "leave": {
        const facts = await quietly(() => deps.readLeave(staff, sessionLabel), null);
        return facts ? done(command, leaveReply(facts, ctx)) : sorry(command, "leave_unreadable");
      }
      case "collection":
      case "dues": {
        const fees = await quietly(() => deps.readFees(sessionLabel, day, command === "dues" ? query : null), null);
        if (fees === "elsewhere") return done(command, feesElsewhereReply(ctx, command));
        if (!fees) return sorry(command, "fees_unreadable");
        return done(command, command === "collection" ? collectionReply(fees, ctx) : duesReply(fees, ctx));
      }
    }
  };

  /** The first of the asks this desk has; the menu, saying so, when it has none of them. */
  const answer = async (to: readonly StaffCommand[], query: string | null): Promise<Decided> => {
    const command = firstOnDesk(to, commands);
    const wanted = to[0] ?? "menu";
    if (!command) return menu(notOnDeskNote(wanted, language), STAFF_INTENTS.menu, `not_on_desk:${wanted}`);
    if (command === "menu") return menu(null, STAFF_INTENTS.menu);
    if (command === "roles") {
      if (!owner) return menu(rolesOnlyOwnerNote(language), STAFF_INTENTS.roles);
      return { message: roleListReply({ language, helperName, current: staff.role }), intent: STAFF_INTENTS.roles, reason: null };
    }
    return run(command, query);
  };

  let claude: StaffClaudeTurn | null = null;
  let aiMs: number | null = null;
  const ask = route.ask;
  let decided: Decided;
  if (ask.kind === "menu") {
    const intent = route.note === "switched" || route.note === "back" ? STAFF_INTENTS.hat : route.note === "roles_owner_only" ? STAFF_INTENTS.roles : STAFF_INTENTS.menu;
    decided = menu(null, intent);
  } else if (ask.kind === "none") {
    // A voice note or a photo: the desk reads typed words and taps.
    decided = menu(typeItNote(language), STAFF_INTENTS.menu, "not_typed");
  } else if (ask.kind === "command") {
    decided = await answer(ask.to, ask.query);
  } else {
    const ai = ready.ai;
    let keyThere = false;
    try {
      keyThere = deps.hasClaudeKey();
    } catch {
      keyThere = false;
    }
    if (keyThere && ai !== null && ai.enabled && input.spentUsd < ai.monthlyBudgetUsd) {
      const askedAt = deps.now().getTime();
      claude = await quietly(() => deps.askClaude({ helperName, role: staff.role, commands, owner, text: ask.text }), null);
      aiMs = deps.now().getTime() - askedAt;
    }
    const reading = claude?.understood ?? null;
    if (reading?.kind === "parent") {
      // Never passed on as a parent's message by itself: the way to do it is said.
      decided = menu(parentLikeNote(language, owner), STAFF_INTENTS.menu, "parent_like");
    } else if (reading?.kind === "unclear") {
      decided = menu(unclearNote(language), STAFF_INTENTS.unclear);
    } else if (reading?.kind === "command") {
      decided = await answer([reading.command], reading.query);
    } else {
      // Claude is off or could not say: the keywords, and only what is on this desk.
      const guesses = keywordCommands(ask.text);
      const onDesk = firstOnDesk(guesses, commands);
      decided = onDesk ? await answer([onDesk], null) : menu(unclearNote(language), STAFF_INTENTS.unclear, guesses[0] ? `not_on_desk:${guesses[0]}` : null);
    }
  }

  const aiProblem = claude && !claude.understood && claude.problem ? `ai_${claude.problem}` : null;
  return {
    message: decided.noted ? decided.message : withLeadNote(decided.message, lead),
    intent: decided.intent,
    reason: decided.reason ?? hatProblem ?? aiProblem,
    resend: decided.resend ?? [],
    staff,
    helperName,
    claude,
    aiMs,
    waitedMs,
  };
}

/**
 * A message from a member of staff, or from the owner's number in a role
 * (D-591, D-607), answered as their desk. Null when it is not one: then it
 * is an ordinary message, and the parents' helper (or the hub's bot)
 * answers it. A parent's message waits here only for three small reads,
 * side by side; `switchesRead` is the turn's own read of the switches, when
 * it has begun one, so they are read once.
 */
export async function handleStaffCommand(
  message: WebhookInbound,
  deps: StaffHelperDeps,
  switchesRead?: Promise<WhatsAppSwitches | null>,
): Promise<StaffCommandOutcome | null> {
  const ask = readStaffAsk(message);
  // Somebody else's button (the parents' helper's) is theirs to answer.
  if (ask.kind === "foreign") return null;
  const from = toE164(message.from);
  if (!from) return null;
  const started = deps.now();

  // Who is writing: the owner's test number, a member of staff, or neither,
  // and which way the chat is answered now.
  const identityRead = quietly(() => deps.readIdentity(from), null);
  const hatRead = quietly(() => deps.readHat(from), null);
  const switches = await (switchesRead ? switchesRead.catch(() => null) : quietly(() => deps.readSwitches(), null));
  const owner = sameNumber(from, switches?.ownerTestNumber ?? null);
  const hat = await hatRead;
  // The owner writing as a parent goes on before anything else is waited for.
  if (owner && ownerPassesAsParent(ask, hat)) return null;
  const identity = await identityRead;
  const route = routeStaffMessage(ask, whoIs(owner, identity, hat));
  if (route.route === "pass") return null;

  // Hindi letters are answered in Hindi, whatever the profile says.
  const language: StaffLanguage = writesHindi(message.text) ? "hi" : profileLanguage(identity);
  const verdict = checkWhatsAppSend({ feature: "parent_helper", to: from, switches, config: deps.readConfig(), kind: "text", wroteInLast24h: true });
  logInfo("whatsapp.staff_helper", { route: route.route, ask: ask.kind, owner, state: identity?.state ?? null, from: maskNumber(from), reply: verdict.decision });
  // The hub's bot answers when One may not.
  if (verdict.decision === "dry_run") return { outcome: "skipped", reason: "practice_mode" };
  if (verdict.decision === "refuse") return { outcome: "skipped", reason: verdict.code };
  const claimMessage = deps.claim;
  if (!claimMessage) return { outcome: "skipped", reason: "cannot_claim" };

  const budget = await quietly(() => deps.readBudget(from, started), null);
  if (!budget) return { outcome: "skipped", reason: "budget_unreadable" };
  if (budget.turnsToday >= dailyTurnCap(owner)) return { outcome: "skipped", reason: "daily_cap" };

  const sentAt = Date.parse(message.at);
  const wroteAt = Number.isFinite(sentAt) ? sentAt : started.getTime();
  const ledger = await quietly(
    () =>
      deps.startTurn({
        providerMessageId: message.providerMessageId,
        from,
        receivedAt: new Date(wroteAt).toISOString(),
        kind: turnKind(message),
        practice: isPractice(owner, identity),
      }),
    "failed" as const,
  );
  if (ledger === "duplicate") return { outcome: "skipped", reason: "duplicate" };
  if (ledger === "failed") return { outcome: "skipped", reason: "ledger_failed" };

  // The desk and the AI switch are read while the hub is asked.
  const preparing = prepare({ route, owner, identity, language, day: schoolToday(started) }, deps);
  const asked = deps.now().getTime();
  const stages: TurnStages = { before: started.getTime() - wroteAt, checks: asked - started.getTime() };
  const claim = await quietly(() => claimMessage(message.providerMessageId), null);
  const claimedAt = deps.now().getTime();
  stages.claim = claimedAt - asked;
  stages.dots = claimedAt - wroteAt;
  if (!claim || !claim.ok || !claim.claimed) {
    const reason = claimNote(claim);
    await quietly(() => deps.finishTurn(message.providerMessageId, { status: "not_claimed", reason, intent: intentOf(route) }), undefined);
    return { outcome: "not_claimed", reason };
  }

  // One answers from here on, whatever happens.
  let composed: Composed;
  try {
    composed = await compose({ route, from, owner, language, now: started, preparing, spentUsd: budget.spentUsd }, deps);
  } catch {
    composed = {
      message: staffSorryReply(language, safeOrigin(deps)),
      intent: intentOf(route),
      reason: "compose_crashed",
      resend: [],
      staff: null,
      helperName: "Veer Patta AI",
      claude: null,
      aiMs: null,
      waitedMs: null,
    };
  }
  const composedAt = deps.now().getTime();
  if (composed.waitedMs !== null) stages.family = composed.waitedMs;
  stages.compose = composedAt - claimedAt;
  if (composed.aiMs !== null) stages.ai = composed.aiMs;
  const turnRoute: TurnRoute = composed.claude ? (composed.claude.understood ? "ai" : "fallback") : "rule";
  const spend = composed.claude ? { model: composed.claude.model, costUsd: composed.claude.costUsd } : {};

  let reason = composed.reason;
  let sent = await safeSend(deps, helperMessageBody(from, composed.message));
  if (worthPlainRetry(sent, composed.message)) {
    sent = await safeSend(deps, helperMessageBody(from, plainVersion(composed.message)));
    reason = reason ?? "sent_as_plain_text";
  }
  const sentDone = deps.now().getTime();
  stages.send = sentDone - composedAt;
  if (sent.outcome !== "accepted") {
    const failure = sendFailure(sent);
    const intent = composed.intent;
    await quietly(
      () =>
        deps.finishTurn(message.providerMessageId, {
          status: "failed",
          reason: failure,
          intent,
          route: turnRoute,
          ...spend,
          latencyMs: sentDone - wroteAt,
          stages,
        }),
      undefined,
    );
    return { outcome: "failed", reason: failure };
  }
  const replyMessageId = sent.messageId;

  if (composed.staff && composed.resend.length > 0) {
    const went = await resendQuestions({ to: from, staff: composed.staff, open: composed.resend, helperName: composed.helperName, deps });
    reason = reason ?? (went === composed.resend.length ? null : `questions_sent:${went}/${composed.resend.length}`);
  }
  const finished = deps.now();
  const answered: TurnFinish = {
    status: "answered",
    reason,
    intent: composed.intent,
    route: turnRoute,
    ...spend,
    replyMessageId,
    latencyMs: sentDone - wroteAt,
    stages,
  };
  await quietly(() => deps.finishTurn(message.providerMessageId, answered), undefined);
  // Their chat with the school is open now, so the next alert to them can be typed.
  await quietly(() => deps.saveChat(from, {}, finished), undefined);
  return { outcome: "answered", route: turnRoute, intent: composed.intent, handoff: null };
}
