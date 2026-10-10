import "server-only";

import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { getDeskReceipt, lastReceiptDate, loadDeskReceipts } from "@/modules/receipts/vx/data";
import { isDaySpan, isIsoDate, latestCloseState, spanRange, type DaySpan } from "@/modules/receipts/vx/domain/day-close";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { feePermissionsFor } from "@/platform/auth/fee-roles";
import { schoolToday } from "@/vx/format";

import { listCloseEvents, pendingReversalRequest } from "./data";
import type { DeskProps, DeskRow, SelectedReceipt } from "./types";

type Search = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Everything /receipts and /receipts/[receiptNumber] draw, from the URL. */
export async function loadReceiptsDesk(staff: CurrentStaff, search: Search, receiptNumber?: string): Promise<DeskProps> {
  const today = schoolToday();
  const dateParam = one(search.date);
  const anchor = isIsoDate(dateParam) && dateParam <= today ? dateParam : today;
  const spanParam = one(search.span);
  const span: DaySpan = isDaySpan(spanParam) ? spanParam : "today";
  const { from, to } = spanRange(span, anchor);
  const view = one(search.view) === "close" ? "close" : "list";

  const viewSession = await resolveViewSession({ searchParamSession: search.session ?? null, cookieSession: await getViewSessionCookie() });
  const sessionLabel = viewSession.sessionLabel;

  const [{ rows, truncated }, events, selectedRaw] = await Promise.all([
    loadDeskReceipts(sessionLabel, from, to),
    listCloseEvents(anchor, anchor),
    receiptNumber ? getDeskReceipt(receiptNumber) : Promise.resolve(null),
  ]);
  const lastDate = rows.length === 0 ? await lastReceiptDate(anchor) : null;

  const slim: DeskRow[] = rows.map((r) => ({
    id: r.id,
    receiptNumber: r.receiptNumber,
    paymentDate: r.paymentDate,
    createdAt: r.createdAt,
    paymentMode: r.paymentMode,
    totalAmount: r.totalAmount,
    isReversed: r.isReversed,
    receivedBy: r.receivedBy,
    studentFullName: r.studentFullName,
    admissionNo: r.admissionNo,
    classLabel: r.classLabel,
  }));

  let selected: SelectedReceipt | null = null;
  if (selectedRaw) {
    const d = selectedRaw.detail;
    const pending = await pendingReversalRequest(d.id);
    selected = {
      id: d.id,
      receiptNumber: d.receiptNumber,
      studentFullName: d.studentFullName,
      admissionNo: d.admissionNo,
      classLabel: d.classLabel,
      fatherName: d.fatherName,
      fatherPhone: d.fatherPhone,
      paymentDate: d.paymentDate,
      createdAt: d.createdAt,
      paymentMode: d.paymentMode,
      referenceNumber: d.referenceNumber,
      totalAmount: d.totalAmount,
      reversedAmount: d.reversedAmount ?? 0,
      isReversed: selectedRaw.isReversed,
      receivedBy: d.receivedBy ?? d.createdByName,
      sessionLabel: d.sessionLabel,
      heads: d.breakdown.map((b) => ({ label: b.installmentLabel, amount: b.amount })),
      share: selectedRaw.share,
      history: selectedRaw.history,
      pendingRequest: pending ? { at: pending.createdAt, by: pending.requestedByName } : null,
    };
  }

  const fee = feePermissionsFor(staff.role);
  const close = latestCloseState(events);
  return {
    today,
    anchor,
    span,
    from,
    to,
    view,
    sessionLabel,
    rows: slim,
    truncated,
    lastDate,
    closeEvent: close.closed && close.event ? close.event : null,
    lastReopen: [...events].reverse().find((e) => e.action === "reopen") ?? null,
    selected,
    sheet: one(search.sheet) === "reverse" ? "reverse" : one(search.sheet) === "send" ? "send" : null,
    initial: { mode: one(search.mode), staff: one(search.staff), query: one(search.q) },
    perms: {
      collect: can(staff, "fees:collect"),
      reverse: fee.includes("payments:reverse_any"),
      reopen: can(staff, "fees:manage"),
      print: fee.includes("receipts:print"),
      dayBook: fee.includes("finance:view"),
    },
  };
}
