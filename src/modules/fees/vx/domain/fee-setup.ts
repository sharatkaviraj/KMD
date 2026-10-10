/*
 * The redesigned Fee setup's working copy, pure.
 *
 * The screen edits a draft of exactly the payload the existing
 * `saveWorkbookFeeSetupAction` already parses — class tuition, route fees,
 * installment dates, the flat late fee, academic fees and their spread, fee
 * heads and conventional discounts — and nothing it would not understand.
 * Publishing is that action's preview-then-apply, unchanged.
 */

import type { FeeHeadDefinition, FeeSetupPageData } from "@/modules/fees/domain/types";
import {
  buildWorkbookClassSetupRows,
  buildWorkbookRouteSetupRows,
} from "@/modules/fees/domain/workbook-setup";
import { buildWorkbookInstallmentCharges } from "@/modules/fees/domain/workbook";

export type DiscountDraft = {
  key: string;
  id: string | null;
  code: string;
  displayName: string;
  calculationType: "tuition_zero" | "tuition_percentage" | "tuition_fixed_amount";
  fixedTuitionAmount: number | null;
  percentage: number | null;
  isActive: boolean;
  isBuiltin: boolean;
};

export type FeeSetupDraft = {
  academicSessionLabel: string;
  installmentDates: string[];
  lateFeeFlatAmount: number;
  newStudentAcademicFeeAmount: number;
  oldStudentAcademicFeeAmount: number;
  academicFeeDistribution: "first_only" | "equal";
  customFeeHeads: FeeHeadDefinition[];
  discounts: DiscountDraft[];
  classRows: { label: string; annualTuition: number }[];
  routeRows: { routeName: string; annualFee: number }[];
};

export function buildDraft(data: FeeSetupPageData, sessionLabel: string): FeeSetupDraft {
  const snapshot = data.policySnapshots.find((p) => p.academicSessionLabel === sessionLabel) ?? data.globalPolicy;
  return {
    academicSessionLabel: sessionLabel,
    installmentDates: snapshot.installmentSchedule.map((i) => i.dueDate),
    lateFeeFlatAmount: snapshot.lateFeeFlatAmount,
    newStudentAcademicFeeAmount: snapshot.newStudentAcademicFeeAmount,
    oldStudentAcademicFeeAmount: snapshot.oldStudentAcademicFeeAmount,
    academicFeeDistribution: snapshot.academicFeeDistribution === "equal" ? "equal" : "first_only",
    customFeeHeads: snapshot.customFeeHeads.map((h) => ({ ...h })),
    discounts: data.conventionalDiscountPolicies.map((p) => ({
      key: p.id ?? `builtin-${p.code}`,
      id: p.id,
      code: p.code,
      displayName: p.displayName,
      calculationType: p.calculationType,
      fixedTuitionAmount: p.fixedTuitionAmount,
      percentage: p.percentage,
      isActive: p.isActive,
      isBuiltin: p.isBuiltin,
    })),
    classRows: buildWorkbookClassSetupRows(data, sessionLabel).map((r) => ({ label: r.label, annualTuition: r.annualTuition })),
    routeRows: buildWorkbookRouteSetupRows(data).map((r) => ({ routeName: r.routeName, annualFee: r.annualFee })),
  };
}

/** The FormData `saveWorkbookFeeSetupAction` parses, field for field. */
export function draftToFormData(draft: FeeSetupDraft, intent: "preview" | "apply", changeBatchId: string | null): FormData {
  const fd = new FormData();
  fd.set("academicSessionLabel", draft.academicSessionLabel);
  fd.set("lateFeeFlatAmount", String(draft.lateFeeFlatAmount));
  fd.set("newStudentAcademicFeeAmount", String(draft.newStudentAcademicFeeAmount));
  fd.set("oldStudentAcademicFeeAmount", String(draft.oldStudentAcademicFeeAmount));
  fd.set("academicFeeDistribution", draft.academicFeeDistribution);
  fd.set("_intent", intent);
  if (changeBatchId) fd.set("changeBatchId", changeBatchId);
  draft.installmentDates.forEach((d) => fd.append("installmentDueDate", d));
  draft.customFeeHeads.forEach((h) => {
    fd.append("feeHeadId", h.id);
    fd.append("feeHeadLabel", h.label);
    fd.append("feeHeadAmount", String(h.amount));
    fd.append("feeHeadApplicationType", h.applicationType);
    fd.append("feeHeadIsRefundable", h.isRefundable ? "yes" : "no");
    fd.append("feeHeadChargeFrequency", h.chargeFrequency);
    fd.append("feeHeadIsMandatory", h.isMandatory ? "yes" : "no");
    fd.append("feeHeadIncludeInWorkbookCalculation", h.includeInWorkbookCalculation ? "yes" : "no");
    fd.append("feeHeadIsActive", h.isActive ? "yes" : "no");
    fd.append("feeHeadNotes", h.notes ?? "");
  });
  draft.discounts.forEach((d) => {
    fd.append("conventionalPolicyId", d.id ?? "");
    fd.append("conventionalPolicyCode", d.code);
    fd.append("conventionalPolicyName", d.displayName);
    fd.append("conventionalPolicyCalculationType", d.calculationType);
    fd.append("conventionalPolicyFixedAmount", String(d.fixedTuitionAmount ?? ""));
    fd.append("conventionalPolicyPercentage", String(d.percentage ?? ""));
    fd.append("conventionalPolicyIsActive", d.isActive ? "yes" : "no");
  });
  draft.classRows.forEach((c) => {
    fd.append("classLabel", c.label);
    fd.append("classAnnualTuition", String(c.annualTuition));
  });
  draft.routeRows.forEach((r) => {
    fd.append("routeName", r.routeName);
    fd.append("routeAnnualFee", String(r.annualFee));
  });
  return fd;
}

export type DraftChange = {
  key: string;
  area: "class" | "route" | "installment" | "latefee" | "academic" | "discount" | "head";
  title: string;
  before: string;
  after: string;
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function discountValue(d: DiscountDraft): string {
  if (d.calculationType === "tuition_zero") return "Free tuition";
  if (d.calculationType === "tuition_percentage") return `${d.percentage ?? 0}% off tuition`;
  return `Tuition ${inr(d.fixedTuitionAmount ?? 0)}`;
}

export function describeDiscount(d: DiscountDraft) {
  return discountValue(d);
}

/** Every difference between the published setup and the draft, one line each. */
export function diffDrafts(base: FeeSetupDraft, draft: FeeSetupDraft): DraftChange[] {
  const out: DraftChange[] = [];
  const baseClass = new Map(base.classRows.map((c) => [c.label, c.annualTuition]));
  for (const c of draft.classRows) {
    const was = baseClass.get(c.label);
    if (was !== c.annualTuition) out.push({ key: `class:${c.label}`, area: "class", title: `${c.label} · yearly tuition`, before: was === undefined ? "—" : inr(was), after: inr(c.annualTuition) });
  }
  const baseRoute = new Map(base.routeRows.map((r) => [r.routeName, r.annualFee]));
  for (const r of draft.routeRows) {
    const was = baseRoute.get(r.routeName);
    if (was !== r.annualFee) out.push({ key: `route:${r.routeName}`, area: "route", title: `${r.routeName} · yearly bus fee`, before: was === undefined ? "New route" : inr(was), after: inr(r.annualFee) });
  }
  draft.installmentDates.forEach((d, i) => {
    if (base.installmentDates[i] !== d) out.push({ key: `inst:${i}`, area: "installment", title: `Installment ${i + 1} · due date`, before: base.installmentDates[i] ?? "—", after: d });
  });
  if (base.lateFeeFlatAmount !== draft.lateFeeFlatAmount) out.push({ key: "latefee", area: "latefee", title: "Late fee per installment", before: inr(base.lateFeeFlatAmount), after: inr(draft.lateFeeFlatAmount) });
  if (base.newStudentAcademicFeeAmount !== draft.newStudentAcademicFeeAmount) out.push({ key: "acad:new", area: "academic", title: "Academic fee · new students", before: inr(base.newStudentAcademicFeeAmount), after: inr(draft.newStudentAcademicFeeAmount) });
  if (base.oldStudentAcademicFeeAmount !== draft.oldStudentAcademicFeeAmount) out.push({ key: "acad:old", area: "academic", title: "Academic fee · old students", before: inr(base.oldStudentAcademicFeeAmount), after: inr(draft.oldStudentAcademicFeeAmount) });
  if (base.academicFeeDistribution !== draft.academicFeeDistribution) {
    const label = (v: string) => (v === "equal" ? "Spread over all installments" : "All in Installment 1");
    out.push({ key: "acad:dist", area: "academic", title: "Academic fee is charged", before: label(base.academicFeeDistribution), after: label(draft.academicFeeDistribution) });
  }
  const baseDisc = new Map(base.discounts.map((d) => [d.key, d]));
  for (const d of draft.discounts) {
    const was = baseDisc.get(d.key);
    if (!was) {
      out.push({ key: `disc:${d.key}`, area: "discount", title: `New rule · ${d.displayName}`, before: "—", after: discountValue(d) });
      continue;
    }
    if (was.isActive !== d.isActive) out.push({ key: `disc:${d.key}:on`, area: "discount", title: `${d.displayName}`, before: was.isActive ? "On" : "Off", after: d.isActive ? "On" : "Off" });
    if (discountValue(was) !== discountValue(d)) out.push({ key: `disc:${d.key}:v`, area: "discount", title: `${d.displayName} · amount`, before: discountValue(was), after: discountValue(d) });
  }
  const baseHeads = new Map(base.customFeeHeads.map((h) => [h.id, h]));
  for (const h of draft.customFeeHeads) {
    const was = baseHeads.get(h.id);
    if (was && was.amount !== h.amount) out.push({ key: `head:${h.id}`, area: "head", title: `${h.label}`, before: inr(was.amount), after: inr(h.amount) });
  }
  return out;
}

/** Raise every class's tuition by `percent`, rounded to the nearest ₹100. */
export function raiseTuition(rows: readonly { label: string; annualTuition: number }[], percent: number, roundTo = 100) {
  return rows.map((r) => ({
    label: r.label,
    annualTuition: r.annualTuition > 0 ? Math.round((r.annualTuition * (1 + percent / 100)) / roundTo) * roundTo : 0,
  }));
}

export type Band = { key: string; label: string; hi: string };

export const BANDS: Band[] = [
  { key: "pre", label: "Pre-primary", hi: "पूर्व-प्राथमिक" },
  { key: "primary", label: "Primary · 1–5", hi: "प्राथमिक · 1–5" },
  { key: "middle", label: "Middle · 6–8", hi: "माध्यमिक · 6–8" },
  { key: "secondary", label: "Secondary · 9–10", hi: "सेकेंडरी · 9–10" },
  { key: "senior", label: "Senior secondary · 11–12", hi: "सीनियर सेकेंडरी · 11–12" },
  { key: "other", label: "Other classes", hi: "अन्य कक्षाएं" },
];

/** Which band a class label belongs to ("Class 7" → middle, "11 Science" → senior). */
export function bandOf(label: string): Band["key"] {
  const l = label.toLowerCase();
  if (/nursery|lkg|ukg|jkg|skg|pre|kg/.test(l)) return "pre";
  const m = /(\d{1,2})/.exec(l);
  if (!m) return "other";
  const n = Number(m[1]);
  if (n >= 1 && n <= 5) return "primary";
  if (n >= 6 && n <= 8) return "middle";
  if (n === 9 || n === 10) return "secondary";
  if (n === 11 || n === 12) return "senior";
  return "other";
}

/**
 * What one student of a class pays per installment, by the same function the
 * fee engine uses. Old-student academic fee unless `newStudent`; no transport
 * and no discount.
 */
export function perInstallment(draft: FeeSetupDraft, annualTuition: number, newStudent = false): number[] {
  return buildWorkbookInstallmentCharges({
    installmentCount: draft.installmentDates.length,
    tuitionFee: annualTuition,
    transportFee: 0,
    academicFee: newStudent ? draft.newStudentAcademicFeeAmount : draft.oldStudentAcademicFeeAmount,
    otherAdjustmentAmount: 0,
    discountAmount: 0,
    academicFeeDistribution: draft.academicFeeDistribution,
  }).installmentCharges;
}

/**
 * The late fee on one installment, paid on `paidOn`: nothing when the
 * installment was fully paid by its due date, the flat amount otherwise.
 * Separate from the fee — never added to it.
 */
export function lateFeeFor({ dueDate, paidOn, flat, coveredByDue }: { dueDate: string; paidOn: string; flat: number; coveredByDue?: boolean }): number {
  if (flat <= 0) return 0;
  if (paidOn <= dueDate || coveredByDue) return 0;
  return flat;
}

/** A due date may move only while it is still ahead of today. */
export function isDateLocked(dueDate: string, today: string) {
  return dueDate <= today;
}

/** A new rule's code: letters and underscores from its name, unique among existing codes. */
export function ruleCode(name: string, existing: readonly string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "rule";
  let code = base;
  let i = 2;
  while (existing.includes(code)) code = `${base}_${i++}`;
  return code;
}
