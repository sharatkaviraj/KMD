import "server-only";

import { chunkArray, fetchAllPages, fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { toWhatsappDestination } from "@/modules/whatsapp/domain/phone";
import type { InstallmentCalendar } from "@/modules/whatsapp/domain/installment-calendar";
import {
  loadActivePlanStudentIds,
  loadLateFeeHistory,
  loadReminderFlags,
} from "@/modules/whatsapp/domain/fee-reminders";
import {
  effectiveProfile,
  isReminderProfile,
  REMINDER_PROFILE_VALUES,
  suggestReminderProfile,
  type EffectiveProfile,
  type ReminderProfile,
} from "@/modules/whatsapp/domain/reminder-profile";

/**
 * Every family's reminder profile, for the Families screen.
 *
 * The send screen works profiles out only for the families on today's list.
 * This reads EVERY collectable student in the session — on the roll, or gone but
 * having paid something, the Dashboard's money rule — so the office can file a
 * family before they are on anybody's list, and so the counts on the screen
 * describe the whole school rather than one run.
 *
 * Same evidence and the same `suggestReminderProfile` as the audience loader, so
 * the profile shown here is the profile a run will treat them as.
 */

export type FamilyProfileRow = {
  studentId: string;
  admissionNo: string;
  studentName: string;
  parentName: string;
  studentClass: string;
  classId: string | null;
  classSortOrder: number;
  /** Fees still pending on this session's four installments. Never the late fee. */
  balanceDue: number;
  /** The office's choice, or null when the family follows the suggestion. */
  explicit: ReminderProfile | null;
  suggested: ReminderProfile;
  effective: EffectiveProfile;
  /** Has a usable WhatsApp number at all. */
  reachable: boolean;
};

export type FamilyProfiles = {
  rows: FamilyProfileRow[];
  /** How many families each profile holds, set and suggested together. */
  counts: Record<ReminderProfile, number>;
  /** How many of those the office set by hand. */
  setByHand: number;
};

type FinancialRow = {
  student_id: string;
  admission_no: string | null;
  student_name: string | null;
  father_name: string | null;
  father_phone: string | null;
  mother_phone: string | null;
  class_id: string | null;
  class_label: string | null;
  sort_order: number | null;
  record_status: string | null;
  total_paid: number | null;
  inst1_pending: number | null;
  inst2_pending: number | null;
  inst3_pending: number | null;
  inst4_pending: number | null;
};

function titleCase(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b[a-z]/g, (character) => character.toUpperCase())
    .trim();
}

export async function loadFamilyProfiles(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sessionLabel: string,
  calendar: InstallmentCalendar,
  today: string,
): Promise<FamilyProfiles> {
  const [financials, flags, lateFeeHistory, planStudentIds] = await Promise.all([
    fetchAllPages<FinancialRow>((from, to) =>
      supabase
        .from("v_workbook_student_financials")
        .select(
          "student_id, admission_no, student_name, father_name, father_phone, mother_phone, class_id, class_label, sort_order, record_status, total_paid, inst1_pending, inst2_pending, inst3_pending, inst4_pending",
        )
        .eq("session_label", sessionLabel)
        .order("student_id", { ascending: true })
        .range(from, to),
    ),
    loadReminderFlags(supabase, sessionLabel),
    loadLateFeeHistory(supabase, sessionLabel, today),
    loadActivePlanStudentIds(supabase, sessionLabel),
  ]);

  if (financials.error) {
    throw new Error("Could not read student financials for the families screen.");
  }

  const counts = Object.fromEntries(REMINDER_PROFILE_VALUES.map((value) => [value, 0])) as Record<
    ReminderProfile,
    number
  >;
  let setByHand = 0;
  const rows: FamilyProfileRow[] = [];

  for (const row of financials.data) {
    const totalPaid = Number(row.total_paid ?? 0);
    // The Dashboard's money rule: a student who left owing money still owes it.
    if (row.record_status !== "active" && totalPaid <= 0) continue;

    const pending = [
      Number(row.inst1_pending ?? 0),
      Number(row.inst2_pending ?? 0),
      Number(row.inst3_pending ?? 0),
      Number(row.inst4_pending ?? 0),
    ];
    const overdueInstallments = calendar.overdue.filter(
      (installment) => (pending[installment - 1] ?? 0) > 0,
    );
    const suggestion = suggestReminderProfile({
      passedInstallments: calendar.overdue.length,
      lateFeeInstallments: lateFeeHistory.get(row.student_id) ?? [],
      overdueInstallments,
      onRepaymentPlan: planStudentIds.has(row.student_id),
    });
    const explicitRaw = flags.get(row.student_id)?.profile ?? null;
    const explicit = isReminderProfile(explicitRaw) ? explicitRaw : null;
    const effective = effectiveProfile(explicit, suggestion);

    counts[effective.profile] += 1;
    if (explicit) setByHand += 1;

    rows.push({
      studentId: row.student_id,
      admissionNo: String(row.admission_no ?? ""),
      studentName: titleCase(row.student_name),
      parentName: titleCase(row.father_name),
      studentClass: row.class_label ?? "",
      classId: row.class_id,
      classSortOrder: Number(row.sort_order ?? 0),
      balanceDue: pending.reduce((sum, value) => sum + value, 0),
      explicit,
      suggested: suggestion.profile,
      effective,
      reachable: Boolean(
        toWhatsappDestination(row.father_phone) ?? toWhatsappDestination(row.mother_phone),
      ),
    });
  }

  rows.sort(
    (left, right) =>
      left.classSortOrder - right.classSortOrder ||
      left.studentName.localeCompare(right.studentName),
  );

  return { rows, counts, setByHand };
}

/**
 * File families under a profile, or back onto the suggestion (`null`).
 *
 * Grouped by value so a page of fifty changes is a handful of statements, not
 * fifty. Existing rows are UPDATED and only missing ones inserted, and every
 * insert passes `no_call: false` — that column defaults to TRUE, so a row
 * written only to record "on time" would otherwise silently drop the family
 * out of the Defaulters call queue. Never an upsert: an upsert carrying
 * `no_call: false` would overwrite a real do-not-call flag.
 */
export async function writeReminderProfiles(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sessionLabel: string,
  changes: ReadonlyArray<{ studentId: string; profile: ReminderProfile | null }>,
  setBy: string | null,
): Promise<number> {
  if (changes.length === 0) return 0;

  // Chunked (rule 3b): the ids ride in the URL, and a bulk change on a large
  // selection passes the ~300-id limit long before 583 children.
  const ids = [...new Set(changes.map((change) => change.studentId))];
  const { data: existing, error: readError } = await fetchInChunks<{ student_id: string }>(
    ids,
    IN_FILTER_CHUNK_SIZE,
    (chunk) =>
      supabase
        .from("student_collection_flags")
        .select("student_id")
        .eq("session_label", sessionLabel)
        .in("student_id", chunk),
  );
  if (readError) {
    throw new Error((readError as { message?: string }).message ?? "Could not read the families' profiles.");
  }
  const hasRow = new Set(existing.map((r) => r.student_id));

  const now = new Date().toISOString();
  const byValue = new Map<string, string[]>();
  const inserts: Array<Record<string, unknown>> = [];

  for (const change of changes) {
    const patch = {
      whatsapp_profile: change.profile,
      whatsapp_profile_set_at: change.profile ? now : null,
      whatsapp_profile_set_by: change.profile ? setBy : null,
    };
    if (hasRow.has(change.studentId)) {
      const key = change.profile ?? "";
      byValue.set(key, [...(byValue.get(key) ?? []), change.studentId]);
    } else if (change.profile) {
      // No row and back to the suggestion is already true — nothing to write.
      inserts.push({
        student_id: change.studentId,
        session_label: sessionLabel,
        no_call: false, // never infer this — see above
        ...patch,
      });
    }
  }

  for (const [value, studentIds] of byValue) {
    const profile = value ? value : null;
    for (const chunk of chunkArray(studentIds, IN_FILTER_CHUNK_SIZE)) {
      const { error } = await supabase
        .from("student_collection_flags")
        .update({
          whatsapp_profile: profile,
          whatsapp_profile_set_at: profile ? now : null,
          whatsapp_profile_set_by: profile ? setBy : null,
        })
        .eq("session_label", sessionLabel)
        .in("student_id", chunk);
      if (error) throw new Error(error.message);
    }
  }

  if (inserts.length > 0) {
    const { error } = await supabase.from("student_collection_flags").insert(inserts);
    if (error) throw new Error(error.message);
  }

  return changes.length;
}
