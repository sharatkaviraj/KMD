import "server-only";

/*
 * Reads for the redesigned Fee setup. The page checks `fees:view` first;
 * publishing goes through the existing `saveWorkbookFeeSetupAction`.
 */

import { getRecentConfigChangeLog, type RecentConfigChangeLogItem } from "@/modules/fees/data/change-log";
import { getFeeSetupPageData } from "@/modules/fees/data/policy";
import { createClient as createFeeClient } from "@/modules/fees/platform/supabase/server";
import { fetchAllPages } from "@/platform/helpers/chunk";
import { getBridgeFeeSetup } from "@/platform/fees-bridge/client";
import type { FeeHeadDefinition } from "@/modules/fees/domain/types";

import { buildDraft, type FeeSetupDraft } from "@/modules/fees/vx/domain/fee-setup";

type Row = Record<string, unknown>;

export type FeeSetupVxData = {
  sessionLabel: string;
  draft: FeeSetupDraft;
  studentsByClass: Record<string, number>;
  studentsByRoute: Record<string, number>;
  activeStudents: number;
  /** Installment numbers that already carry a payment somewhere. */
  paidInstallments: number[];
  /** Students on each discount rule (by policy id). */
  ruleStudents: Record<string, number>;
  ruleStudentNames: Record<string, string[]>;
  history: RecentConfigChangeLogItem[];
  updatedAt: string | null;
  /** Read live from Fees at this time (real staff, real session); absent for One's copy. */
  liveAsOf?: string;
};

/**
 * The same screen data, read live from Fees through the bridge (6 Nov 2026)
 * for real staff on a real session, built by Fees from the same setup page
 * data and row builders. The caller shows "could not read" if this throws.
 */
export async function getFeeSetupVxDataFromFees(sessionLabel: string): Promise<FeeSetupVxData> {
  const live = await getBridgeFeeSetup(sessionLabel);
  return {
    sessionLabel: live.sessionLabel,
    draft: { ...live.draft, customFeeHeads: live.draft.customFeeHeads as FeeHeadDefinition[] },
    studentsByClass: live.studentsByClass,
    studentsByRoute: live.studentsByRoute,
    activeStudents: live.activeStudents,
    paidInstallments: live.paidInstallments,
    ruleStudents: live.ruleStudents,
    ruleStudentNames: live.ruleStudentNames,
    history: live.history as unknown as RecentConfigChangeLogItem[],
    updatedAt: live.updatedAt,
    liveAsOf: live.asOf,
  };
}

export async function getFeeSetupVxData(sessionLabel: string): Promise<FeeSetupVxData> {
  const fee = await createFeeClient();
  const [data, history, roster, paid] = await Promise.all([
    getFeeSetupPageData({ sessionLabel }),
    getRecentConfigChangeLog(20),
    fetchAllPages<Row>((a, b) =>
      fee
        .from("v_workbook_student_financials")
        .select("student_id, class_label, transport_route_name, record_status")
        .eq("session_label", sessionLabel)
        .order("student_id")
        .range(a, b),
    ),
    fetchAllPages<Row>((a, b) =>
      fee
        .from("v_workbook_installment_balances")
        .select("installment_no")
        .eq("session_label", sessionLabel)
        .gt("paid_amount", 0)
        .lt("installment_no", 99)
        .order("installment_id")
        .range(a, b),
    ),
  ]);
  const studentsByClass: Record<string, number> = {};
  const studentsByRoute: Record<string, number> = {};
  let activeStudents = 0;
  const nameById = new Map<string, string>();
  for (const r of roster.data) {
    if (r.record_status === "left") continue;
    activeStudents += 1;
    const c = String(r.class_label ?? "");
    studentsByClass[c] = (studentsByClass[c] ?? 0) + 1;
    const route = r.transport_route_name ? String(r.transport_route_name) : "";
    if (route) studentsByRoute[route] = (studentsByRoute[route] ?? 0) + 1;
  }
  for (const o of data.studentOptions) nameById.set(o.id, `${o.label}`);
  const ruleStudents: Record<string, number> = {};
  const ruleStudentNames: Record<string, string[]> = {};
  for (const a of data.conventionalDiscountAssignments) {
    if (!a.isActive || a.academicSessionLabel !== sessionLabel) continue;
    ruleStudents[a.policyId] = (ruleStudents[a.policyId] ?? 0) + 1;
    const list = (ruleStudentNames[a.policyId] ??= []);
    if (list.length < 30) list.push(nameById.get(a.studentId) ?? "Student");
  }
  const snapshot = data.policySnapshots.find((p) => p.academicSessionLabel === sessionLabel);
  return {
    sessionLabel,
    draft: buildDraft(data, sessionLabel),
    studentsByClass,
    studentsByRoute,
    activeStudents,
    paidInstallments: [...new Set(paid.data.map((r) => Number(r.installment_no)))].sort((a, b) => a - b),
    ruleStudents,
    ruleStudentNames,
    history,
    updatedAt: snapshot?.updatedAt ?? null,
  };
}
