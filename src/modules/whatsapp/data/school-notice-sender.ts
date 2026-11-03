import "server-only";

import { randomUUID } from "node:crypto";

import { fetchAllPages } from "@/platform/helpers/chunk";
import { sendAisensyCampaignMessage, isAisensyConfigured } from "@/modules/whatsapp/data/aisensy";
import { istHour, readNumberSetting } from "@/modules/whatsapp/data/guard-context";
import { DEFAULT_QUIET_HOURS } from "@/modules/whatsapp/domain/send-guards";
import { toWhatsappDestination } from "@/modules/whatsapp/domain/phone";
import { isNoticeLanguage, type NoticeLanguage } from "@/modules/whatsapp/domain/campaigns";
import {
  isSchoolNoticeApproved,
  schoolNoticeFor,
  SCHOOL_NOTICE_MONTHLY_BUDGET,
  type SchoolNoticeKind,
} from "@/modules/whatsapp/domain/school-notices";
import { schoolNoticeTemplate } from "@/modules/whatsapp/domain/school-notice-bodies";
import { studentsLine } from "@/modules/whatsapp/domain/campaign-bodies-v6";

/**
 * Sending a school notice: who is on the roll, who can be reached, and the one
 * executor that messages them.
 *
 * Deliberately small beside the fee executor. There is no money to quote, no
 * cadence to honour and no ledger to drain first — but the rules that protect a
 * family are the same ones: a no-call family is not contacted, the row is
 * claimed BEFORE the provider call so two staff cannot double-send, nothing goes
 * out in quiet hours, and a household notice is one message per phone.
 */

export type RosterStudent = {
  studentId: string;
  admissionNo: string;
  studentName: string;
  studentClass: string;
  classId: string | null;
  classSortOrder: number;
  /** Null when there is no usable WhatsApp number. */
  destination: string | null;
  noCall: boolean;
  /** The family's own language; null means "use the batch's". */
  language: NoticeLanguage | null;
};

function titleCase(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b[a-z]/g, (character) => character.toUpperCase())
    .trim();
}

/**
 * Every student ON THE ROLL this session — headcount's rule, not money's: a
 * child who has left is not absent, and is not sitting an exam.
 */
export async function loadSchoolRoster(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sessionLabel: string,
): Promise<RosterStudent[]> {
  const [financials, flags] = await Promise.all([
    fetchAllPages<{
      student_id: string;
      admission_no: string | null;
      student_name: string | null;
      father_phone: string | null;
      mother_phone: string | null;
      class_id: string | null;
      class_label: string | null;
      sort_order: number | null;
      record_status: string | null;
    }>((from, to) =>
      supabase
        .from("v_workbook_student_financials")
        .select(
          "student_id, admission_no, student_name, father_phone, mother_phone, class_id, class_label, sort_order, record_status",
        )
        .eq("session_label", sessionLabel)
        .eq("record_status", "active")
        .order("student_id", { ascending: true })
        .range(from, to),
    ),
    fetchAllPages<{ student_id: string; no_call: boolean | null; whatsapp_language: string | null }>(
      (from, to) =>
        supabase
          .from("student_collection_flags")
          .select("student_id, no_call, whatsapp_language")
          .eq("session_label", sessionLabel)
          .order("student_id", { ascending: true })
          .range(from, to),
    ),
  ]);

  if (financials.error) throw new Error("Could not read the class rolls.");
  // Failing open on the flags would message families who asked not to be
  // contacted, which is the one thing this must never do.
  if (flags.error) throw new Error("Could not read the no-call flags.");

  const flagById = new Map(flags.data.map((row) => [row.student_id, row]));

  return financials.data
    .map((row) => {
      const flag = flagById.get(row.student_id);
      return {
        studentId: row.student_id,
        admissionNo: String(row.admission_no ?? ""),
        studentName: titleCase(row.student_name),
        studentClass: row.class_label ?? "",
        classId: row.class_id,
        classSortOrder: Number(row.sort_order ?? 0),
        destination: toWhatsappDestination(row.father_phone) ?? toWhatsappDestination(row.mother_phone),
        noCall: flag?.no_call === true,
        language: isNoticeLanguage(flag?.whatsapp_language) ? (flag!.whatsapp_language as NoticeLanguage) : null,
      };
    })
    .sort(
      (left, right) =>
        left.classSortOrder - right.classSortOrder || left.studentName.localeCompare(right.studentName),
    );
}

export type SchoolNoticeOutcome = {
  status: "success" | "partial" | "error";
  message: string;
  sent: number;
  failed: number;
  skippedNoCall: number;
  skippedNoNumber: number;
  alreadySent: number;
  batchId: string | null;
};

/** "Before 8 in the morning or after 8 at night" — the same window the fee lane keeps. */
export async function schoolNoticeQuietHoursMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  now = new Date(),
): Promise<string | null> {
  const [start, end] = await Promise.all([
    readNumberSetting(supabase, "whatsapp_quiet_hours_start"),
    readNumberSetting(supabase, "whatsapp_quiet_hours_end"),
  ]);
  const quiet = { start: start ?? DEFAULT_QUIET_HOURS.start, end: end ?? DEFAULT_QUIET_HOURS.end };
  const hour = istHour(now);
  if (hour >= quiet.start && hour < quiet.end) return null;
  return `It is ${String(hour).padStart(2, "0")}:00. School notices go out between ${String(quiet.start).padStart(2, "0")}:00 and ${String(quiet.end).padStart(2, "0")}:00, so a message never wakes a family.`;
}

/** School notices sent so far this calendar month (IST), one per message, not per child. */
export async function schoolNoticesThisMonth(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  today: string,
): Promise<number> {
  const monthStart = `${today.slice(0, 7)}-01`;
  const { count } = await supabase
    .from("school_notice_sends")
    .select("id", { count: "exact", head: true })
    .gte("sent_on", monthStart)
    .eq("status", "sent");
  return Number(count ?? 0);
}

export async function sendSchoolNotice(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  sessionLabel: string;
  kind: SchoolNoticeKind;
  /** The batch's language; a family's own setting wins. */
  language: NoticeLanguage;
  /** The batch's fields, already formatted for the message (dates DD-MM-YYYY). */
  fields: Record<string, string>;
  /** Exactly the students the office picked, re-read from the roster here. */
  studentIds: readonly string[];
  staffId: string | null;
  today: string;
}): Promise<SchoolNoticeOutcome> {
  const empty = { sent: 0, failed: 0, skippedNoCall: 0, skippedNoNumber: 0, alreadySent: 0 };

  if (!isAisensyConfigured()) {
    return { status: "error", message: "AISENSY_API_KEY is not set on the server.", batchId: null, ...empty };
  }
  // VPPS One only (critique0 #30): one path tells a parent about an absence.
  // When the school has handed it to the register's own message, this notice
  // refuses before it claims a single row. The gate checks again per send.
  if (args.kind === "absent_today") {
    const { parentSendReader } = await import("@/platform/messaging/parent-send-reader");
    const owner = await parentSendReader.absentNoticeOwner().catch(() => null);
    if (owner !== "fees_notice") {
      return {
        status: "error",
        message:
          owner === null
            ? "Could not read who sends absence messages. Nothing was sent."
            : "Absence messages are sent from the attendance register, not from here (absent_notice_owner).",
        batchId: null,
        ...empty,
      };
    }
  }

  const definition = schoolNoticeFor(args.kind);
  const picked = new Set(args.studentIds);
  if (picked.size === 0) {
    return { status: "error", message: "Pick at least one student or class.", batchId: null, ...empty };
  }
  const quiet = await schoolNoticeQuietHoursMessage(args.supabase);
  if (quiet) return { status: "error", message: quiet, batchId: null, ...empty };

  // Re-read from the roster, never trusted from the form: a child who left this
  // morning, or a number changed an hour ago, is what the message goes by.
  const roster = (await loadSchoolRoster(args.supabase, args.sessionLabel)).filter((student) =>
    picked.has(student.studentId),
  );

  let skippedNoCall = 0;
  let skippedNoNumber = 0;
  const reachable: RosterStudent[] = [];
  for (const student of roster) {
    if (student.noCall) skippedNoCall += 1;
    else if (!student.destination) skippedNoNumber += 1;
    else reachable.push(student);
  }

  // Children whose phone already had this household notice today.
  let alreadyReached = 0;
  // Who gets one message: a child, or a phone.
  type Group = { lead: RosterStudent; members: RosterStudent[]; language: NoticeLanguage };
  const groups: Group[] = [];
  if (definition.addressedTo === "household") {
    // Phones this notice already reached today, from an earlier press. A
    // closure sent to Class 5 and then to Class 8 messaged a family with a
    // child in each twice: grouping by phone only ever saw one press.
    const { data: earlier } = await args.supabase
      .from("school_notice_sends")
      .select("destination")
      .eq("session_label", args.sessionLabel)
      .eq("notice_kind", args.kind)
      .eq("sent_on", args.today)
      .neq("status", "failed");
    const reachedToday = new Set(
      ((earlier ?? []) as Array<{ destination: string | null }>)
        .map((row) => row.destination)
        .filter(Boolean),
    );
    const byPhone = new Map<string, RosterStudent[]>();
    for (const student of reachable) {
      if (reachedToday.has(student.destination!)) {
        alreadyReached += 1;
        continue;
      }
      const list = byPhone.get(student.destination!) ?? [];
      list.push(student);
      byPhone.set(student.destination!, list);
    }
    for (const members of byPhone.values()) {
      groups.push({ lead: members[0]!, members, language: members[0]!.language ?? args.language });
    }
  } else {
    for (const student of reachable) {
      groups.push({ lead: student, members: [student], language: student.language ?? args.language });
    }
  }

  // The budget is checked against what this batch WOULD send, before any of it goes.
  const thisMonth = await schoolNoticesThisMonth(args.supabase, args.today);
  if (thisMonth + groups.length > SCHOOL_NOTICE_MONTHLY_BUDGET) {
    return {
      status: "error",
      message: `This would take school notices to ${thisMonth + groups.length} this month, over the ${SCHOOL_NOTICE_MONTHLY_BUDGET} budget. Send to fewer classes, or raise the budget in code.`,
      batchId: null,
      ...empty,
      skippedNoCall,
      skippedNoNumber,
    };
  }

  const batchId = randomUUID();
  let sent = 0;
  let failed = 0;
  let alreadySent = alreadyReached;
  const failures: string[] = [];

  for (const group of groups) {
    // A template must be approved in the language this FAMILY reads. Falling
    // back to the other language beats not telling a parent their child is
    // absent; refusing outright when neither is approved is checked upstream.
    const language = isSchoolNoticeApproved(args.kind, group.language)
      ? group.language
      : group.language === "hi"
        ? "en"
        : "hi";
    if (!isSchoolNoticeApproved(args.kind, language)) {
      failed += 1;
      failures.push(`${group.lead.studentName}: no approved template`);
      continue;
    }
    const template = schoolNoticeTemplate(args.kind, language);
    const templateParams = template.buildParams({
      studentName:
        definition.addressedTo === "household" ? studentsLine(group.members) : group.lead.studentName,
      studentClass: group.lead.studentClass,
      fields: args.fields,
    });

    // Claim the day BEFORE the provider call. The unique index on
    // (session, student, kind, day) decides a race between two staff.
    const { data: claim, error: claimError } = await args.supabase
      .from("school_notice_sends")
      .insert({
        session_label: args.sessionLabel,
        student_id: group.lead.studentId,
        notice_kind: args.kind,
        campaign_name: template.campaignName,
        sent_on: args.today,
        destination: group.lead.destination,
        language,
        template_params: templateParams,
        status: "pending",
        batch_id: batchId,
        sent_by: args.staffId,
      })
      .select("id")
      .single();
    let claimId: string | null = claim?.id ?? null;
    if (claimError) {
      if (claimError.code !== "23505") {
        failed += 1;
        failures.push(`${group.lead.studentName}: ${claimError.message}`);
        continue;
      }
      // Today's row exists. A FAILED one is this retry's to take back — the
      // index covers failed rows, so a timed-out absence alert used to read
      // "already sent today" and the parent was never told. Guarded on
      // `status = 'failed'`, so two presses racing still send once.
      const { data: reclaimed } = await args.supabase
        .from("school_notice_sends")
        .update({
          status: "pending",
          campaign_name: template.campaignName,
          destination: group.lead.destination,
          language,
          template_params: templateParams,
          batch_id: batchId,
          sent_by: args.staffId,
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("session_label", args.sessionLabel)
        .eq("student_id", group.lead.studentId)
        .eq("notice_kind", args.kind)
        .eq("sent_on", args.today)
        .eq("status", "failed")
        .select("id");
      const row = ((reclaimed ?? []) as Array<{ id: string }>)[0];
      if (!row) {
        alreadySent += 1;
        continue;
      }
      claimId = row.id;
    }

    const result = await sendAisensyCampaignMessage({
      campaignName: template.campaignName,
      destination: group.lead.destination!,
      userName: group.lead.studentName,
      templateParams,
      source: "vppsone/school-notice",
      // An absence is its own category, and only the path the school chose
      // (runtime_flags.absent_notice_owner) may send it.
      gate:
        args.kind === "absent_today"
          ? {
              kind: "absent_notice",
              absentPath: "fees_notice",
              sessionLabel: args.sessionLabel,
              actor: args.staffId ? { userId: args.staffId } : "system",
            }
          : {
              kind: "school_notice",
              sessionLabel: args.sessionLabel,
              actor: args.staffId ? { userId: args.staffId } : "system",
            },
    });

    await args.supabase
      .from("school_notice_sends")
      .update({
        status: result.ok ? "sent" : "failed",
        provider_message_id: result.ok ? result.messageId : null,
        error_message: result.ok ? null : result.error,
        updated_at: new Date().toISOString(),
      })
      .eq("id", claimId);

    if (!result.ok) {
      failed += 1;
      failures.push(`${group.lead.studentName}: ${result.error}`);
      continue;
    }
    sent += 1;

    // The siblings named inside a household message, recorded so "already
    // sent today" holds for each of them. Best-effort: the parent already has
    // the message, and a bookkeeping hiccup is not a failed send.
    const siblings = group.members.slice(1);
    if (siblings.length > 0) {
      await args.supabase.from("school_notice_sends").insert(
        siblings.map((sibling) => ({
          session_label: args.sessionLabel,
          student_id: sibling.studentId,
          notice_kind: args.kind,
          campaign_name: template.campaignName,
          sent_on: args.today,
          destination: group.lead.destination,
          language,
          template_params: templateParams,
          status: "covered_by_sibling",
          provider_message_id: result.messageId,
          batch_id: batchId,
          sent_by: args.staffId,
        })),
      );
    }
  }

  const parts = [
    `${sent} sent`,
    alreadySent ? `${alreadySent} already sent today` : null,
    skippedNoCall ? `${skippedNoCall} no-call` : null,
    skippedNoNumber ? `${skippedNoNumber} with no number` : null,
    failed ? `${failed} failed` : null,
  ].filter(Boolean);

  return {
    status: failed > 0 ? (sent > 0 ? "partial" : "error") : "success",
    message: `${parts.join(" · ")}.${failures.length ? ` ${failures.slice(0, 5).join("; ")}` : ""}`,
    sent,
    failed,
    skippedNoCall,
    skippedNoNumber,
    alreadySent,
    batchId,
  };
}

export type SchoolNoticeBatch = {
  batchId: string;
  noticeKind: string;
  sentOn: string;
  messages: number;
  children: number;
  failed: number;
};

/** The last few batches, newest first, as one line each. */
export async function loadRecentSchoolNoticeBatches(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sessionLabel: string,
): Promise<SchoolNoticeBatch[]> {
  const { data, error } = await supabase
    .from("school_notice_sends")
    .select("batch_id, notice_kind, sent_on, status, created_at")
    .eq("session_label", sessionLabel)
    .order("created_at", { ascending: false })
    // Recent history only — a dozen batches is a few hundred rows at most.
    .limit(500);
  if (error || !data) return [];

  const byBatch = new Map<string, SchoolNoticeBatch>();
  for (const row of data as Array<{ batch_id: string; notice_kind: string; sent_on: string; status: string }>) {
    const batch =
      byBatch.get(row.batch_id) ??
      { batchId: row.batch_id, noticeKind: row.notice_kind, sentOn: row.sent_on, messages: 0, children: 0, failed: 0 };
    batch.children += 1;
    if (row.status === "sent") batch.messages += 1;
    if (row.status === "failed") batch.failed += 1;
    byBatch.set(row.batch_id, batch);
  }
  return [...byBatch.values()].slice(0, 12);
}
